use crate::chat::{
    database::ChatRepository,
    error::{map_sqlite_error, ChatError},
};
use rusqlite::{params, OptionalExtension};
use url::{Host, Url};
use uuid::Uuid;

pub(super) fn valid_destination(raw: &str, url: &Url) -> bool {
    let Some((scheme, rest)) = raw.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https")
        || raw.contains('\\')
        || authority.is_empty()
        || authority.contains('@')
    {
        return false;
    }
    match url.host() {
        Some(Host::Domain(domain)) => {
            let name = domain.strip_suffix('.').unwrap_or(domain);
            name.contains('.')
                && name.len() <= 253
                && name.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
                && ![
                    "localhost",
                    "local",
                    "localdomain",
                    "internal",
                    "lan",
                    "home.arpa",
                    "test",
                    "invalid",
                    "example",
                    "onion",
                ]
                .iter()
                .any(|suffix| {
                    name == *suffix
                        || name
                            .strip_suffix(suffix)
                            .is_some_and(|prefix| prefix.ends_with('.'))
                })
        }
        Some(Host::Ipv4(address)) => super::public_ip(address.into()),
        Some(Host::Ipv6(address)) => super::public_ip(address.into()),
        None => false,
    }
}

fn url_tokens(text: &str) -> impl Iterator<Item = &str> {
    let mut cursor = 0;
    std::iter::from_fn(move || {
        while cursor < text.len() {
            let start = cursor;
            let rest = &text[start..];
            let character = rest.chars().next()?;
            cursor += character.len_utf8();
            if !character.eq_ignore_ascii_case(&'h') {
                continue;
            }
            let Some(prefix) = ["https://", "http://"].into_iter().find(|scheme| {
                rest.get(..scheme.len())
                    .is_some_and(|head| head.eq_ignore_ascii_case(scheme))
            }) else {
                continue;
            };
            if text[..start]
                .chars()
                .next_back()
                .is_some_and(|prev| prev.is_ascii_alphanumeric() || "._+/@%#-".contains(prev))
            {
                continue;
            }
            cursor = start + prefix.len();
            let (mut parentheses, mut brackets) = (0, 0);
            for next in text[cursor..].chars() {
                if next.is_whitespace()
                    || next.is_control()
                    || "<>\"`，。！？；：、…（）【】《》“”‘’\u{feff}".contains(next)
                {
                    break;
                }
                match next {
                    '(' => parentheses += 1,
                    ')' if parentheses == 0 => break,
                    ')' => parentheses -= 1,
                    '[' => brackets += 1,
                    ']' if brackets == 0 => break,
                    ']' => brackets -= 1,
                    _ => {}
                }
                cursor += next.len_utf8();
            }
            return Some(
                text[start..cursor].trim_end_matches(['.', ',', ';', ':', '!', '?', '\'']),
            );
        }
        None
    })
}

impl ChatRepository {
    pub(in crate::chat) fn user_message_contains_url(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        item_id: &str,
        url: &str,
    ) -> Result<bool, ChatError> {
        let Some(index) = item_id
            .strip_prefix(&format!("{turn_id}:user:"))
            .and_then(|suffix| {
                suffix
                    .parse::<u32>()
                    .ok()
                    .filter(|index| suffix == index.to_string())
            })
        else {
            return Ok(false);
        };
        let original: Option<String> = self
            .connection
            .query_row(
                "SELECT m.content FROM chat_messages m JOIN chat_turns t ON m.turn_id=t.id
             JOIN chat_sessions s ON t.session_id=s.id AND m.session_id=s.id
             WHERE s.id=?1 AND t.id=?2 AND s.owner_user_id=?3 AND s.tenant_id=?4 AND m.role='user'
             AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)
             ORDER BY m.ordinal,m.id LIMIT 1 OFFSET ?5",
                params![
                    session_id.to_string(),
                    turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    index
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?;
        Ok(original.is_some_and(|text| url_tokens(&text).any(|candidate| candidate == url)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_message_web_link_tokens_match_the_shared_examples_without_network() {
        #[derive(serde::Deserialize)]
        struct Example {
            text: String,
            urls: Vec<String>,
        }
        let examples: Vec<Example> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/user-message-web-links.json"
        )))
        .unwrap();
        for example in examples {
            let urls: Vec<_> = url_tokens(&example.text)
                .filter(|raw| {
                    super::super::public_url(raw).is_some_and(|url| valid_destination(raw, &url))
                })
                .collect();
            assert_eq!(urls, example.urls);
        }
    }
}
