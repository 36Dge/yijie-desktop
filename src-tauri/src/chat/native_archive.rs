//! Strict, read-only compatibility for an existing display producer. Archive
//! bytes and the active v4 writer/Host wire remain unchanged.
use super::error::ChatError;
use super::native_conversation_generated::{
    ArchiveV5NativeConversationView, NativeConversationView,
};

pub(crate) fn decode_v5(
    json: &str,
) -> Result<(NativeConversationView, ArchiveV5NativeConversationView), ChatError> {
    let archive: ArchiveV5NativeConversationView =
        serde_json::from_str(json).map_err(|_| ChatError::DatabaseUnavailable)?;
    // The base projection carries unchanged execution facts. All v5 display
    // details travel alongside it as a typed companion, never as an instruction.
    let mut base = serde_json::to_value(&archive).map_err(|_| ChatError::DatabaseUnavailable)?;
    for entry in base["items"]
        .as_array_mut()
        .ok_or(ChatError::DatabaseUnavailable)?
    {
        let item = entry["item"]
            .as_object_mut()
            .ok_or(ChatError::DatabaseUnavailable)?;
        for field in [
            "appContext",
            "commandActions",
            "commandPreview",
            "fileChange",
        ] {
            item.remove(field);
        }
        if item.get("type").and_then(|v| v.as_str()) == Some("fileChange") {
            item.insert("type".into(), "unknown".into());
        }
    }
    let view = serde_json::from_value(base).map_err(|_| ChatError::DatabaseUnavailable)?;
    Ok((view, archive))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_archive_keeps_terminal_and_complete_typed_display_without_rewriting() {
        let json = serde_json::json!({"sessionId":"session","turnId":"turn","runtimeThreadId":"thread","runtimeTurnId":"runtime-turn","source":"native_observed","revision":"7","availability":"partial","status":"completed","statusSource":"runtime_notification","terminalObserved":true,"items":[{"ordinal":0,"lastMethod":"item/completed","item":{"id":"answer","type":"agentMessage","phase":"final_answer","text":"Saved answer","availability":"available"}},{"ordinal":1,"lastMethod":"item/completed","item":{"id":"file","type":"fileChange","status":"completed","availability":"available","fileChange":{"changes":[{"index":0,"kind":"add","pathLabel":"report.md","diffText":"saved report\n","addedLines":1,"removedLines":0}]}}}]}).to_string();
        let original = json.clone();
        let (view, archive) = decode_v5(&json).unwrap();
        assert_eq!(json, original);
        assert_eq!(view.status.as_deref(), Some("completed"));
        assert!(view.terminal_observed);
        assert_eq!(view.items[0].item.text.as_deref(), Some("Saved answer"));
        assert_eq!(view.items[1].item.kind, "unknown");
        assert_eq!(archive.items[1].item.kind, "fileChange");
        assert_eq!(
            archive.items[1].item.file_change.as_ref().unwrap().changes[0]
                .diff_text
                .as_deref(),
            Some("saved report\n")
        );
        assert_eq!(
            super::super::native_conversation_storage::NATIVE_WRITE_FORMAT,
            4
        );
    }
}
