//! FEAT-155 candidate foundation and private management IPC. Ordinary startup stays read-only.
mod execution;
pub mod execution_generated;
pub(crate) mod execution_guard;
pub mod generated;
pub(crate) mod recovery;
pub mod recovery_generated;
pub(crate) use execution::{dispatch, ScheduleAuthority};
pub(crate) use execution::{single, triggers};
pub use execution::{EnableReceipt, RerunConfirmation, RerunPreview, ScheduleExecutionService};
mod store;
pub mod time;
pub(crate) mod workspace;

pub(super) use store::invalidate_targets;
pub use store::{ScheduleService, ScheduleStorageMode};

#[cfg(test)]
mod tests;

pub(crate) mod ipc;
pub(crate) mod ipc_commands_generated;
#[allow(dead_code)]
pub(crate) mod ipc_generated;

#[allow(dead_code)]
pub(crate) mod draft_generated;
pub(crate) mod drafts;

pub(crate) mod candidate;
pub(crate) mod draft_admission;
pub(crate) mod draft_recovery;
pub(crate) mod draft_runtime;

pub(crate) mod automatic;
pub(crate) mod manual;
pub(crate) mod timing;
#[allow(dead_code)]
pub(crate) mod timing_generated;
pub(crate) mod timing_runtime;
