package main

import (
	"encoding/json"
	bolt "go.etcd.io/bbolt"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalCopyPreserved(t *testing.T) {
	root, err := os.MkdirTemp(os.Getenv("FEAT164_D2_TEST_ROOT"), "d2-bolt-")
	if err != nil {
		t.Fatal(err)
	}
	inspection := filepath.Join(root, "inspection")
	home := filepath.Join(inspection, "host")
	if err = os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "sessions.db")
	db, err := bolt.Open(path, 0600, nil)
	if err != nil {
		t.Fatal(err)
	}
	err = db.Update(func(tx *bolt.Tx) error {
		b, e := tx.CreateBucket([]byte("metadata"))
		if e != nil {
			return e
		}
		if e = b.Put([]byte("schema_version"), []byte("10")); e != nil {
			return e
		}
		b, e = tx.CreateBucket([]byte("sessions"))
		if e != nil {
			return e
		}
		row, e := json.Marshal(map[string]any{"task_id": "ordinary-native", "agent_session_id": "ordinary-host", "codex_thread_id": "ordinary-thread", "state": "idle", "model_selection_state": "ready"})
		if e != nil {
			return e
		}
		return b.Put([]byte("ordinary-host"), row)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	r, err := readCopy(inspection)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if hash(before) != hash(after) || r["schema_version"] != "10" || r["integrity_errors"] != 0 {
		t.Fatal("copy result")
	}
	if len(r["sessions"].([]map[string]any)) != 1 {
		t.Fatal("mapping missing")
	}
	if _, err = readCopy(root); err == nil {
		t.Fatal("non inspection root accepted")
	}
	t.Log("ordinary retained copy:", root)
}
