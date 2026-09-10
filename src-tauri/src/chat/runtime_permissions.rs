use super::error::ChatError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    #[default]
    Ask,
    Auto,
    Full,
}

impl PermissionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Auto => "auto",
            Self::Full => "full",
        }
    }
    pub fn parse(value: &str) -> Result<Self, ChatError> {
        match value {
            "ask" => Ok(Self::Ask),
            "auto" => Ok(Self::Auto),
            "full" => Ok(Self::Full),
            _ => Err(ChatError::DatabaseUnavailable),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionState {
    pub mode: PermissionMode,
    pub full_access_confirmed: bool,
    pub busy: bool,
}

// Same-source adapter for the dedicated Host Runtime permissions OpenAPI.
// Neither raw JSON-RPC IDs nor raw commands are persisted in this projection.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeApproval {
    pub id: uuid::Uuid,
    pub kind: String,
    pub summary: String,
    pub scope: String,
    pub reason: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp: Option<super::native_conversation_generated::McpApprovalScope>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeApprovalSnapshot {
    pub requests: Vec<RuntimeApproval>,
}

impl RuntimeApprovalSnapshot {
    pub fn validate(&self) -> Result<(), ChatError> {
        let mut ids = std::collections::HashSet::new();
        if self.requests.len() > 128 {
            return Err(ChatError::OrchestrationUnavailable);
        }
        for item in &self.requests {
            let mcp_valid = match &item.mcp {
                Some(scope) => {
                    item.kind == "mcp"
                        && scope.server == "sorftime"
                        && scope.tool == "product_detail"
                        && scope.marketplace == "US"
                        && scope.asin.len() == 10
                        && scope
                            .asin
                            .bytes()
                            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
                }
                None => item.kind != "mcp",
            };
            if !mcp_valid
                || (item.status == "cancelled" && item.kind != "mcp")
                || item.id.is_nil()
                || !ids.insert(item.id)
                || ![
                    "command",
                    "file_change",
                    "permissions",
                    "auto_review",
                    "mcp",
                ]
                .contains(&item.kind.as_str())
                || ![
                    "pending",
                    "approved",
                    "rejected",
                    "unavailable",
                    "cancelled",
                ]
                .contains(&item.status.as_str())
                || [&item.summary, &item.scope, &item.reason]
                    .iter()
                    .any(|s| s.len() > 16384)
            {
                return Err(ChatError::OrchestrationUnavailable);
            }
        }
        Ok(())
    }
}

pub fn enabled() -> bool {
    std::env::var("YIJIE_RUNTIME_PERMISSIONS_ENABLED").as_deref() == Ok("true")
        && crate::local_profile::LocalRuntimeProfile::from_environment()
            .is_ok_and(|p| p.is_demo_fast())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feat152_permission_state_matches_private_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../schemas/chat-runtime-permissions-v1.schema.json"
        ))
        .unwrap();
        let state = PermissionState {
            mode: PermissionMode::Auto,
            full_access_confirmed: false,
            busy: false,
        };
        let value = serde_json::to_value(&state).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"mode":"auto","fullAccessConfirmed":false,"busy":false})
        );
        for key in schema["definitions"]["PermissionState"]["required"]
            .as_array()
            .unwrap()
        {
            assert!(value.get(key.as_str().unwrap()).is_some());
        }
        assert_eq!(
            schema["definitions"]["PermissionMode"]["enum"],
            serde_json::json!(["ask", "auto", "full"])
        );
    }
}
