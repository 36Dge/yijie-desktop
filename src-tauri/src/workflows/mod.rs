//! FEAT-153 native-only local workflow adapter. It does not start Coze or depend on Chat/Host.
mod commands;
mod config;
#[allow(dead_code)]
mod generated;
mod runtime;
mod transport;
mod validation;
mod window;

pub(crate) use commands::*;
pub(crate) use runtime::WorkflowRuntime;
pub(crate) use window::create_main_window;

pub(crate) fn exact_local_enabled() -> bool {
    exact_local_settings(
        std::env::var("YIJIE_ENV").ok().as_deref(),
        std::env::var("YIJIE_LOCAL_PROFILE").ok().as_deref(),
        std::env::var("YIJIE_WORKFLOW_ENABLED").ok().as_deref(),
    )
}

fn exact_local_settings(
    environment: Option<&str>,
    profile: Option<&str>,
    enabled: Option<&str>,
) -> bool {
    environment == Some("local") && profile == Some("demo_fast") && enabled == Some("true")
}

#[cfg(test)]
mod local_gate_tests {
    #[test]
    fn workflow_local_cleanup_and_window_gate_is_exact_and_opt_in() {
        assert!(super::exact_local_settings(
            Some("local"),
            Some("demo_fast"),
            Some("true")
        ));
        assert!(!super::exact_local_settings(
            Some("local"),
            Some("demo_fast"),
            None
        ));
        assert!(!super::exact_local_settings(
            Some("local"),
            Some("demo_fast"),
            Some("false")
        ));
        assert!(!super::exact_local_settings(
            Some("production"),
            Some("demo_fast"),
            Some("true")
        ));
    }
}

use generated::{ErrorCode, ErrorResponse};

fn error(code: ErrorCode) -> ErrorResponse {
    // Provider free-text errors, headers, paths, and credentials never become renderer errors.
    let message = match code {
        ErrorCode::ProfileDisabled => "本地工作流尚未启用",
        ErrorCode::ServiceUnavailable => "工作流服务暂不可用，请检查受管服务后重试",
        ErrorCode::Unauthorized => "当前本地身份不能执行此操作",
        ErrorCode::SessionExpired => "编辑会话已到期，请重新连接；未保存内容应保留",
        ErrorCode::ResourceNotFound => "工作流资源不存在或不可访问",
        ErrorCode::RevisionConflict => "草稿已更新，请保留当前内容并核对版本",
        ErrorCode::OperationConflict => "操作已登记或内容冲突，请先查询原操作",
        ErrorCode::InvalidDraft => "草稿尚不能执行，请检查节点和连线",
        ErrorCode::InputTooLarge => "工作流数据超过允许大小",
        ErrorCode::RunBusy => "已有工作流正在运行，请等待实际结果",
        ErrorCode::OperationUnknown => "操作结果尚不确定，请先查询原操作，不要重复提交",
        ErrorCode::ProtocolMismatch => "工作流协议或响应版本不兼容",
        ErrorCode::InvalidRequest => "工作流请求无效",
        ErrorCode::StorageUnavailable => "工作流存储暂不可用",
        ErrorCode::InternalError => "工作流服务处理失败",
    };
    ErrorResponse {
        code,
        message: message.to_owned(),
        operation_id: None,
    }
}
