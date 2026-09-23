//! Read-only clock work owned by the existing Coordinator lifecycle.
use super::timing_generated::NativeTurnTiming;
use crate::chat::{
    authorization::ChatAuthorizationManager,
    error::ChatError,
    host_bridge::HostBridge,
    lifecycle::{Lifecycle, Phase},
    worker::DatabaseWorker,
};
use crate::native_auth::NativeAuthRuntime;
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;
use uuid::Uuid;

type UiRead = Option<(ChatAuthorizationManager, Uuid)>;
fn now() -> Result<i64, ChatError> {
    super::execution::now().map_err(|_| ChatError::DatabaseUnavailable)
}
fn observation(lifecycle: &Lifecycle, epoch: u64) -> Result<(), ChatError> {
    if lifecycle.epoch() != epoch
        || !matches!(
            lifecycle.phase(),
            Phase::ReadyForObservation | Phase::Recovering
        )
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    Ok(())
}
fn read_scope<T>(
    repo: &mut crate::chat::database::ChatRepository,
    auth: &NativeAuthRuntime,
    ui: &UiRead,
    f: impl FnOnce(
        &mut crate::chat::database::ChatRepository,
        &super::ScheduleAuthority,
        i64,
    ) -> Result<T, ChatError>,
) -> Result<T, ChatError> {
    let n = now()?;
    let a = auth
        .schedule_authority(n)
        .map_err(|_| ChatError::ScopeDenied)?;
    if let Some((ui, context)) = ui {
        let scope = repo.scope.clone();
        ui.with_schedule_context(*context, &scope, false, false, n, |_, revision| {
            if revision != a.revision as u64 {
                return Err(ChatError::ScopeDenied);
            }
            f(repo, &a, n)
        })
        .map_err(|_| ChatError::ScopeDenied)?
    } else {
        f(repo, &a, n)
    }
}
pub(crate) async fn queue(
    worker: &DatabaseWorker,
    auth: NativeAuthRuntime,
    ui: UiRead,
    ids: Vec<String>,
) -> Result<(), ChatError> {
    worker
        .call(move |r| read_scope(r, &auth, &ui, |r, a, n| r.timing_request(a, &ids, n)))
        .await?;
    worker.timing_changed.notify_one();
    Ok(())
}
pub(crate) async fn collect_one(
    worker: &DatabaseWorker,
    host: &HostBridge,
    auth: NativeAuthRuntime,
    lifecycle: Lifecycle,
    ui: UiRead,
    run: Option<String>,
) -> Result<bool, ChatError> {
    // All UI/background reads share a single lane; a busy lane returns cached UI.
    let Ok(_lane) = worker.timing_lane.try_lock() else {
        return Ok(false);
    };
    let epoch = lifecycle.epoch();
    observation(&lifecycle, epoch)?;
    let before = auth.clone();
    let before_ui = ui.clone();
    let gate = lifecycle.clone();
    let selected = worker
        .call(move |r| {
            observation(&gate, epoch)?;
            read_scope(r, &before, &before_ui, |r, a, n| {
                if let Some(run) = run {
                    r.timing_request(a, std::slice::from_ref(&run), n)?;
                    r.timing_specific(a, &run, n)
                } else {
                    r.timing_due(a, n)
                }
            })
        })
        .await?;
    let Some((target, revision)) = selected else {
        return Ok(false);
    };
    let value: Option<NativeTurnTiming> = host
        .read_native_turn_timing(target.session, target.turn)
        .await
        .ok();
    worker
        .call(move |r| {
            observation(&lifecycle, epoch)?;
            read_scope(r, &auth, &ui, |r, a, n| {
                r.timing_commit(a, &target, revision, value, n)
            })
        })
        .await?;
    Ok(true)
}
pub(crate) async fn run_collector(
    worker: DatabaseWorker,
    host: Arc<HostBridge>,
    auth: NativeAuthRuntime,
    lifecycle: Lifecycle,
    mut stop: watch::Receiver<bool>,
) {
    if !worker
        // Observation uses the candidate cache writer, never a transient send
        // admission installed on a dispatch-specific HostBridge clone.
        .call(|r| Ok(r.schedule_timing_writes_enabled && super::timing::present(&r.connection)?))
        .await
        .unwrap_or(false)
    {
        return;
    }
    let mut seeded_epoch = None;
    loop {
        if *stop.borrow()
            || matches!(
                lifecycle.phase(),
                Phase::Stopping | Phase::StopPending | Phase::Stopped
            )
        {
            return;
        }
        let epoch = lifecycle.epoch();
        if matches!(
            lifecycle.phase(),
            Phase::Recovering | Phase::ReadyForObservation
        ) && seeded_epoch != Some(epoch)
        {
            let auth = auth.clone();
            let gate = lifecycle.clone();
            let result = worker
                .call(move |r| {
                    observation(&gate, epoch)?;
                    read_scope(r, &auth, &None, |r, a, n| r.timing_seed(a, n))
                })
                .await;
            if result.is_ok() {
                seeded_epoch = Some(epoch)
            }
        }
        tokio::select! {
            changed=stop.changed()=>{if changed.is_err()||*stop.borrow(){return}},
            _=collect_one(&worker,&host,auth.clone(),lifecycle.clone(),None,None)=>{}
        }
        tokio::select! {
            changed=stop.changed()=>{if changed.is_err()||*stop.borrow(){return}},
            _=worker.timing_changed.notified()=>{},
            _=tokio::time::sleep(Duration::from_secs(1))=>{}
        }
    }
}
