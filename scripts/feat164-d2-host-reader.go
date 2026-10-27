// Read only a second inspection copy; never call the product OpenStore.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func hash(v []byte) string { h := sha256.Sum256(v); return hex.EncodeToString(h[:]) }
func textHash(v any) any {
	if s, ok := v.(string); ok && s != "" {
		return hash([]byte(s))
	}
	return nil
}
func readCopy(root string) (map[string]any, error) {
	actual, err := filepath.EvalSymlinks(root)
	if err != nil || actual != root || filepath.Base(root) != "inspection" {
		return nil, errors.New("inspection root required")
	}
	path := filepath.Join(root, "host", "sessions.db")
	actual, err = filepath.EvalSymlinks(path)
	if err != nil || actual != path {
		return nil, errors.New("regular copy required")
	}
	before, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{ReadOnly: true, Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	facts := map[string]string{}
	sessions := []map[string]any{}
	states := map[string]map[string]int{}
	version := ""
	integrity := 0
	err = db.View(func(tx *bolt.Tx) error {
		for range tx.Check() {
			integrity++
		}
		return tx.ForEach(func(n []byte, b *bolt.Bucket) error {
			return b.ForEach(func(k, v []byte) error {
				if v == nil {
					return errors.New("nested bucket requires review")
				}
				name := string(n)
				counts[name]++
				facts[name+":"+hash(k)] = hash(v)
				if name == "metadata" && string(k) == "schema_version" {
					version = string(v)
				}
				if name == "sessions" || strings.Contains(name, "operations") {
					var row map[string]any
					if err := json.Unmarshal(v, &row); err != nil {
						return err
					}
					if states[name] == nil {
						states[name] = map[string]int{}
					}
					for _, field := range []string{"state", "stage", "model_selection_state"} {
						if s, ok := row[field].(string); ok {
							states[name][field+":"+s]++
						}
					}
					if name == "sessions" {
						sessions = append(sessions, map[string]any{"task_id": textHash(row["task_id"]), "agent_session_id": textHash(row["agent_session_id"]), "codex_thread_id": textHash(row["codex_thread_id"]), "cwd_sha256": textHash(row["cwd"]), "active_turn": textHash(row["active_turn_id"]) != nil, "cleanup_operation": textHash(row["cleanup_operation_id"]) != nil, "model_selection_state": row["model_selection_state"], "state": row["state"]})
					}
				}
				return nil
			})
		})
	})
	closeErr := db.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	after, err := os.ReadFile(path)
	if err != nil || hash(before) != hash(after) {
		return nil, errors.New("copy changed")
	}
	return map[string]any{"read_only": true, "integrity_errors": integrity, "schema_version": version, "bucket_counts": counts, "value_fingerprints": facts, "sessions": sessions, "operation_states": states, "copy_sha256": hash(after)}, nil
}
func run() error {
	if len(os.Args) != 3 {
		return errors.New("inspection root and new output required")
	}
	result, err := readCopy(os.Args[1])
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(os.Args[2], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	ce := f.Close()
	if err != nil {
		return err
	}
	if ce != nil {
		return ce
	}
	summary, _ := json.Marshal(map[string]any{"read_only": true, "schema_version": result["schema_version"], "integrity_errors": result["integrity_errors"], "bucket_counts": result["bucket_counts"], "operation_states": result["operation_states"]})
	fmt.Println(string(summary))
	return nil
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "D2 Host read-only inspection failed; retain copy and review.")
		os.Exit(1)
	}
}
