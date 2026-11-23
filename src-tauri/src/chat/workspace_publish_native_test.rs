use super::*;
use crate::chat::host_domain::HostStreamEvent;
use crate::chat::keychain::{ProtectedDatabaseKeyStore, ProtectedReceiptKeyStore};
use crate::chat::sidecar::HostConnection;
use crate::chat::{native_project, ChatScope};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

/// Consumer half of the local cross-process registration check. All Host
/// events, downloads and ACKs use the same methods as an ordinary chat.
#[tokio::test]
#[ignore = "requires the paired local Host and native test workspace"]
async fn workspace_publish_native_receiver() {
    let dir = PathBuf::from(std::env::var_os("YIJIE_PUBLISH_TEST_DIR").unwrap());
    let workspace = PathBuf::from(std::env::var_os("YIJIE_PUBLISH_TEST_FILES").unwrap());
    let binding: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.join("connection.json")).unwrap()).unwrap();
    let agent: Uuid = binding["agent"].as_str().unwrap().parse().unwrap();
    let mut names: std::collections::BTreeSet<String> =
        serde_json::from_value(binding["files"].clone()).unwrap();
    let count = names.len();
    assert!((1..=MAX_ARTIFACTS_PER_TURN).contains(&count));
    assert!(names.iter().all(|name| valid_safe_name(name)));
    let reader: u8 = std::env::var("YIJIE_PUBLISH_TEST_READER")
        .unwrap()
        .parse()
        .unwrap();
    let bridge = Arc::new(
        HostBridge::from_connection(HostConnection {
            port: binding["port"].as_u64().unwrap().try_into().unwrap(),
            instance_nonce: binding["nonce"].as_str().unwrap().to_owned(),
            token_path: dir.join("host/api-token"),
        })
        .unwrap(),
    );
    let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
    let database = || {
        DatabaseWorker::start(
            dir.join("native-chat"),
            scope.clone(),
            Box::new(
                ProtectedDatabaseKeyStore::new_local_demo(dir.join("native-secrets/database"))
                    .unwrap(),
            ),
            Box::new(
                ProtectedReceiptKeyStore::new_local_demo(dir.join("native-secrets/receipt"))
                    .unwrap(),
            ),
        )
        .unwrap()
    };
    let db = database();
    let selected = native_project::create_selection(&workspace)
        .unwrap()
        .unwrap();
    let project = db
        .register_project(selected.canonical_path, selected.bookmark)
        .await
        .unwrap();
    let local = db
        .create_session_and_enqueue(
            project.id.parse().unwrap(),
            "普通文件登记验证".into(),
            Uuid::now_v7(),
        )
        .await
        .unwrap();
    let transfer = ArtifactTransferService::new(bridge.clone(), db.clone());
    let mut stream = bridge.open_event_stream_v3(agent, None).await.unwrap();
    stream.use_live_idle_timeout();
    fs::write(dir.join("native-reader-ready"), b"subscribed").unwrap();
    let mut deliveries = Vec::new();
    tokio::time::timeout(Duration::from_secs(100), async {
        let expected_turn: Uuid = loop {
            if let Ok(id) = fs::read_to_string(dir.join("turn-id")) {
                if let Ok(id) = id.parse() {
                    break id;
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        while deliveries.len() < count {
            let item = stream.next_stream_event().await.unwrap().unwrap();
            let HostStreamEvent::Artifact(wire) = item else {
                continue;
            };
            eprintln!(
                "v{reader} native received {} ordinal {}",
                wire.event_type, wire.payload["ordinal"]
            );
            assert_eq!(wire.schema_version, reader);
            let event = decode_artifact_event_envelope_v3(
                &wire,
                agent,
                expected_turn,
                local.session_id,
                local.turn_id,
            )
            .unwrap();
            let identity = match &event {
                ArtifactEventV3::Completed(m) => {
                    Some((m.artifact_id, m.kind, m.display_name.clone().unwrap()))
                }
                _ => None,
            };
            let outcome = transfer.ingest_event(event).await.unwrap();
            if let Some(record) = identity {
                assert!(outcome.unwrap().host_acknowledged);
                eprintln!("v{reader} native acknowledged {}", record.2);
                deliveries.push(record);
            }
        }
    })
    .await
    .expect("timed out waiting for real artifact events");
    drop(stream);
    drop(transfer);
    drop(db);
    let reopened = database();
    let now = unix_seconds().unwrap();
    let mut evidence = Vec::new();
    for (id, kind, name) in deliveries {
        assert!(names.remove(&name), "unexpected or duplicate artifact name");
        let mut range_reads = 0;
        let (bytes, size_bytes, sha256, media_type) = match kind {
            ArtifactKind::Image => {
                let content = reopened
                    .read_ready_image(local.session_id, local.turn_id, id, now)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(content.display_name.as_deref(), Some(name.as_str()));
                (
                    content.bytes,
                    content.size_bytes,
                    content.sha256,
                    content.media_type,
                )
            }
            ArtifactKind::Video => {
                let content = reopened
                    .read_ready_video(local.session_id, local.turn_id, id, now)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(content.display_name.as_deref(), Some(name.as_str()));
                const CHUNK: usize = 32 * 1024;
                for start in (0..content.size_bytes).step_by(CHUNK) {
                    let length = CHUNK.min(content.size_bytes - start);
                    let part = reopened
                        .read_ready_video_range(ReadyVideoRangeRequest {
                            session_id: local.session_id,
                            turn_id: local.turn_id,
                            artifact_id: id,
                            now,
                            expected_size: content.size_bytes,
                            expected_sha256: content.sha256,
                            start,
                            length,
                        })
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(part.bytes, content.bytes[start..start + length]);
                    range_reads += 1;
                }
                (
                    content.bytes,
                    content.size_bytes,
                    content.sha256,
                    content.media_type,
                )
            }
            ArtifactKind::File => {
                let content = reopened
                    .read_ready_file(local.session_id, local.turn_id, id, now, MAX_ARTIFACT_BYTES)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(content.display_name.as_deref(), Some(name.as_str()));
                (
                    content.bytes,
                    content.size_bytes,
                    content.sha256,
                    content.media_type,
                )
            }
            _ => panic!("unexpected artifact kind"),
        };
        let mut saved_as = PathBuf::from(if kind == ArtifactKind::File {
            super::super::artifact_file_native::canonical_file_save_name(Some(&name), media_type)
                .unwrap()
        } else {
            name.clone()
        });
        let export = dir.join("native-saved");
        if export.join(&saved_as).exists() {
            // Two independent artifacts may have the same suggested save name.
            fs::create_dir(export.join(id.to_string())).unwrap();
            saved_as = PathBuf::from(id.to_string()).join(saved_as);
        }
        let destination = export.join(&saved_as);
        if kind == ArtifactKind::File {
            super::super::artifact_file_native::atomic_save_file_bytes(
                &destination,
                media_type,
                &bytes,
                size_bytes,
                sha256,
                Uuid::now_v7(),
            )
            .unwrap();
        } else {
            super::super::artifact_native::atomic_save_content(
                &destination,
                &bytes,
                size_bytes,
                sha256,
                Uuid::now_v7(),
            )
            .unwrap();
        }
        let expected = fs::read(workspace.join(&name)).unwrap();
        assert_eq!(Sha256::digest(&bytes), Sha256::digest(&expected));
        assert_eq!(fs::read(destination).unwrap(), expected);
        evidence.push(serde_json::json!({
            "id": id, "name": name, "kind": kind.as_str(), "media_type": media_type,
            "saved_as": saved_as, "sha256": format!("{:x}", Sha256::digest(&bytes)),
            "bytes": bytes.len(), "range_reads": range_reads,
        }));
    }
    assert!(names.is_empty());
    fs::write(
        dir.join("native-saved.json"),
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
}
