/** Data access for the outbox (records going to Tally) and pulled Tally data. */
import crypto from 'node:crypto'
import {
  MasterDataZ, OBJECT_ENTITIES, PUSH_ENTITIES, VOUCHER_KINDS, VoucherZ,
  type Heartbeat, type IngestRequest, type PendingRecord, type PushEntity, type PushResult
} from '@tallysync/contracts'
import { flattenPaths, outstanding, stockByGodown, trialBalance } from '@tallysync/tally-core'
import { z } from 'zod'
import { J, db, now, setSetting, getSetting, syncLog } from './db'

const MAX_TRANSIENT_ATTEMPTS = 10
const isVoucher = (e: string) => (VOUCHER_KINDS as readonly string[]).includes(e)

export interface OutboxRow {
  id: string; entity: string; record_key: string; label: string; payload_json: string; status: string; priority: number; attempts: number
  error: string | null; action: string | null; tally_guid: string | null; tally_master_id: number | null; voucher_number: string | null
  request_xml: string | null; response_xml: string | null; created_at: string; updated_at: string; synced_at: string | null; next_attempt_at: string | null
}
export const recordView = (r: OutboxRow) => ({
  id: r.id, entity: r.entity, key: r.record_key, label: r.label, payload: J(r.payload_json), status: r.status, attempts: r.attempts, error: r.error,
  action: r.action, tallyGuid: r.tally_guid, tallyMasterId: r.tally_master_id, voucherNumber: r.voucher_number,
  createdAt: r.created_at, updatedAt: r.updated_at, syncedAt: r.synced_at
})

// ------------------------------------------------------------------ outbox
export const CreateRecordZ = z.object({ entity: z.enum(PUSH_ENTITIES), payload: z.record(z.any()) })

