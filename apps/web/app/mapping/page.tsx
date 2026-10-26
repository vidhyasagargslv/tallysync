import { mappingReferences } from '@tallysync/contracts'
import { AutoRefresh } from '@/components/Action'
import { J, getSetting } from '@/lib/db'
import { loadMapping } from '@/lib/mapping'
import { latestStatus } from '@/lib/repo'
import { Badge, Table, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'

export default function MappingPage() {
  const m = loadMapping()
  const v = J(getSetting('mapping_validation')) as any
  const agent = latestStatus()?.status.mapping
  const issueFor = new Map<string, any>((v?.issues ?? []).map((i: any) => [i.path, i]))
  const stale = v && m.ok && v.hash !== m.hash
  return (<>
    <AutoRefresh seconds={10} />
    <h2>Tally mapping</h2>
    <div className="card">
      <p>File: <code>{m.path}</code> {m.mtime && <span className="muted">(saved {ftime(m.mtime)})</span>}<br />
        Schema: {m.ok ? <Badge s="ok" /> : <Badge s="error" />} {m.ok && <>version <b>{m.version}</b>, hash <code>{m.hash.slice(0, 12)}</code></>}<br />
        Agent is using: {agent ? <>{agent.source} {agent.hash ? <code>{agent.hash.slice(0, 12)}</code> : ''} {agent.hash === m.hash ? <Badge s="ok" /> : <Badge s="pending" />}</> : 'no heartbeat yet'}<br />
        Checked against Tally: {v ? <>{v.ok ? <Badge s="ok" /> : <Badge s="error" />} {v.issues.length} issue(s), {ftime(v.checkedAt)} on {v.company}{stale && <span className="err"> (for an older version of the file)</span>}</> : 'not yet'}</p>
      <p className="muted">Read-only. Edit the file and save; the agent picks it up on its next cycle. Invalid files are rejected and the agent keeps its last good copy.</p>
      {!m.ok && <ul className="err">{m.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
    {v?.issues?.length > 0 && <div className="card"><h3 style={{ marginTop: 0 }}>Issues found in Tally</h3>
      <Table cols={[['Level'], ['Kind'], ['Name'], ['Config path'], ['Auto-create'], ['Message']]}
        rows={v.issues.map((i: any) => [<Badge key="l" s={i.level === 'error' ? 'error' : 'pending'} />, i.kind, i.name, <code key="p">{i.path}</code>, i.autoCreate ? 'yes' : 'no', i.message])} /></div>}
    {m.mapping && <div className="card"><h3 style={{ marginTop: 0 }}>Every name the mapping uses</h3>
      <Table cols={[['Config path'], ['Kind'], ['Tally name'], ['Status in Tally']]}
        rows={mappingReferences(m.mapping).map((r) => [<code key="p">{r.path}</code>, r.kind, r.name, v ? (issueFor.has(r.path) ? <Badge key="s" s={issueFor.get(r.path).level === 'error' ? 'failed' : 'pending'} /> : <Badge key="s" s="ok" />) : '-'])} /></div>}
    {m.mapping && <div className="card"><h3 style={{ marginTop: 0 }}>Effective mapping (defaults filled in)</h3><pre>{JSON.stringify(m.mapping, null, 2)}</pre></div>}
  </>)
}
