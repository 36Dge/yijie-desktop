//! Evaluate the bounded dialect in the consumed source schema; do not duplicate wire DTOs.
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;

pub(super) const MAX_MESSAGE_BYTES: usize = 512 * 1024;
static SCHEMA: OnceLock<Value> = OnceLock::new();

pub(super) fn source() -> &'static Value {
    SCHEMA.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../contracts/workflow-local.schema.json"
        ))
        .expect("bundled workflow source schema")
    })
}

pub(super) fn value(name: &str, value: &Value) -> Result<(), ()> {
    let schema = source()
        .get("$defs")
        .and_then(|defs| defs.get(name))
        .ok_or(())?;
    check(schema, value, 0)
}

pub(super) fn typed<T: Serialize>(name: &str, input: &T) -> Result<(), ()> {
    let bytes = serde_json::to_vec(input).map_err(|_| ())?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(());
    }
    value(name, &serde_json::from_slice(&bytes).map_err(|_| ())?)
}

pub(super) fn field_text(name: &str, field: &str, text: &str) -> Result<(), ()> {
    let rule = &source()["$defs"][name]["properties"][field];
    if rule.get("type").and_then(Value::as_str) != Some("string") {
        return Err(());
    }
    check_text(rule, text)
}

fn check(schema: &Value, input: &Value, depth: usize) -> Result<(), ()> {
    if depth > 32 {
        return Err(());
    }
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        let pointer = reference.strip_prefix('#').ok_or(())?;
        return check(source().pointer(pointer).ok_or(())?, input, depth + 1);
    }
    if schema
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|values| !values.contains(input))
    {
        return Err(());
    }
    if schema
        .get("const")
        .is_some_and(|constant| constant != input)
    {
        return Err(());
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("object") => {
            let object = input.as_object().ok_or(())?;
            let properties = schema
                .get("properties")
                .and_then(Value::as_object)
                .ok_or(())?;
            if let Some(required) = schema.get("required").and_then(Value::as_array) {
                for field in required {
                    if !object.contains_key(field.as_str().ok_or(())?) {
                        return Err(());
                    }
                }
            }
            if object.len() > properties.len() {
                return Err(());
            }
            for (key, item) in object {
                check(properties.get(key).ok_or(())?, item, depth + 1)?;
            }
            let operation_field = schema
                .get("x-operation-field")
                .and_then(Value::as_str)
                .unwrap_or("operation");
            if let Some(requirements) = schema.get("x-operation-required") {
                if let Some(operation) = object.get(operation_field).and_then(Value::as_str) {
                    if let Some(fields) = requirements.get(operation).and_then(Value::as_array) {
                        for field in fields {
                            if !object.contains_key(field.as_str().ok_or(())?) {
                                return Err(());
                            }
                        }
                    }
                }
            }
        }
        Some("array") => {
            let items = input.as_array().ok_or(())?;
            if schema
                .get("maxItems")
                .and_then(Value::as_u64)
                .is_some_and(|max| items.len() as u64 > max)
            {
                return Err(());
            }
            for item in items {
                check(schema.get("items").ok_or(())?, item, depth + 1)?;
            }
        }
        Some("string") => {
            let text = input.as_str().ok_or(())?;
            check_text(schema, text)?;
        }
        Some("integer") => {
            let number = input.as_i64().ok_or(())?;
            if schema
                .get("minimum")
                .and_then(Value::as_i64)
                .is_some_and(|min| number < min)
                || schema
                    .get("maximum")
                    .and_then(Value::as_i64)
                    .is_some_and(|max| number > max)
            {
                return Err(());
            }
        }
        Some("boolean") if input.is_boolean() => {}
        _ => return Err(()),
    }
    Ok(())
}

fn check_text(schema: &Value, text: &str) -> Result<(), ()> {
    let length = text.chars().count() as u64;
    if schema
        .get("maxLength")
        .and_then(Value::as_u64)
        .is_some_and(|max| length > max)
        || schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|min| length < min)
        || schema
            .get("x-utf8-max-bytes")
            .and_then(Value::as_u64)
            .is_some_and(|max| text.len() as u64 > max)
        || schema
            .get("pattern")
            .and_then(Value::as_str)
            .is_some_and(|pattern| !matches_source_pattern(pattern, text))
    {
        return Err(());
    }
    Ok(())
}

fn matches_source_pattern(pattern: &str, text: &str) -> bool {
    match pattern {
        "^[A-Za-z0-9_-]+$" => {
            !text.is_empty()
                && text
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        }
        "^[0-9a-f]{64}$" => {
            text.len() == 64
                && text
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        }
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" => {
            text.len() == 36
                && text.bytes().enumerate().all(|(i, c)| {
                    if matches!(i, 8 | 13 | 18 | 23) {
                        c == b'-'
                    } else {
                        c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
                    }
                })
        }
        "^v0[.]0[.][1-9][0-9]*$" => text.strip_prefix("v0.0.").is_some_and(|number| {
            number
                .as_bytes()
                .first()
                .is_some_and(|first| (b'1'..=b'9').contains(first))
                && number.bytes().all(|c| c.is_ascii_digit())
        }),
        // A new source dialect requires a reviewed consumer implementation, never silent acceptance.
        _ => false,
    }
}
