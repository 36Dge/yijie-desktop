-- Forward reader guard: old binaries must not decode/write new Artifact MIME values.
CREATE TABLE chat_artifact_media_profile (version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO chat_artifact_media_profile(version) VALUES(1);