/** Create (or update + re-queue) a record. Same key = same Tally object, so the agent Alters instead of duplicating. */
export function createRecord(input: unknown) {
  const b = CreateRecordZ.parse(input)
  const isV = isVoucher(b.entity)
  const payload: any = isV ? VoucherZ.parse({ ...b.payload, kind: b.entity }) : (MasterDataZ as any)[b.entity].parse(b.payload)
  const key = isV ? `${b.entity}:${payload.number}` : `${b.entity}:${payload.name}`
  const label = isV ? `${payload.number} - ${payload.party}` : payload.name
  const t = now()
  const existing = db().prepare('SELECT * FROM outbox WHERE record_key = ?').get(key) as OutboxRow | undefined
  if (existing) {
    db().prepare("UPDATE outbox SET payload_json = ?, label = ?, status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL, locked_until = NULL, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(payload), label, t, existing.id)
    return { created: false, record: getRecord(existing.id)! }
  }
  const priority = isV ? 200 : ['group', 'unit', 'godown', 'stock_group'].includes(b.entity) ? 10 : 50
  const id = crypto.randomUUID()
  db().prepare(`INSERT INTO outbox (id, entity, record_key, label, payload_json, status, priority, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)`).run(id, b.entity, key, label, JSON.stringify(payload), priority, t, t)
  return { created: true, record: getRecord(id)! }
}
export function getRecord(id: string) {
  const r = db().prepare('SELECT * FROM outbox WHERE id = ?').get(id) as OutboxRow | undefined
  return r && { ...recordView(r), requestXml: r.request_xml, responseXml: r.response_xml }
}
export function listRecords(f: { entity?: string | null; status?: string | null } = {}) {
  let sql = 'SELECT * FROM outbox WHERE 1=1'
  const args: unknown[] = []
  if (f.entity) { sql += ' AND entity = ?'; args.push(f.entity) }
  if (f.status) { sql += ' AND status = ?'; args.push(f.status) }
  return (db().prepare(sql + ' ORDER BY created_at DESC LIMIT 500').all(...args) as OutboxRow[]).map(recordView)
}
export function retryRecord(id: string) {
  const r = db().prepare("UPDATE outbox SET status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL, locked_until = NULL, updated_at = ? WHERE id = ? AND status IN ('failed')").run(now(), id)
  return r.changes > 0
}
export function nextNumber(entity: string, prefix: string) {
  const n = (db().prepare('SELECT count(*) AS n FROM outbox WHERE entity = ?').get(entity) as any).n + 1001
  return `${prefix}-${n}`
}

/** Local master records a voucher depends on (party ledger + stock items). */
function voucherDeps(payload: any): string[] {
  return [`ledger:${payload.party}`, ...(payload.lines ?? []).map((l: any) => `stock_item:${l.item}`)]
}

/**
 * Agent: records waiting for Tally, masters first. A voucher that references a local master which is not
 * synced yet (and not in this same batch ahead of it) is held back with a "waiting for" note.
 * Claimed rows are leased for 5 minutes so a crashed agent doesn't lose them.
 */
export function claimPending(limit: number, entities: string[] | null = null): PendingRecord[] {
  if (entities && !entities.length) return []
  const t = now()
  const lease = new Date(Date.now() + 5 * 60_000).toISOString()
  return db().transaction(() => {
    const only = entities ? `entity IN (${entities.map(() => '?').join(',')}) AND ` : ''
    const rows = db().prepare(`SELECT * FROM outbox WHERE ${only}((status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
       OR (status = 'in_progress' AND locked_until < ?)) ORDER BY priority, created_at LIMIT ?`).all(...(entities ?? []), t, t, limit * 4) as OutboxRow[]
    const masterStatus = db().prepare('SELECT status FROM outbox WHERE record_key = ?')
    const hold = db().prepare('UPDATE outbox SET error = ?, updated_at = ? WHERE id = ?')
    const upd = db().prepare("UPDATE outbox SET status = 'in_progress', locked_until = ?, attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ?")
    const inBatch = new Set<string>()
    const out: PendingRecord[] = []
    for (const r of rows) {
      if (out.length >= limit) break
      if (isVoucher(r.entity)) {
        const waiting = voucherDeps(J(r.payload_json)).filter((k) => {
          const m = masterStatus.get(k) as { status: string } | undefined
          return m && m.status !== 'synced' && !inBatch.has(k)
        })
        if (waiting.length) {
          const note = `waiting for ${waiting.map((k) => k.replace(':', ' ')).join(', ')} to sync`
          if (r.error !== note) hold.run(note, t, r.id)
          continue
        }
      } else inBatch.add(r.record_key)
      upd.run(lease, t, r.id)
      out.push({ id: r.id, entity: r.entity as PushEntity, attempts: r.attempts + 1, payload: J(r.payload_json) })
    }
    return out
  })()
}

/** Edit a record: same Tally object (same key), new payload, re-queued; the agent Alters it. */
export function updateRecord(id: string, payload: unknown) {
  const row = db().prepare('SELECT * FROM outbox WHERE id = ?').get(id) as OutboxRow | undefined
  if (!row) return null
  const isV = isVoucher(row.entity)
  const p: any = isV ? VoucherZ.parse({ ...(payload as object), kind: row.entity }) : (MasterDataZ as any)[row.entity].parse(payload)
  const key = isV ? `${row.entity}:${p.number}` : `${row.entity}:${p.name}`
  if (key !== row.record_key) throw Object.assign(new Error(isV ? 'voucher number cannot be changed' : 'name cannot be changed (it identifies the object in Tally)'), { status: 400 })
  db().prepare("UPDATE outbox SET payload_json = ?, status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL, locked_until = NULL, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(p), now(), id)
  return getRecord(id)
}

export function applyResult(r: PushResult) {
  const row = db().prepare('SELECT * FROM outbox WHERE id = ?').get(r.id) as OutboxRow | undefined
  if (!row) return false
  let status: string = r.status
  let next: string | null = null
  if (r.status === 'failed' && r.transient && row.attempts < MAX_TRANSIENT_ATTEMPTS) {
    status = 'pending'
    next = new Date(Date.now() + Math.min(2 ** row.attempts * 15_000, 30 * 60_000)).toISOString()
  }
  const t = now()
  db().prepare(`UPDATE outbox SET status = ?, next_attempt_at = ?, locked_until = NULL, action = ?, error = ?, tally_guid = COALESCE(?, tally_guid),
    tally_master_id = COALESCE(?, tally_master_id), voucher_number = COALESCE(?, voucher_number), request_xml = ?, response_xml = ?, updated_at = ?,
    synced_at = CASE WHEN ? = 'synced' THEN ? ELSE synced_at END WHERE id = ?`)
    .run(status, next, r.action ?? null, r.error ?? null, r.tallyGuid ?? null, r.tallyMasterId ?? null, r.voucherNumber ?? null,
      r.requestXml ?? null, r.responseXml ?? null, t, r.status, t, r.id)
  syncLog('push', row.entity, r.status === 'synced' ? 'ok' : 'error', `${row.label}: ${r.status}${r.action ? ` (${r.action})` : ''}${r.error ? ` - ${r.error}` : ''}`)
  return true
}

// ------------------------------------------------------------------ ingest
const BALANCE_KEYS = ['closingBalance', 'closingQty', 'closingValue', 'closingRate']
const pickBalances = (d: any) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => BALANCE_KEYS.includes(k)))
const stripNull = (d: any) => Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v !== null && v !== undefined))

