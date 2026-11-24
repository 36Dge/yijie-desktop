use super::*;

#[test]
#[cfg(feature = "kimi-k31-pro-candidate")]
fn skill_titles_use_the_opening_question_for_new_and_reopened_sessions() {
    let root = std::env::temp_dir().join(format!("chat-skill-title-{}", Uuid::now_v7()));
    fs::create_dir(&root).unwrap();
    let owner = scope();
    let mut repo = open_repository_for_scope(&root, 71, owner.clone());
    let project = register_synthetic_project(&mut repo, &root);
    migrations::migrate_to_target(
        &mut repo.connection,
        migrations::SELECTED_SKILLS_SCHEMA_VERSION,
    )
    .unwrap();
    let question = "如何使用这个技能";
    let input =
        format!("【技能1 $yj-user-0123456789abcdef0123456789abcdef:listing-analysis】{question}");
    let blocks = vec![DraftContentBlock::SelectedText {
        text: input.clone(),
        skills: vec![SelectedSkillRef {
            id: "listing-analysis".into(),
            version: "1.0.0".into(),
        }],
    }];
    let op = Uuid::now_v7();
    let chat = repo
        .create_session_and_enqueue_multimodal(project, &blocks, op, 7)
        .unwrap();
    let id = chat.session_id;
    let stored_title = |repo: &ChatRepository| -> String {
        repo.connection
            .query_row(
                "SELECT title FROM chat_sessions WHERE id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert_eq!(stored_title(&repo), question);
    assert_eq!(
        repo.create_session_and_enqueue_multimodal(project, &blocks, op, 7)
            .unwrap(),
        chat
    );

    // Reopen the title spelling persisted by the previous desktop version.
    let old_title = fallback_title(&input);
    assert!(!old_title.contains('】'));
    repo.connection
        .execute(
            "UPDATE chat_sessions SET title=?1 WHERE id=?2",
            params![old_title, id.to_string()],
        )
        .unwrap();
    drop(repo);
    let mut repo = open_repository_for_scope(&root, 71, owner);
    let before = repo.connection.total_changes();
    assert_eq!(
        repo.list_sessions(None, None).unwrap().sessions[0].title,
        question
    );
    let summary = repo.session_summary(id).unwrap();
    assert_eq!(summary.title_source, SessionTitleSource::Fallback);
    assert_eq!(summary.title, question);
    assert_eq!(
        repo.load_history(id, None, None).unwrap().turns[0].messages[0].content,
        input
    );
    assert_eq!(stored_title(&repo), old_title);
    assert_eq!(repo.connection.total_changes(), before);

    let job = Uuid::now_v7();
    let model_title = "【技能1 $example】模型摘要";
    assert!(repo.enqueue_title_job(id, job).unwrap());
    assert!(repo.apply_model_title(id, job, model_title).unwrap());
    assert_eq!(repo.session_summary(id).unwrap().title, model_title);

    let custom = "【技能1 $示例】我起的标题";
    repo.rename_session(id, custom).unwrap();
    assert_eq!(
        repo.list_sessions(None, None).unwrap().sessions[0].title,
        custom
    );
    assert_eq!(repo.session_summary(id).unwrap().title, custom);
    drop(repo);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn skill_titles_preserve_text_only_history_and_use_the_attachment_when_prose_is_empty() {
    let root = std::env::temp_dir().join(format!("chat-legacy-skill-title-{}", Uuid::now_v7()));
    fs::create_dir(&root).unwrap();
    let mut repo = open_repository(&root, 72);
    let project = register_synthetic_project(&mut repo, &root);
    let header = "$listing-analysis\n\n如何使用这个技能";
    let classic = repo
        .create_session_and_enqueue(project, header, Uuid::now_v7())
        .unwrap();
    let inline = "先【技能1 $listing-analysis】查看商品";
    let old = repo
        .create_session_and_enqueue_multimodal(
            project,
            &[DraftContentBlock::Text(inline.into())],
            Uuid::now_v7(),
            1,
        )
        .unwrap();
    for (chat, text, expected) in [
        (classic, header, "如何使用这个技能"),
        (old, inline, "先查看商品"),
    ] {
        assert_eq!(
            repo.session_summary(chat.session_id).unwrap().title,
            expected
        );
        // Seed the fallback and timestamp a pre-selection-schema desktop stored.
        let id = chat.session_id.to_string();
        repo.connection
            .execute(
                "UPDATE chat_sessions SET title=?1 WHERE id=?2",
                params![fallback_title(text), id],
            )
            .unwrap();
        repo.connection
            .execute(
                "UPDATE chat_messages SET created_at=1 WHERE session_id=?1 AND ordinal=0",
                [&id],
            )
            .unwrap();
        assert_eq!(
            repo.session_summary(chat.session_id).unwrap().title,
            expected
        );
    }

    let marker = "【技能1 $listing-analysis】";
    let selected = DraftContentBlock::Text(marker.into());
    let chat = repo
        .create_session_and_enqueue_multimodal(
            project,
            std::slice::from_ref(&selected),
            Uuid::now_v7(),
            1,
        )
        .unwrap();
    assert_eq!(
        repo.session_summary(chat.session_id).unwrap().title,
        "技能对话"
    );

    let attachment = crate::chat::attachment::prepare_bytes(
        "选品清单.txt".to_owned(),
        b"Product list".to_vec(),
        unix_seconds().unwrap(),
    )
    .unwrap();
    let file = DraftContentBlock::File(attachment.id);
    repo.store_attachments(vec![attachment], 1, DraftTarget::New)
        .unwrap();
    let chat = repo
        .create_session_and_enqueue_multimodal(project, &[file, selected], Uuid::now_v7(), 1)
        .unwrap();
    assert_eq!(
        repo.session_summary(chat.session_id).unwrap().title,
        "选品清单.txt"
    );
    repo.connection
        .execute(
            "UPDATE chat_sessions SET title=?1 WHERE id=?2",
            params![marker, chat.session_id.to_string()],
        )
        .unwrap();
    assert_eq!(
        repo.session_summary(chat.session_id).unwrap().title,
        "选品清单.txt"
    );
    #[cfg(feature = "kimi-k31-pro-candidate")]
    {
        migrations::migrate_to_target(
            &mut repo.connection,
            migrations::SELECTED_SKILLS_SCHEMA_VERSION,
        )
        .unwrap();
        let sessions = repo.list_sessions(None, None).unwrap().sessions;
        assert!(sessions.iter().any(|s| s.title == "先查看商品"));
        assert!(sessions.iter().any(|s| s.title == "如何使用这个技能"));
        let literal = "【技能1 $listing-analysis】是文档里的示例";
        let plain = repo
            .create_session_and_enqueue_multimodal(
                project,
                &[DraftContentBlock::Text(literal.into())],
                Uuid::now_v7(),
                1,
            )
            .unwrap();
        assert_eq!(
            repo.session_summary(plain.session_id).unwrap().title,
            literal
        );
    }
    drop(repo);
    fs::remove_dir_all(root).unwrap();
}
