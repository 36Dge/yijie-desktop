//! Native-owned Host control pipe. HTTP bearer access cannot grant a submission
//! or approve a market call; only this parent-owned channel carries authority.
use super::host_generated as wire;
use serde::{de::DeserializeOwned, Serialize};
use std::fmt;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{Mutex, MutexGuard};

const MAX_REQUEST_BYTES: usize = wire::MAX_CONTROL_FRAME_BYTES;
const MAX_RESPONSE_BYTES: usize = wire::MAX_SMALL_CONTROL_FRAME_BYTES;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);

type Input = Box<dyn AsyncWrite + Send + Unpin>;
type Output = BufReader<Box<dyn AsyncRead + Send + Unpin>>;

struct Transport {
    input: Input,
    output: Output,
}

struct Inner {
    transport: Mutex<Option<Transport>>,
    closed: AtomicBool,
}

#[derive(Clone)]
pub(crate) struct MarketControl(Arc<Inner>);

impl fmt::Debug for MarketControl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MarketControl([private owner pipe])")
    }
}

pub(crate) enum ControlError {
    Closed,
    Busy,
    InvalidRequest,
    OutcomeUnknown,
    Rejected(wire::Error),
}

impl fmt::Debug for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => f.write_str("ControlClosed"),
            Self::Busy => f.write_str("ControlBusy"),
            Self::InvalidRequest => f.write_str("ControlInvalidRequest"),
            Self::OutcomeUnknown => f.write_str("ControlOutcomeUnknown"),
            Self::Rejected(error) => f.debug_tuple("ControlRejected").field(&error.code).finish(),
        }
    }
}

// Dropping a request future during IO must retire the channel. Reusing a
// partially written/read JSONL exchange would give the next request its reply.
struct Exchange<'a> {
    guard: MutexGuard<'a, Option<Transport>>,
    closed: &'a AtomicBool,
    complete: bool,
}

impl Drop for Exchange<'_> {
    fn drop(&mut self) {
        if !self.complete {
            self.closed.store(true, Ordering::Release);
            self.guard.take(); // Normal EOF. Child ownership stays in SidecarSupervisor.
        }
    }
}

impl MarketControl {
    pub(crate) fn new(input: ChildStdin, output: ChildStdout) -> Self {
        Self::from_io(Box::new(input), Box::new(output))
    }

    fn from_io(input: Input, output: Box<dyn AsyncRead + Send + Unpin>) -> Self {
        Self(Arc::new(Inner {
            transport: Mutex::new(Some(Transport {
                input,
                output: BufReader::new(output),
            })),
            closed: AtomicBool::new(false),
        }))
    }

    #[cfg(test)]
    pub(super) fn from_test_io(input: Input, output: Box<dyn AsyncRead + Send + Unpin>) -> Self {
        Self::from_io(input, output)
    }

    pub(crate) fn is_open(&self) -> bool {
        !self.0.closed.load(Ordering::Acquire)
    }

    /// Synchronous invalidation closes idle pipes immediately. In-flight IO
    /// retires at its bounded completion; no later request may enter.
    pub(crate) fn retire(&self) {
        self.0.closed.store(true, Ordering::Release);
        if let Ok(mut guard) = self.0.transport.try_lock() {
            guard.take();
        } else if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let control = self.clone();
            runtime.spawn(async move {
                control.close().await;
            });
        }
    }

    pub(crate) async fn close(&self) {
        self.0.closed.store(true, Ordering::Release);
        self.0.transport.lock().await.take();
    }

    pub(crate) async fn request<R: Serialize, T: DeserializeOwned>(
        &self,
        request_id: &str,
        request: &R,
    ) -> Result<T, ControlError> {
        if !self.is_open() {
            return Err(ControlError::Closed);
        }
        let mut bytes = serde_json::to_vec(request).map_err(|_| ControlError::InvalidRequest)?;
        if bytes.len() + 1 > MAX_REQUEST_BYTES {
            return Err(ControlError::InvalidRequest);
        }
        bytes.push(b'\n');
        let guard = tokio::time::timeout(CONTROL_TIMEOUT, self.0.transport.lock())
            .await
            .map_err(|_| ControlError::Busy)?;
        if !self.is_open() || guard.is_none() {
            return Err(ControlError::Closed);
        }
        let mut exchange = Exchange {
            guard,
            closed: &self.0.closed,
            complete: false,
        };
        let transport = exchange.guard.as_mut().ok_or(ControlError::Closed)?;
        let observed = tokio::time::timeout(CONTROL_TIMEOUT, async {
            transport.input.write_all(&bytes).await?;
            transport.input.flush().await?;
            let mut response = Vec::new();
            (&mut transport.output)
                .take(MAX_RESPONSE_BYTES as u64 + 1)
                .read_until(b'\n', &mut response)
                .await?;
            if response.len() > MAX_RESPONSE_BYTES || response.last() != Some(&b'\n') {
                return Err(std::io::Error::other("private control frame unavailable"));
            }
            Ok(response)
        })
        .await
        .map_err(|_| ControlError::OutcomeUnknown)?
        .map_err(|_| ControlError::OutcomeUnknown)?;
        let value: serde_json::Value =
            serde_json::from_slice(&observed).map_err(|_| ControlError::OutcomeUnknown)?;
        if value.get("requestId").and_then(|v| v.as_str()) != Some(request_id)
            || value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1)
        {
            return Err(ControlError::OutcomeUnknown);
        }
        let result = if value.get("code").is_some() {
            if value.get("data").is_some() {
                return Err(ControlError::OutcomeUnknown);
            }
            let error = serde_json::from_value(value).map_err(|_| ControlError::OutcomeUnknown)?;
            Err(ControlError::Rejected(error))
        } else {
            Ok(serde_json::from_value(value).map_err(|_| ControlError::OutcomeUnknown)?)
        };
        if !self.is_open() {
            return Err(ControlError::Closed);
        }
        exchange.complete = true;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, split};

    #[tokio::test]
    async fn ordinary_private_exchange_and_normal_eof() {
        let (native, host) = duplex(4096);
        let (native_read, native_write) = split(native);
        let control = MarketControl::from_io(Box::new(native_write), Box::new(native_read));
        let peer = tokio::spawn(async move {
            let (read, mut write) = split(host);
            let mut read = BufReader::new(read);
            let mut line = String::new();
            read.read_line(&mut line).await.unwrap();
            let request: serde_json::Value = serde_json::from_str(&line).unwrap();
            let response = serde_json::json!({"schemaVersion":1,"requestId":request["requestId"],"data":{"observed":true}});
            write
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
            line.clear();
            assert_eq!(read.read_line(&mut line).await.unwrap(), 0);
        });
        // Ordinary internal transport data; product wire is validated by the
        // generated request/response at each typed caller and Host handler.
        let response: serde_json::Value = control
            .request(
                "ordinary-request",
                &serde_json::json!({"requestId":"ordinary-request"}),
            )
            .await
            .unwrap();
        assert_eq!(response["data"]["observed"], true);
        control.close().await;
        assert!(!control.is_open());
        peer.await.unwrap();
    }

    #[tokio::test]
    async fn closed_owner_does_not_write_again() {
        let (native, mut host) = duplex(64);
        let (read, write) = split(native);
        let control = MarketControl::from_io(Box::new(write), Box::new(read));
        control.close().await;
        let result = control.request::<_, serde_json::Value>("ordinary-request", &());
        assert!(matches!(result.await, Err(ControlError::Closed)));
        let mut bytes = [0; 1];
        assert_eq!(host.read(&mut bytes).await.unwrap(), 0);
    }
}