export function ingest(b: IngestRequest) {
  const at = now()
  let count = 0
  const d = db()
  if (!getSetting('company_name')) { setSetting('company_name', b.company.name); if (b.company.gstin) setSetting('company_gstin', b.company.gstin) }
  d.transaction(() => {
    if ((OBJECT_ENTITIES as readonly string[]).includes(b.entity)) {
      const fields = new Map<string, { n: number; sample: string; type: string }>()
      const getPrev = d.prepare('SELECT data_json FROM tally_objects WHERE entity = ? AND guid = ?')
      const up = d.prepare(`INSERT INTO tally_objects (entity, guid, name, parent, masterid, alterid, data_json, raw_xml, raw_json, pulled_at)
        VALUES (@entity, @guid, @name, @parent, @masterid, @alterid, @data_json, @raw_xml, @raw_json, @pulled_at)
        ON CONFLICT(entity, guid) DO UPDATE SET name = excluded.name, parent = excluded.parent, masterid = excluded.masterid, alterid = excluded.alterid,
        data_json = excluded.data_json, raw_xml = excluded.raw_xml, raw_json = excluded.raw_json, pulled_at = excluded.pulled_at`)
      for (const o of b.objects) {
        const prev = getPrev.get(b.entity, o.guid) as any
        const data = prev ? { ...pickBalances(J(prev.data_json)), ...stripNull(o.data) } : o.data
        up.run({ entity: b.entity, guid: o.guid, name: o.name, parent: o.parent ?? null, masterid: o.masterid, alterid: o.alterid, data_json: JSON.stringify(data), raw_xml: o.rawXml, raw_json: JSON.stringify(o.rawJson), pulled_at: at })
        for (const f of flattenPaths(o.rawJson).values()) {
          const e = fields.get(f.path) ?? { n: 0, sample: '', type: '' }
          e.n++; e.sample ||= f.sample; e.type ||= f.tallyType
          fields.set(f.path, e)
        }
        count++
      }
      // full snapshot: anything not in it was deleted in Tally
      if (b.full) d.prepare('DELETE FROM tally_objects WHERE entity = ? AND pulled_at < ?').run(b.entity, at)
      const sf = d.prepare(`INSERT INTO schema_fields (entity, path, occurrences, sample_value, tally_type, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity, path) DO UPDATE SET occurrences = schema_fields.occurrences + excluded.occurrences, last_seen = excluded.last_seen,
        sample_value = COALESCE(NULLIF(schema_fields.sample_value, ''), excluded.sample_value)`)
      for (const [p, f] of fields) sf.run(b.entity, p, f.n, f.sample.slice(0, 300), f.type, at, at)
    } else {
      // balance refresh: stock_summary -> stock item closings; outstanding / trial_balance -> ledger closings
      const target = b.entity === 'stock_summary' ? 'stock_item' : 'ledger'
      const get = d.prepare('SELECT data_json FROM tally_objects WHERE entity = ? AND guid = ?')
      const set = d.prepare('UPDATE tally_objects SET data_json = ? WHERE entity = ? AND guid = ?')
      for (const r of b.rows) {
        const prev = get.get(target, String(r.guid)) as any
        if (!prev) continue
        const { guid: _g, name: _n, ...vals } = r
        set.run(JSON.stringify({ ...J(prev.data_json), ...vals }), target, String(r.guid))
        count++
      }
    }
    d.prepare(`INSERT INTO pull_state (entity, last_alterid, last_pulled_at, last_count, last_full) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entity) DO UPDATE SET last_alterid = excluded.last_alterid, last_pulled_at = excluded.last_pulled_at, last_count = excluded.last_count, last_full = excluded.last_full`)
      .run(b.entity, b.maxAlterId, at, count, b.full ? 1 : 0)
  })()
  syncLog('pull', b.entity, 'ok', `${b.entity}: ${count} ${b.full ? '(full)' : `(since ALTERID ${b.sinceAlterId})`}`)
  return count
}

