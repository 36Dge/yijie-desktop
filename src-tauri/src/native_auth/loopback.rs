use super::error::NativeAuthError;
use super::secret::SecretValue;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration, Instant};
use url::Url;

const CALLBACK_PATH: &str = "/oauth/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_REJECTED_CONNECTIONS: usize = 8;

pub struct LoopbackCallback {
    listener: TcpListener,
    port: u16,
}

#[derive(Debug)]
pub struct CallbackCode {
    pub code: SecretValue,
}

impl LoopbackCallback {
    pub async fn bind() -> Result<Self, NativeAuthError> {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .await
            .map_err(|_| NativeAuthError::CallbackRejected)?;
        let port = listener
            .local_addr()
            .map_err(|_| NativeAuthError::CallbackRejected)?
            .port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    pub async fn wait_for_code(
        self,
        expected_state: &str,
        expected_issuer: &str,
    ) -> Result<CallbackCode, NativeAuthError> {
        let deadline = Instant::now() + CALLBACK_TIMEOUT;
        for _ in 0..MAX_REJECTED_CONNECTIONS {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let (mut stream, peer) = timeout(remaining, self.listener.accept())
                .await
                .map_err(|_| NativeAuthError::CallbackRejected)?
                .map_err(|_| NativeAuthError::CallbackRejected)?;
            if peer.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
                respond(&mut stream, 403, "Authentication callback rejected.").await;
                continue;
            }

            match read_request(&mut stream, self.port, expected_state, expected_issuer).await {
                Ok(code) => {
                    respond(
                        &mut stream,
                        200,
                        "Authentication complete. Return to Yijie AI.",
                    )
                    .await;
                    return Ok(CallbackCode { code });
                }
                Err(CallbackParseError::WrongPath) => {
                    respond(&mut stream, 404, "Not found.").await;
                }
                Err(CallbackParseError::Rejected) => {
                    respond(&mut stream, 400, "Authentication callback rejected.").await;
                    return Err(NativeAuthError::CallbackRejected);
                }
                Err(CallbackParseError::Malformed) => {
                    respond(&mut stream, 400, "Bad request.").await;
                }
            }
        }
        Err(NativeAuthError::CallbackRejected)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CallbackParseError {
    WrongPath,
    Rejected,
    Malformed,
}

async fn read_request(
    stream: &mut TcpStream,
    port: u16,
    expected_state: &str,
    expected_issuer: &str,
) -> Result<SecretValue, CallbackParseError> {
    let mut buffer = [0_u8; MAX_REQUEST_BYTES];
    let mut used = 0;
    loop {
        if used == MAX_REQUEST_BYTES {
            return Err(CallbackParseError::Malformed);
        }
        let read = timeout(READ_TIMEOUT, stream.read(&mut buffer[used..]))
            .await
            .map_err(|_| CallbackParseError::Malformed)?
            .map_err(|_| CallbackParseError::Malformed)?;
        if read == 0 {
            return Err(CallbackParseError::Malformed);
        }
        used += read;
        if buffer[..used].windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            break;
        }
    }
    parse_request(&buffer[..used], port, expected_state, expected_issuer)
}

fn parse_request(
    bytes: &[u8],
    port: u16,
    expected_state: &str,
    expected_issuer: &str,
) -> Result<SecretValue, CallbackParseError> {
    let request = std::str::from_utf8(bytes).map_err(|_| CallbackParseError::Malformed)?;
    let head = request
        .split_once("\r\n\r\n")
        .map(|(head, _)| head)
        .ok_or(CallbackParseError::Malformed)?;
    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or(CallbackParseError::Malformed)?;
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next().ok_or(CallbackParseError::Malformed)?;
    let target = request_parts.next().ok_or(CallbackParseError::Malformed)?;
    let version = request_parts.next().ok_or(CallbackParseError::Malformed)?;
    if request_parts.next().is_some() || method != "GET" || version != "HTTP/1.1" {
        return Err(CallbackParseError::Malformed);
    }
    if !target.starts_with('/') || target.starts_with("//") || target.contains('#') {
        return Err(CallbackParseError::Malformed);
    }

    let expected_host = format!("127.0.0.1:{port}");
    let mut host = None;
    let mut content_length = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(CallbackParseError::Malformed)?;
        if name.eq_ignore_ascii_case("host") {
            if host.replace(value.trim()).is_some() {
                return Err(CallbackParseError::Malformed);
            }
        } else if name.eq_ignore_ascii_case("content-length") {
            if content_length.replace(value.trim()).is_some() {
                return Err(CallbackParseError::Malformed);
            }
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(CallbackParseError::Malformed);
        }
    }
    if host != Some(expected_host.as_str()) {
        return Err(CallbackParseError::Rejected);
    }
    if !matches!(content_length, None | Some("0")) {
        return Err(CallbackParseError::Malformed);
    }

    let url = Url::parse(&format!("http://{expected_host}{target}"))
        .map_err(|_| CallbackParseError::Malformed)?;
    if url.path() != CALLBACK_PATH {
        return Err(CallbackParseError::WrongPath);
    }

