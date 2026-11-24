use super::{
    fallback_title, map_sqlite_error, migrations::SELECTED_SKILLS_SCHEMA_VERSION, ChatError,
    ChatScope, DraftContentBlock, SessionSummary, SessionTitleSource,
};
use rusqlite::{params, Connection};
use std::borrow::Cow;
use std::ops::Range;

const MARKER_PREFIX: &str = "【技能";
pub(super) const SKILL_ONLY_TITLE: &str = "技能对话";

// The desktop composer emits a numbered marker at each picked skill's caret
// position. A legacy submission can instead start with one $name line.
// Work on the complete text, before fallback_title applies its grapheme limit.
fn marker(after_prefix: &str) -> Option<(usize, &str, usize)> {
    let digits = after_prefix
        .bytes()
        .take(4)
        .take_while(u8::is_ascii_digit)
        .count();
    if !(1..=3).contains(&digits) || after_prefix.starts_with('0') {
        return None;
    }
    let index = after_prefix[..digits].parse::<usize>().ok()? - 1;
    let name = after_prefix[digits..].strip_prefix(' ')?;
    let length = if let Some(alias) = name.strip_prefix('$') {
        let length = alias
            .bytes()
            .take(513)
            .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-'))
            .count();
        if !(1..=512).contains(&length) {
            return None;
        }
        1 + length
    } else if name.starts_with('"') {
        let mut strings = serde_json::Deserializer::from_str(name).into_iter::<String>();
        strings.next()?.ok()?;
        strings.byte_offset()
    } else {
        return None;
    };
    name[length..].starts_with('】').then_some((
        index,
        &name[..length],
        digits + 1 + length + '】'.len_utf8(),
    ))
}

fn legacy_alias(token: &str) -> bool {
    let Some(name) = token.strip_prefix('$') else {
        return false;
    };
    let mut parts = name.split(':');
    let valid = |part: &str| {
        (1..=128).contains(&part.len())
            && part.as_bytes()[0].is_ascii_alphanumeric()
            && part
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    parts.next().is_some_and(valid) && parts.next().is_none_or(valid) && parts.next().is_none()
}

fn text_only_alias(token: &str) -> bool {
    legacy_alias(token) && token.bytes().any(|b| b.is_ascii_lowercase())
}

fn without_legacy_header(text: &str, skill_count: usize) -> &str {
    if !text.starts_with('$') {
        return text;
    }
    let (header, body) = text.split_once("\n\n").unwrap_or((text, ""));
    let mut names = header.split(' ');
    let is_header = if skill_count == 0 {
        names.all(text_only_alias)
    } else {
        names.clone().count() == skill_count && names.all(legacy_alias)
    };
    if is_header {
        body
    } else {
        text
    }
}

fn prose(text: &str, skill_count: usize, legacy: bool) -> Cow<'_, str> {
    if skill_count == 0 && !legacy {
        return Cow::Borrowed(text);
    }
    let unpositioned = || Cow::Borrowed(without_legacy_header(text, skill_count));
    if !text.contains(MARKER_PREFIX) {
        return unpositioned();
    }
    // A number must refer to a saved selection and occur exactly once.
    // An identical marker quoted by the user is ambiguous without the caret receipt.
    let mut counts = vec![0; if skill_count > 0 { skill_count } else { 256 }];
    let mut spans: Vec<(usize, Range<usize>)> = Vec::new();
    let mut end = 0;
    for (start, _) in text.match_indices(MARKER_PREFIX) {
        if start < end {
            continue;
        }
        let name_start = start + MARKER_PREFIX.len();
        if let Some((index, name, length)) = marker(&text[name_start..]) {
            end = name_start + length;
            if index < counts.len() && (skill_count > 0 || text_only_alias(name)) {
                counts[index] += 1;
                spans.push((index, start..end));
            }
        }
    }
    // In the text-only format all selections had a marker in this block.
    if skill_count == 0 && counts.iter().take_while(|&&count| count == 1).count() != spans.len() {
        return unpositioned();
    }
    let mut body = String::new();
    let mut cursor = 0;
    for (index, span) in spans {
        if counts[index] != 1 {
            continue;
        }
        body.push_str(&text[cursor..span.start]);
        cursor = span.end;
    }
    if cursor == 0 {
        return unpositioned();
    }
    body.push_str(&text[cursor..]);
    Cow::Owned(body)
}

fn cleaned_prose<'a>(
    texts: impl Iterator<Item = (&'a str, usize)>,
    legacy: bool,
) -> Option<String> {
    let mut changed = false;
    let parts: Vec<_> = texts
        .map(|(text, count)| {
            let body = prose(text, count, legacy);
            changed |= body != text;
            body
        })
        .collect();
    changed.then(|| parts.join("\n"))
}

fn text_only_schema(db: &Connection) -> Result<bool, ChatError> {
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(map_sqlite_error)?;
    Ok(version < SELECTED_SKILLS_SCHEMA_VERSION)
}

fn possible_marker(text: &str) -> bool {
    text.starts_with('$') || text.contains(MARKER_PREFIX)
}

pub(super) fn draft_prose(
    db: &Connection,
    blocks: &[DraftContentBlock],
) -> Result<Option<String>, ChatError> {
    let texts = blocks.iter().filter_map(|block| match block {
        DraftContentBlock::Text(text) | DraftContentBlock::SelectedText { text, .. } => {
            Some((text.as_str(), block.selected_skills().len()))
        }
        _ => None,
    });
    if !texts.clone().any(|(text, _)| possible_marker(text)) {
        return Ok(None);
    }
    let legacy = texts
        .clone()
        .any(|(text, count)| count == 0 && possible_marker(text))
        && text_only_schema(db)?;
    Ok(cleaned_prose(texts, legacy))
}

