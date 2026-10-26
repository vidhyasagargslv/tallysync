import { PULL_ENTITIES } from '@tallysync/contracts'
import Link from 'next/link'
import { Action, AutoRefresh } from '@/components/Action'
import { SyncPanel } from '@/components/SyncPanel'
import { getSetting } from '@/lib/db'
import { counts, latestStatus, listRecords, pullState } from '@/lib/repo'
import { Badge, Table, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'

export default function Dashboard() {
  const st = latestStatus()
  const c = counts()
  const ps = new Map(pullState().map((p) => [p.entity, p]))
  const recs = listRecords()
  const by = (s: string) => recs.filter((r) => r.status === s).length
  const a = st?.status
  return (<>
    <AutoRefresh seconds={10} />
    <h2>Dashboard</h2>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Agent {st ? <Badge s={st.online ? 'ok' : 'offline'} /> : <Badge s="unconfigured" />}</h3>
      {!a ? <p className="muted">No heartbeat yet. Install the agent on the Tally PC and point it at this app with the API key from <Link href="/settings">Settings</Link>.</p> : (
        <div className="row" style={{ gap: 28 }}>
          <div>Company gate<br /><Badge s={a.companyState} /></div>
          <div>Locked company<br /><b>{a.lockedCompany?.name ?? '-'}</b><div className="muted">{a.lockedCompany?.guid} {a.lockedCompany?.gstin && `| ${a.lockedCompany.gstin}`}</div></div>
          <div>Tally<br />{a.tallyReachable ? 'reachable' : 'not reachable'} <span className="muted">({a.tallyMode} {a.tallyUrl})</span></div>
          <div>Last heartbeat<br />{ftime(st!.receivedAt)}</div>
          <div>Last pull<br />{ftime(a.lastPullAt)}</div>
          <div>Last push<br />{ftime(a.lastPushAt)}</div>
          <div>Machine<br />{a.machine} <span className="muted">v{a.agentVersion}</span></div>
        </div>)}
      {a?.lastError && <p className="err">Last error: {a.lastError}</p>}
      <p className="muted">Backend linked to company GUID: {getSetting('company_guid') ?? 'not yet (locks on first agent sync)'}</p>
    </div>
    <SyncPanel entities={[...PULL_ENTITIES]} />
    <div className="cards">
      <div className="stat"><span className="muted">Pending to Tally</span><b>{by('pending') + by('in_progress')}</b></div>
      <div className="stat"><span className="muted">Synced</span><b>{by('synced')}</b></div>
      <div className="stat"><span className="muted">Failed</span><b style={{ color: '#9b1c1c' }}>{by('failed')}</b></div>
      <div className="stat"><span className="muted">Ledgers</span><b>{c.ledger ?? 0}</b></div>
      <div className="stat"><span className="muted">Stock items</span><b>{c.stock_item ?? 0}</b></div>
      <div className="stat"><span className="muted">Vouchers</span><b>{c.voucher ?? 0}</b></div>
    </div>
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Pulls from Tally</h3>
        <Action url="/api/demo-masters" label="Queue demo masters" secondary /></div>
      <Table cols={[['Entity'], ['Enabled on agent'], ['Records', 'num'], ['Last count', 'num'], ['Last ALTERID', 'num'], ['Last pulled']]}
        rows={PULL_ENTITIES.map((e) => [e, a ? (a.enabledPulls.includes(e) ? 'yes' : <Badge s="blocked" />) : '-', c[e] ?? '-', ps.get(e)?.last_count ?? '-', ps.get(e)?.last_alterid ?? '-', ftime(ps.get(e)?.last_pulled_at)])} />
    </div>
  </>)
}
