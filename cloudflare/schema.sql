CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, id TEXT NOT NULL, content TEXT, deleted INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL, PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, time_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON attempts(ip,time_ms);
CREATE INDEX IF NOT EXISTS idx_records_store_deleted ON records(store,deleted);
