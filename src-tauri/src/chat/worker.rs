use super::database::{ChatRepository, ChatScope, ProjectSummary};
use super::error::ChatError;
use super::keychain::DatabaseKeyStore;
use std::path::PathBuf;
use std::sync::mpsc;
use tokio::sync::oneshot;

type DatabaseJob = Box<dyn FnOnce(&mut ChatRepository) + Send + 'static>;

#[derive(Clone)]
pub struct DatabaseWorker {
    sender: mpsc::Sender<DatabaseJob>,
}

impl DatabaseWorker {
    pub fn start(
        chat_directory: PathBuf,
        scope: ChatScope,
        key_store: Box<dyn DatabaseKeyStore>,
    ) -> Result<Self, ChatError> {
        let database_exists = ChatRepository::database_exists(&chat_directory);
        let key = key_store.load_or_create(database_exists)?;
        let repository = ChatRepository::open(&chat_directory, &key, scope)?;
        let (sender, receiver) = mpsc::channel::<DatabaseJob>();
        std::thread::Builder::new()
            .name("yijie-chat-database".to_owned())
            .spawn(move || {
                let mut repository = repository;
                while let Ok(job) = receiver.recv() {
                    job(&mut repository);
                }
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(Self { sender })
    }

    async fn call<T, F>(&self, operation: F) -> Result<T, ChatError>
    where
        T: Send + 'static,
        F: FnOnce(&mut ChatRepository) -> Result<T, ChatError> + Send + 'static,
    {
        let (result_sender, result_receiver) = oneshot::channel();
        self.sender
            .send(Box::new(move |repository| {
                let _ = result_sender.send(operation(repository));
            }))
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        result_receiver
            .await
            .map_err(|_| ChatError::DatabaseUnavailable)?
    }

    pub async fn schema_version(&self) -> Result<i64, ChatError> {
        self.call(|repository| repository.schema_version()).await
    }

    pub async fn register_project(
        &self,
        canonical_path: PathBuf,
        bookmark: Vec<u8>,
    ) -> Result<ProjectSummary, ChatError> {
        self.call(move |repository| repository.register_project(&canonical_path, &bookmark))
            .await
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>, ChatError> {
        self.call(|repository| repository.list_projects()).await
    }

    pub async fn project_bookmark(&self, project_id: String) -> Result<Vec<u8>, ChatError> {
        self.call(move |repository| repository.project_bookmark(&project_id))
            .await
    }

    pub async fn refresh_project(
        &self,
        project_id: String,
        canonical_path: PathBuf,
        bookmark: Vec<u8>,
    ) -> Result<ProjectSummary, ChatError> {
        self.call(move |repository| {
            repository.refresh_project(&project_id, &canonical_path, &bookmark)
        })
        .await
    }

    pub async fn remove_project(&self, project_id: String) -> Result<(), ChatError> {
        self.call(move |repository| repository.remove_project(&project_id))
            .await
    }
}
