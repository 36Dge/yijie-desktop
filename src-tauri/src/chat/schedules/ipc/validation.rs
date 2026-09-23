//! Interpret only the closed vocabulary present in the generated source schema.
//! Unsupported constraints fail closed; AJV producer parity tests cover this subset.
use serde_json::Value;
use std::sync::OnceLock;
fn schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../schemas/scheduled-task-ipc-resolved.schema.json"
        ))
        .expect("generated IPC schema")
    })
}
pub(in crate::chat::schedules) fn valid(name: &str, value: &Value) -> bool {
    schema()["$defs"]
        .get(name)
        .is_some_and(|s| check(schema(), s, value, 0))
}
fn pattern(p: &str, text: &str) -> bool {
    match p {
        "^[0-9a-f]{64}$" => {
            text.len() == 64
                && text
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" => {
            uuid::Uuid::parse_str(text).is_ok_and(|u| u.to_string() == text)
        }
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$" => {
            text.len() == 16
                && text.bytes().enumerate().all(|(i, b)| match i {
                    4 | 7 => b == b'-',
                    10 => b == b'T',
                    13 => b == b':',
                    _ => b.is_ascii_digit(),
                })
        }
        "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" => {
            text.is_ascii()
                && text.len() == 5
                && text.as_bytes()[2] == b':'
                && text[..2].parse::<u8>().is_ok_and(|h| h < 24)
                && text[3..].parse::<u8>().is_ok_and(|m| m < 60)
                && text
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| i == 2 || b.is_ascii_digit())
        }
        _ => false,
    }
}
fn check(root: &Value, s: &Value, v: &Value, depth: usize) -> bool {
    if depth > 48 {
        return false;
    }
    if let Some(b) = s.as_bool() {
        return b;
    }
    let Some(o) = s.as_object() else { return false };
    o.iter().all(|(k, c)| match k.as_str() {
        "$id" | "$schema" | "$defs" | "description" | "title" => true,
        "$ref" => c
            .as_str()
            .and_then(|r| r.strip_prefix('#'))
            .and_then(|p| root.pointer(p))
            .is_some_and(|r| check(root, r, v, depth + 1)),
        "const" => v == c,
        "enum" => c.as_array().is_some_and(|a| a.contains(v)),
        "type" => match c.as_str() {
            Some("object") => v.is_object(),
            Some("array") => v.is_array(),
            Some("string") => v.is_string(),
            Some("integer") => v.as_i64().is_some(),
            Some("boolean") => v.is_boolean(),
            Some("null") => v.is_null(),
            _ => false,
        },
        "properties" => v.as_object().is_none_or(|obj| {
            c.as_object().is_some_and(|ps| {
                ps.iter()
                    .all(|(k, s)| obj.get(k).is_none_or(|v| check(root, s, v, depth + 1)))
            })
        }),
        "additionalProperties" => {
            c == true
                || (c == false
                    && v.as_object()
                        .is_none_or(|obj| obj.keys().all(|k| s["properties"].get(k).is_some())))
        }
        "required" => v.as_object().is_none_or(|obj| {
            c.as_array().is_some_and(|rs| {
                rs.iter()
                    .all(|k| k.as_str().is_some_and(|k| obj.contains_key(k)))
            })
        }),
        "dependentRequired" => v.as_object().is_none_or(|obj| {
            c.as_object().is_some_and(|ds| {
                ds.iter().all(|(k, rs)| {
                    !obj.contains_key(k)
                        || rs.as_array().is_some_and(|rs| {
                            rs.iter()
                                .all(|k| k.as_str().is_some_and(|k| obj.contains_key(k)))
                        })
                })
            })
        }),
        "minimum" => v
            .as_i64()
            .is_none_or(|n| c.as_i64().is_some_and(|m| n >= m)),
        "maximum" => v
            .as_i64()
            .is_none_or(|n| c.as_i64().is_some_and(|m| n <= m)),
        "minLength" => v
            .as_str()
            .is_none_or(|t| c.as_u64().is_some_and(|n| t.chars().count() >= n as usize)),
        "maxLength" => v
            .as_str()
            .is_none_or(|t| c.as_u64().is_some_and(|n| t.chars().count() <= n as usize)),
        "pattern" => v
            .as_str()
            .is_none_or(|t| c.as_str().is_some_and(|p| pattern(p, t))),
        "format" => v.as_str().is_none_or(|t| match c.as_str() {
            Some("uuid") => uuid::Uuid::parse_str(t).is_ok(),
            Some("date") => {
                t.len() == 10 && chrono::NaiveDate::parse_from_str(t, "%Y-%m-%d").is_ok()
            }
            _ => false,
        }),
        "minItems" => v
            .as_array()
            .is_none_or(|a| c.as_u64().is_some_and(|n| a.len() >= n as usize)),
        "maxItems" => v
            .as_array()
            .is_none_or(|a| c.as_u64().is_some_and(|n| a.len() <= n as usize)),
        "uniqueItems" => {
            c == false
                || v.as_array()
                    .is_none_or(|a| a.iter().enumerate().all(|(i, x)| !a[..i].contains(x)))
        }
        "items" => v
            .as_array()
            .is_none_or(|a| a.iter().all(|v| check(root, c, v, depth + 1))),
        "allOf" => c
            .as_array()
            .is_some_and(|a| a.iter().all(|s| check(root, s, v, depth + 1))),
        "oneOf" => c
            .as_array()
            .is_some_and(|a| a.iter().filter(|s| check(root, s, v, depth + 1)).count() == 1),
        "not" => !check(root, c, v, depth + 1),
        "if" => {
            if check(root, c, v, depth + 1) {
                s.get("then").is_none_or(|s| check(root, s, v, depth + 1))
            } else {
                s.get("else").is_none_or(|s| check(root, s, v, depth + 1))
            }
        }
        "then" | "else" => true,
        _ => false,
    })
}

pub(crate) fn valid_draft(name: &str, value: &Value) -> bool {
    static ROOT: OnceLock<Value> = OnceLock::new();
    let root = ROOT.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../../contracts/scheduled-draft.schema.json"
        ))
        .expect("generated draft schema")
    });
    root["$defs"]
        .get(name)
        .is_some_and(|s| check(root, s, value, 0))
}
