/**
 * SQLite storage (better-sqlite3). Plain portable SQL so the same schema moves to Postgres later
 * (TEXT/INTEGER/REAL only, ISO timestamps, JSON stored as TEXT -> jsonb).
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS outbox (
     id TEXT PRIMARY KEY, entity TEXT NOT NULL, record_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, payload_json TEXT NOT NULL,
     status TEXT NOT NULL, priority INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, action TEXT,
     tally_guid TEXT, tally_master_id INTEGER, voucher_number TEXT, request_xml TEXT, response_xml TEXT,
     locked_until TEXT, next_attempt_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT);
   CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, priority, created_at);
   CREATE TABLE IF NOT EXISTS tally_objects (
     entity TEXT NOT NULL, guid TEXT NOT NULL, name TEXT NOT NULL, parent TEXT, masterid INTEGER, alterid INTEGER,
     data_json TEXT NOT NULL, raw_xml TEXT NOT NULL, raw_json TEXT NOT NULL, pulled_at TEXT NOT NULL, PRIMARY KEY (entity, guid));
   CREATE TABLE IF NOT EXISTS schema_fields (
     entity TEXT NOT NULL, path TEXT NOT NULL, occurrences INTEGER NOT NULL, sample_value TEXT, tally_type TEXT,
     first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (entity, path));
   CREATE TABLE IF NOT EXISTS pull_state (entity TEXT PRIMARY KEY, last_alterid INTEGER, last_pulled_at TEXT, last_count INTEGER, last_full INTEGER);
   CREATE TABLE IF NOT EXISTS agent_status (id INTEGER PRIMARY KEY, status_json TEXT NOT NULL, received_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, entity TEXT, status TEXT NOT NULL, message TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS sync_requests (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, entity TEXT, full INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
     requested_at TEXT NOT NULL, picked_at TEXT, finished_at TEXT, summary TEXT, result_json TEXT, error TEXT);
   CREATE INDEX IF NOT EXISTS sync_requests_status ON sync_requests(status, requested_at);`
]

const g = globalThis as unknown as { __tsdb?: Database.Database }

export function db(): Database.Database {
  if (g.__tsdb) return g.__tsdb
  const file = path.resolve(process.env.DATABASE_PATH ?? './data/tallysync.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const d = new Database(file)
  d.pragma('journal_mode = WAL')
  d.pragma('busy_timeout = 5000')
  d.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)')
  const done = new Set(d.prepare('SELECT n FROM _migrations').all().map((r: any) => r.n))
  MIGRATIONS.forEach((sql, i) => { if (!done.has(i)) d.transaction(() => { d.exec(sql); d.prepare('INSERT INTO _migrations (n) VALUES (?)').run(i) })() })
  g.__tsdb = d
  return d
}

export const now = () => new Date().toISOString()
export const J = (s: string | null | undefined) => (s ? JSON.parse(s) : null)

export function getSetting(key: string): string | undefined {
  return (db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value
}
export function setSetting(key: string, value: string | null) {
  if (value === null) db().prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
export function syncLog(kind: string, entity: string | null, status: string, message: string) {
  db().prepare('INSERT INTO sync_log (at, kind, entity, status, message) VALUES (?, ?, ?, ?, ?)').run(now(), kind, entity, status, message)
}
