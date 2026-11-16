//! A request's original identity is retained even when its new execution
//! selection drops the retired web connector. No historical rewrite occurs.
use super::*;

pub(super) fn fresh(db:&Connection,scope:&ChatScope,refs:&[management::SelectionRef])->Result<Vec<management::SelectionRef>,ChatError>{
    let mut result=Vec::new();
    for reference in refs {
        let service:Option<String>=db.query_row("SELECT service_id FROM chat_connector_installations WHERE installation_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![reference.installation_id,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).optional().map_err(db_error)?;
        if service.as_deref()!=Some(crate::builtin_web::wire::RETIRED_SERVICE_ID){result.push(reference.clone())}
    }
    Ok(result)
}
pub(super) fn original(db:&Connection,operation:&str)->Result<Option<Vec<management::SelectionRef>>,ChatError>{
    let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_builtin_web_selection_origins')",[],|r|r.get(0)).map_err(db_error)?;
    if !exists{return Ok(None)}
    let saved:Option<String>=db.query_row("SELECT original_selection_json FROM chat_builtin_web_selection_origins WHERE submission_operation_id=?1 AND normalization_version=1",[operation],|r|r.get(0)).optional().map_err(db_error)?;
    saved.map(|v|serde_json::from_str(&v).map_err(|_|ChatError::DatabaseUnavailable)).transpose()
}