    let mut code = None;
    let mut state = None;
    let mut issuer = None;
    for (name, value) in url.query_pairs() {
        match name.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "state" if state.is_none() => state = Some(value.into_owned()),
            "iss" if issuer.is_none() => issuer = Some(value.into_owned()),
            _ => return Err(CallbackParseError::Rejected),
        }
    }
    let code = code
        .filter(|value| !value.is_empty() && value.len() <= 2048)
        .ok_or(CallbackParseError::Rejected)?;
    let state = state
        .filter(|value| !value.is_empty() && value.len() <= 2048)
        .ok_or(CallbackParseError::Rejected)?;

    let expected_hash = Sha256::digest(expected_state.as_bytes());
    let received_hash = Sha256::digest(state.as_bytes());
    if expected_hash.ct_eq(&received_hash).unwrap_u8() != 1 {
        return Err(CallbackParseError::Rejected);
    }
    if issuer.is_some_and(|value| value != expected_issuer) {
        return Err(CallbackParseError::Rejected);
    }
    Ok(SecretValue::new(code))
}

async fn respond(stream: &mut TcpStream, status: u16, message: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{message}",
        message.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(target: &str, port: u16) -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").into_bytes()
    }

    #[tokio::test]
    async fn binds_only_an_ephemeral_ipv4_loopback_callback() {
        let callback = LoopbackCallback::bind().await.expect("bind callback");
        let uri = callback.redirect_uri();
        let url = Url::parse(&uri).expect("redirect URL");

        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.path(), CALLBACK_PATH);
        assert_ne!(url.port(), Some(0));
    }

    #[test]
    fn accepts_only_exact_path_host_state_and_code() {
        let code = parse_request(
            &request("/oauth/callback?code=secret-code&state=expected", 43123),
            43123,
            "expected",
            "https://identity.example/",
        )
        .expect("valid callback");
        assert_eq!(code.expose(), "secret-code");

        assert_eq!(
            parse_request(
                &request("/wrong?code=secret-code&state=expected", 43123),
                43123,
                "expected",
                "https://identity.example/"
            )
            .unwrap_err(),
            CallbackParseError::WrongPath
        );
        assert_eq!(
            parse_request(
                &request("/oauth/callback?code=secret-code&state=wrong", 43123),
                43123,
                "expected",
                "https://identity.example/"
            )
            .unwrap_err(),
            CallbackParseError::Rejected
        );
    }

    #[test]
    fn rejects_duplicate_unknown_or_oauth_error_parameters() {
        for target in [
            "/oauth/callback?code=a&code=b&state=expected",
            "/oauth/callback?code=a&state=expected&extra=value",
            "/oauth/callback?error=access_denied&state=expected",
        ] {
            assert_eq!(
                parse_request(
                    &request(target, 43123),
                    43123,
                    "expected",
                    "https://identity.example/"
                )
                .unwrap_err(),
                CallbackParseError::Rejected
            );
        }
    }

    #[test]
    fn rejects_wrong_host_absolute_form_and_non_get_requests() {
        let wrong_host =
            b"GET /oauth/callback?code=a&state=s HTTP/1.1\r\nHost: localhost:43123\r\n\r\n";
        assert_eq!(
            parse_request(wrong_host, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Rejected
        );

        let absolute = b"GET http://127.0.0.1:43123/oauth/callback?code=a&state=s HTTP/1.1\r\nHost: 127.0.0.1:43123\r\n\r\n";
        assert_eq!(
            parse_request(absolute, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Malformed
        );

        let post = b"POST /oauth/callback?code=a&state=s HTTP/1.1\r\nHost: 127.0.0.1:43123\r\n\r\n";
        assert_eq!(
            parse_request(post, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Malformed
        );
    }

    #[test]
    fn accepts_only_an_exact_optional_issuer_parameter() {
        let valid = request(
            "/oauth/callback?code=a&state=s&iss=https%3A%2F%2Fidentity.example%2F",
            43123,
        );
        assert!(parse_request(&valid, 43123, "s", "https://identity.example/").is_ok());

        let wrong = request(
            "/oauth/callback?code=a&state=s&iss=https%3A%2F%2Fattacker.example%2F",
            43123,
        );
        assert_eq!(
            parse_request(&wrong, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Rejected
        );
    }

    #[test]
    fn rejects_request_bodies_and_transfer_encoding() {
        let with_body = b"GET /oauth/callback?code=a&state=s HTTP/1.1\r\nHost: 127.0.0.1:43123\r\nContent-Length: 1\r\n\r\nx";
        assert_eq!(
            parse_request(with_body, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Malformed
        );
        let chunked = b"GET /oauth/callback?code=a&state=s HTTP/1.1\r\nHost: 127.0.0.1:43123\r\nTransfer-Encoding: chunked\r\n\r\n";
        assert_eq!(
            parse_request(chunked, 43123, "s", "https://identity.example/").unwrap_err(),
            CallbackParseError::Malformed
        );
    }
}
