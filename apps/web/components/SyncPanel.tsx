'use client'
import { useCallback, useEffect, useState } from 'react'

interface Req { id: string; type: string; entity: string | null; status: string; requestedAt: string; finishedAt: string | null; summary: string | null; error: string | null }
const LABEL: Record<string, string> = { sync: 'Sync now', push: 'Push only', pull: 'Pull only', pull_entity: 'Pull entity', full_repull: 'Full re-pull' }
const badge: Record<string, string> = { requested: 'pending', picked: 'in_progress', running: 'in_progress', done: 'synced', failed: 'failed', expired: 'failed' }

export function SyncPanel({ entities }: { entities: string[] }) {
  const [reqs, setReqs] = useState<Req[]>([])
  const [entity, setEntity] = useState(entities.find((e) => e === 'voucher') ?? entities[0])
  const [err, setErr] = useState('')
  const load = useCallback(async () => { const r = await fetch('/api/sync-requests?limit=5'); if (r.ok) setReqs(await r.json()) }, [])
  const active = reqs.some((r) => ['requested', 'picked', 'running'].includes(r.status))
  useEffect(() => { load(); const t = setInterval(load, active ? 1500 : 5000); return () => clearInterval(t) }, [load, active])
  const go = async (type: string, extra: object = {}) => {
    setErr('')
    const r = await fetch('/api/sync-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, ...extra }) })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
    load()
  }
  const latest = reqs[0]
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Manual sync</h3>
      <div className="row">
        <button disabled={active} onClick={() => go('sync')}>Sync now</button>
        <button className="secondary" disabled={active} onClick={() => go('push')}>Push only</button>
        <button className="secondary" disabled={active} onClick={() => go('pull')}>Pull only</button>
        <span className="row" style={{ gap: 4 }}>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>{entities.map((e) => <option key={e}>{e}</option>)}</select>
          <button className="secondary" disabled={active} onClick={() => go('pull_entity', { entity })}>Pull entity</button>
        </span>
        <button className="secondary" disabled={active} onClick={() => { if (confirm('Re-pull everything from Tally, ignoring ALTERID cursors?')) go('full_repull') }}>Full re-pull</button>
      </div>
      {err && <p className="err">{err}</p>}
      {latest && <p style={{ marginBottom: 0 }}>
        Latest: <b>{LABEL[latest.type]}{latest.entity ? ` (${latest.entity})` : ''}</b> <span className={`badge ${badge[latest.status]}`}>{latest.status}</span>{' '}
        <span className="muted">requested {new Date(latest.requestedAt).toLocaleTimeString('en-IN')}{latest.finishedAt && `, finished ${new Date(latest.finishedAt).toLocaleTimeString('en-IN')}`}</span>
        {latest.summary && <><br />{latest.summary}</>}
        {latest.error && <><br /><span className="err">{latest.error}</span></>}
        {['requested', 'picked'].includes(latest.status) && <><br /><span className="muted">Waiting for the agent (it checks every few seconds)...</span></>}
      </p>}
      {reqs.length > 1 && <details><summary className="muted">Previous requests</summary><ul>{reqs.slice(1).map((r) => <li key={r.id} className="muted">{new Date(r.requestedAt).toLocaleString('en-IN')} {LABEL[r.type]}{r.entity ? ` (${r.entity})` : ''}: {r.status}{r.summary ? ` - ${r.summary}` : ''}{r.error ? ` - ${r.error}` : ''}</li>)}</ul></details>}
    </div>
  )
}