export function saveStatus(hb: Heartbeat) {
  const prev = latestStatus()
  db().prepare('INSERT INTO agent_status (id, status_json, received_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET status_json = excluded.status_json, received_at = excluded.received_at')
    .run(JSON.stringify(hb), now())
  if (hb.lockedCompany && hb.companyState === 'matched') { setSetting('company_name', hb.lockedCompany.name); if (hb.lockedCompany.gstin) setSetting('company_gstin', hb.lockedCompany.gstin) }
  if (prev?.status.companyState !== hb.companyState) syncLog('gate', null, hb.companyState === 'matched' ? 'ok' : 'blocked', `company ${hb.companyState}${hb.lastError ? `: ${hb.lastError}` : ''}`)
}
export function latestStatus(): { status: Heartbeat; receivedAt: string; online: boolean } | null {
  const r = db().prepare('SELECT * FROM agent_status WHERE id = 1').get() as any
  if (!r) return null
  return { status: J(r.status_json), receivedAt: r.received_at, online: Date.now() - Date.parse(r.received_at) < 3 * 60_000 }
}

// ------------------------------------------------------------------ reads
export function objects(entity: string, q?: string | null, limit = 2000) {
  let sql = 'SELECT guid, name, parent, masterid, alterid, data_json, pulled_at FROM tally_objects WHERE entity = ?'
  const args: unknown[] = [entity]
  if (q) { sql += ' AND name LIKE ?'; args.push(`%${q}%`) }
  return (db().prepare(sql + ' ORDER BY name LIMIT ?').all(...args, limit) as any[]).map(({ data_json, ...r }) => ({ ...r, data: J(data_json) }))
}
export function rawObject(entity: string, guid: string) {
  const r = db().prepare('SELECT * FROM tally_objects WHERE entity = ? AND guid = ?').get(entity, guid) as any
  return r && { ...r, data: J(r.data_json), raw: J(r.raw_json), data_json: undefined, raw_json: undefined }
}
export function counts() {
  return Object.fromEntries((db().prepare('SELECT entity, count(*) AS n FROM tally_objects GROUP BY entity').all() as any[]).map((r) => [r.entity, r.n]))
}
export function pullState() { return db().prepare('SELECT * FROM pull_state ORDER BY entity').all() as any[] }
export function syncLogRows(limit = 200) { return db().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit) as any[] }
export function schemaSummary() { return db().prepare('SELECT entity, count(*) AS fields FROM schema_fields GROUP BY entity ORDER BY entity').all() as any[] }
export function schemaFields(entity: string) { return db().prepare('SELECT * FROM schema_fields WHERE entity = ? ORDER BY path').all(entity) as any[] }

const ledgerRows = () => objects('ledger').map((l) => ({ name: l.name, parent: l.parent, closingBalance: l.data?.closingBalance ?? null }))
export function report(name: string, category?: string | null): unknown {
  if (name === 'stock') {
    const vt = objects('voucher_type')
    const orderTypes = new Set(vt.filter((v) => /order/i.test(v.parent ?? '') || /order/i.test(v.name)).map((v) => v.name))
    orderTypes.add('Sales Order'); orderTypes.add('Purchase Order')
    return stockByGodown(objects('stock_item'), objects('voucher'), orderTypes)
  }
  if (name === 'outstanding') return outstanding(ledgerRows(), objects('group'))
  if (name === 'trial-balance') return trialBalance(ledgerRows())
  if (name === 'vouchers') {
    const base = new Map(objects('voucher_type').map((v) => [v.name, v.parent || v.name]))
    const labels: Record<string, string> = { sales: 'Sales', purchase: 'Purchase', sales_order: 'Sales Order', purchase_order: 'Purchase Order', receipt: 'Receipt', payment: 'Payment', credit_note: 'Credit Note', debit_note: 'Debit Note' }
    const known = new Set(Object.values(labels))
    const rows = objects('voucher').filter((v) => {
      if (!category) return true
      const t = v.data?.voucherType, b = base.get(t) ?? t
      if (category === 'other') return !known.has(t) && !known.has(b)
      return t === labels[category] || b === labels[category]
    })
    return rows.map((v) => ({ guid: v.guid, ...v.data })).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
  }
  return null
}

export function resetCompanyLink() {
  for (const k of ['company_guid', 'company_name', 'company_gstin']) setSetting(k, null)
  syncLog('gate', null, 'ok', 'backend company link reset')
}
