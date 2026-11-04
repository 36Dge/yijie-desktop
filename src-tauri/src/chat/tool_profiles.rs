//! Immutable new-chat preference, persisted in the existing submission transaction.
//! No tool lists, execution state, native features or budgets are maintained here.
pub(crate) use super::connectors::selection_generated::ToolProfile;
use super::{
    database::{ChatRepository, ChatScope},
    error::ChatError,
    migrations,
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

fn database(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}

pub(crate) fn normalized(value: Option<ToolProfile>) -> Option<ToolProfile> {
    match value {
        Some(ToolProfile::Light) => value,
        Some(ToolProfile::Full) | None => None,
    }
}

pub(crate) fn read(
    db: &Connection,
    scope: &ChatScope,
    session: Uuid,
) -> Result<Option<ToolProfile>, ChatError> {
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![session.to_string(),scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(database)?;
    if !exists {
        return Err(ChatError::NotFound);
    }
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(database)?;
    if version < migrations::TOOL_PROFILES_SCHEMA_VERSION {
        return Ok(None);
    }
    let profile: Option<String> = db
        .query_row(
            "SELECT tool_profile FROM chat_session_tool_profiles WHERE session_id=?1",
            [session.to_string()],
            |r| r.get(0),
        )
        .optional()
        .map_err(database)?;
    match profile.as_deref() {
        None => Ok(None),
        Some("light") => Ok(Some(ToolProfile::Light)),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

pub(crate) fn bind_new(
    db: &Connection,
    scope: &ChatScope,
    session: Uuid,
    selected: Option<ToolProfile>,
    fresh: bool,
) -> Result<(), ChatError> {
    let selected = normalized(selected);
    if selected.is_some() && !super::models::v2_enabled() {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if fresh && selected.is_some() {
        let version: i64 = db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(database)?;
        if version < migrations::TOOL_PROFILES_SCHEMA_VERSION {
            return Err(ChatError::OrchestrationUnavailable);
        }
        db.execute(
            "INSERT INTO chat_session_tool_profiles(session_id,tool_profile) VALUES(?1,'light')",
            [session.to_string()],
        )
        .map_err(database)?;
    }
    if read(db, scope, session)? != selected {
        return Err(ChatError::ConversationConflict);
    }
    Ok(())
}

impl ChatRepository {
    pub(crate) fn session_tool_profile(
        &self,
        session: Uuid,
    ) -> Result<Option<ToolProfile>, ChatError> {
        read(&self.connection, &self.scope, session)
    }

    pub(crate) fn model_operation_tool_profile(
        &self,
        operation: Uuid,
    ) -> Result<Option<ToolProfile>, ChatError> {
        let exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='chat_operation_models')",
                [],
                |r| r.get(0),
            )
            .map_err(database)?;
        if !exists {
            return Ok(None);
        }
        let session: Option<String>=self.connection.query_row("SELECT m.session_id FROM chat_operation_models m JOIN chat_sessions s ON s.id=m.session_id WHERE m.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(database)?;
        session
            .map(|id| {
                self.session_tool_profile(
                    Uuid::parse_str(&id).map_err(|_| ChatError::DatabaseUnavailable)?,
                )
            })
            .transpose()
            .map(Option::flatten)
    }
}