pub(super) fn legacy_title(text: &str) -> String {
    let body = prose(text, 0, true);
    fallback_title(if body.trim().is_empty() && body != text {
        SKILL_ONLY_TITLE
    } else {
        &body
    })
}

pub(super) fn restore_fallback_titles(
    db: &Connection,
    scope: &ChatScope,
    sessions: &mut [SessionSummary],
) -> Result<(), ChatError> {
    // Older fallback titles can end inside a marker. The opening message
    // retains the complete input even when the stored title ends at “【”.
    let mut candidates = sessions
        .iter_mut()
        .filter(|session| {
            session.title_source == SessionTitleSource::Fallback
                && (possible_marker(&session.title)
                    || session.title.ends_with("【技")
                    || session.title.ends_with('【'))
        })
        .peekable();
    if candidates.peek().is_none() {
        return Ok(());
    }
    let selection_count = if text_only_schema(db)? {
        "0"
    } else {
        "(SELECT count(*) FROM chat_message_skill_selections k
          WHERE k.message_id=b.message_id AND k.block_ordinal=b.block_ordinal)"
    };
    // The migration ledger distinguishes older unstructured messages even
    // after upgrade. The original single-text submission has no block rows.
    let mut statement = db.prepare(&format!(
        "SELECT CASE WHEN b.message_id IS NULL THEN m.content ELSE b.text_content END,
                {selection_count}, a.safe_name,
                b.message_id IS NULL OR NOT EXISTS (SELECT 1 FROM chat_schema_migrations
                    WHERE version=?4 AND applied_at<=m.created_at)
         FROM chat_sessions s JOIN chat_messages m ON m.session_id=s.id AND m.ordinal=0 AND m.role='user'
         LEFT JOIN chat_message_content_blocks b ON b.message_id=m.id
         LEFT JOIN chat_attachments a ON a.id=b.attachment_id AND a.message_id=m.id
         WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 ORDER BY b.block_ordinal"
    )).map_err(map_sqlite_error)?;
    for session in candidates {
        let blocks = statement
            .query_map(
                params![
                    session.session_id.to_string(),
                    scope.owner_user_id,
                    scope.tenant_id,
                    SELECTED_SKILLS_SCHEMA_VERSION
                ],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        usize::from(row.get::<_, u16>(1)?),
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, bool>(3)?,
                    ))
                },
            )
            .and_then(Iterator::collect::<rusqlite::Result<Vec<_>>>)
            .map_err(map_sqlite_error)?;
        let text_only = blocks.first().is_some_and(|block| block.3);
        let texts = blocks
            .iter()
            .filter_map(|(text, count, _, _)| Some((text.as_deref()?, *count)));
        if let Some(body) = cleaned_prose(texts, text_only) {
            let title = if body.trim().is_empty() {
                blocks
                    .iter()
                    .find_map(|(_, _, name, _)| name.as_deref())
                    .unwrap_or(SKILL_ONLY_TITLE)
            } else {
                &body
            };
            session.title = fallback_title(title);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_titles_remove_only_selected_markers_and_preserve_surrounding_prose() {
        let text = r#"先【技能2 "带】和\"的名字"】比价，再【技能1 $market:review】写标题"#;
        assert_eq!(prose(text, 2, false), "先比价，再写标题");
        assert_eq!(prose("【技能1 $market:review】", 1, false), "");
        assert_eq!(
            prose("$100\n\n请【技能1 $review】分析", 1, false),
            "$100\n\n请分析"
        );
        let example = "示例【技能1 $copywriting】";
        assert_eq!(prose(example, 0, false), example);
        assert_eq!(prose("【技能2 $example】", 1, false), "【技能2 $example】");
        let repeated = "示例【技能1 $test】，然后【技能1 $test】";
        assert_eq!(prose(repeated, 1, false), repeated);
    }

    #[test]
    fn skill_titles_use_the_legacy_mention_body_before_normal_title_truncation() {
        let body = format!("📦{}", "选品".repeat(30));
        let prompt = format!("$copywriting $market:compare\n\n{body}");
        assert_eq!(
            fallback_title(&prose(&prompt, 2, false)),
            fallback_title(&body)
        );
        assert_eq!(legacy_title(&prompt), fallback_title(&body));
        assert_eq!(legacy_title("$market:compare"), SKILL_ONLY_TITLE);
        let family = "👨‍👩‍👧‍👦";
        let emoji_prompt = format!("【技能1 $review】{}", family.repeat(40));
        assert_eq!(
            fallback_title(&prose(&emoji_prompt, 1, false)),
            family.repeat(36)
        );
        assert_eq!(
            legacy_title("先【技能2 $notes】分析，再【技能1 $review】核对"),
            "先分析，再核对"
        );
        let literal = "示例【技能3 $example】";
        assert_eq!(legacy_title(literal), literal);
        for plain in [
            "跨境选品技能",
            "预算 $100",
            "$100\n\n预算说明",
            "【技能教学】入门",
        ] {
            assert_eq!(prose(plain, 0, false), plain);
            assert_eq!(prose(plain, 0, true), plain);
        }
    }
}
