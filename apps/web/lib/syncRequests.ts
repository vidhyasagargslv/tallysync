/** Manual sync requests created from the UI and executed by the agent (polled every few seconds). */
import crypto from 'node:crypto'
import { PULL_ENTITIES } from '@tallysync/contracts'
import { z } from 'zod'
import { J, db, now, syncLog } from './db'

export const SYNC_TYPES = ['sync', 'push', 'pull', 'pull_entity', 'full_repull'] as const
export const CreateSyncRequestZ = z.object({ type: z.enum(SYNC_TYPES), entity: z.enum(PULL_ENTITIES).optional(), full: z.boolean().optional() })
  .refine((r) => r.type !== 'pull_entity' || !!r.entity, 'entity is required for pull_entity')
export const CommandReportZ = z.object({
  status: z.enum(['running', 'done', 'failed']), summary: z.string().optional(), error: z.string().optional(), result: z.record(z.any()).optional()
})

/** Not picked up within this many seconds -> expired (agent offline). */
const ttlSec = () => Number(process.env.SYNC_REQUEST_TTL_SEC ?? 120)
export const OFFLINE_HINT = 'agent offline - use Sync now on the Tally PC (http://127.0.0.1:4100) or run tallysync-agent.exe sync-once'

const view = (r: any) => r && ({
  id: r.id, type: r.type, entity: r.entity, full: !!r.full, status: r.status, requestedAt: r.requested_at, pickedAt: r.picked_at,
  finishedAt: r.finished_at, summary: r.summary, result: J(r.result_json), error: r.error
})

export function expireStale() {
  const cutoff = new Date(Date.now() - ttlSec() * 1000).toISOString()
  const rows = db().prepare("SELECT id, type FROM sync_requests WHERE status = 'requested' AND requested_at < ?").all(cutoff) as any[]
  for (const r of rows) {
    db().prepare("UPDATE sync_requests SET status = 'expired', finished_at = ?, error = ? WHERE id = ? AND status = 'requested'").run(now(), OFFLINE_HINT, r.id)
    syncLog('manual', null, 'error', `${r.type} request expired: ${OFFLINE_HINT}`)
  }
}

export function createRequest(input: unknown) {
  const b = CreateSyncRequestZ.parse(input)
  const id = crypto.randomUUID()
  db().prepare("INSERT INTO sync_requests (id, type, entity, full, status, requested_at) VALUES (?, ?, ?, ?, 'requested', ?)")
    .run(id, b.type, b.entity ?? null, b.full ? 1 : 0, now())
  syncLog('manual', b.entity ?? null, 'ok', `${b.type}${b.entity ? ` ${b.entity}` : ''} requested from the web app`)
  return getRequest(id)
}
export function getRequest(id: string) { expireStale(); return view(db().prepare('SELECT * FROM sync_requests WHERE id = ?').get(id)) }
export function listRequests(limit = 20) { expireStale(); return (db().prepare('SELECT * FROM sync_requests ORDER BY requested_at DESC LIMIT ?').all(limit) as any[]).map(view) }

/** Agent: requests to run now. Returned once (marked picked); the agent then reports running/done/failed. */
export function pendingCommands() {
  expireStale()
  return db().transaction(() => {
    const rows = db().prepare("SELECT * FROM sync_requests WHERE status = 'requested' ORDER BY requested_at LIMIT 5").all() as any[]
    for (const r of rows) db().prepare("UPDATE sync_requests SET status = 'picked', picked_at = ? WHERE id = ?").run(now(), r.id)
    return rows.map((r) => ({ id: r.id, type: r.type, entity: r.entity, full: !!r.full }))
  })()
}
export function reportCommand(id: string, input: unknown) {
  const b = CommandReportZ.parse(input)
  const row = db().prepare('SELECT * FROM sync_requests WHERE id = ?').get(id) as any
  if (!row) return null
  const fin = b.status === 'running' ? null : now()
  db().prepare('UPDATE sync_requests SET status = ?, picked_at = COALESCE(picked_at, ?), finished_at = ?, summary = COALESCE(?, summary), result_json = COALESCE(?, result_json), error = ? WHERE id = ?')
    .run(b.status, now(), fin, b.summary ?? null, b.result ? JSON.stringify(b.result) : null, b.error ?? null, id)
  if (b.status !== 'running') syncLog('manual', row.entity, b.status === 'done' ? 'ok' : 'error', `${row.type}: ${b.status}${b.summary ? ` - ${b.summary}` : ''}${b.error ? ` - ${b.error}` : ''}`)
  return getRequest(id)
}
