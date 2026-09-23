use super::*;
use crate::chat::schedules::{timing, timing_generated::*};
use serde_json::json;

fn fact(target: &timing::Target) -> NativeTurnTiming {
    serde_json::from_value(json!({"schema_version":1,"source":"runtime_read","agent_session_id":target.session,"thread_id":target.thread,"turn_id":target.turn,"started_at":{"state":"known","value":0},"completed_at":{"state":"known","value":0},"duration_ms":{"state":"known","value":440}})).unwrap()
}
#[test]
fn feat155_4d1_exact_binding_partial_conflict_and_finite_reads() {
    let root = Temp::new();
    let n = now().unwrap();
    let a = ScheduleAuthority::local(n).unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::TimingFoundation);
    let (run, _, _, _) = recovery_fixture(&mut r, n);
    let (t, rev) = r.timing_due(&a, n).unwrap().unwrap();
    assert_eq!(t.run, run.run_id);
    let outbox = count(&r, "chat_outbox");
    let held = guard::held(&r.connection).unwrap();
    for at in [n, n + 1, n + 6] {
        let (target, revision) = r.timing_due(&a, at).unwrap().unwrap();
        r.timing_commit(&a, &target, revision, None, at).unwrap();
    }
    assert!(r.timing_due(&a, n + 100).unwrap().is_none());
    assert_eq!(
        r.timing_view(&run.run_id, false, false, "UTC").unwrap()["execution_time"],
        "unknown"
    );
    r.timing_request(&a, std::slice::from_ref(&run.run_id), n + 101)
        .unwrap();
    let (_, rev2) = r.timing_due(&a, n + 101).unwrap().unwrap();
    assert!(rev2 > rev);
    r.timing_commit(&a, &t, rev, Some(fact(&t)), n + 101)
        .unwrap(); // superseded attempt is inert
    assert_eq!(
        r.timing_view(&run.run_id, false, false, "UTC").unwrap()["execution_time"],
        "unknown"
    );
    let mut partial = fact(&t);
    partial.duration_ms = DurationMsFact {
        state: TimeFieldState::Unknown,
        value: None,
    };
    r.timing_commit(&a, &t, rev2, Some(partial.clone()), n + 101)
        .unwrap();
    assert_eq!(
        r.timing_view(&run.run_id, false, true, "UTC").unwrap()["duration"],
        "in_progress"
    );
    r.timing_commit(&a, &t, rev2, Some(fact(&t)), n + 102)
        .unwrap();
    let v = r.timing_view(&run.run_id, false, false, "UTC").unwrap();
    assert_eq!(v["started_at"], 0);
    assert_eq!(v["duration_ms"], 440);
    r.timing_commit(&a, &t, rev2, Some(partial), n + 103)
        .unwrap();
    assert_eq!(
        r.timing_view(&run.run_id, false, false, "UTC").unwrap()["duration_ms"],
        440
    );
    let mut conflict = fact(&t);
    conflict.duration_ms.value = Some(999);
    r.timing_commit(&a, &t, rev2, Some(conflict), n + 104)
        .unwrap();
    let v = r.timing_view(&run.run_id, false, false, "UTC").unwrap();
    assert_eq!(v["duration"], "unknown");
    assert!(v.get("duration_ms").is_none());
    assert_eq!(v["diagnostic"], "source_conflict");
    assert_eq!(count(&r, "chat_outbox"), outbox);
    assert_eq!(guard::held(&r.connection).unwrap(), held);
}

#[test]
fn feat155_4d1_released_terminal_reopens_and_deleted_target_cannot_accept_clock() {
    use crate::chat::native_conversation_generated::{NativeThreadSnapshot, NativeTurn};
    let root = Temp::new();
    let n = now().unwrap();
    let a = ScheduleAuthority::local(n).unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::SingleRunFoundation);
    let (run, chat, rt, thread) = recovery_fixture(&mut r, n);
    let (_, _, _, local) = binding(&r, &run);
    let local = Uuid::parse_str(&local).unwrap();
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::TimingFoundation);
    assert_eq!(
        count(&r, "chat_scheduled_timing"),
        0,
        "migration fabricated old clock"
    );
    r.native_recovery_views(
        chat,
        &[local],
        Some(&NativeThreadSnapshot {
            schema_version: 2,
            source: "runtime_read".into(),
            thread_id: thread.to_string(),
            turns: vec![NativeTurn {
                id: rt.to_string(),
                status: Some("completed".into()),
                error_code: None,
                items: vec![],
                items_complete: false,
                error: None,
            }],
            availability: "partial".into(),
        }),
        true,
    )
    .unwrap();
    assert!(!guard::held(&r.connection).unwrap());
    let (t, revision) = r.timing_due(&a, n).unwrap().unwrap();
    r.timing_commit(&a, &t, revision, Some(fact(&t)), n)
        .unwrap();
    let v = r
        .timing_view(&run.run_id, false, false, "Asia/Shanghai")
        .unwrap();
    drop(r);
    let r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(
        r.timing_view(&run.run_id, false, false, "Asia/Shanghai")
            .unwrap(),
        v
    );
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::TimingFoundation);
    // Declared deleted binding fixture; never delete reservations to manufacture release.
    r.connection
        .execute(
            "UPDATE chat_scheduled_run_bindings SET target_deleted=1 WHERE run_id=?1",
            [&run.run_id],
        )
        .unwrap();
    assert!(r.timing_target(&a, &run.run_id, n).unwrap().is_none());
    assert!(r
        .timing_commit(&a, &t, revision, Some(fact(&t)), n)
        .is_err());
    assert_eq!(
        r.timing_view(&run.run_id, false, false, "Asia/Shanghai")
            .unwrap(),
        v
    );
}
