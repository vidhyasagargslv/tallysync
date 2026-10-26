import { OBJECT_ENTITIES } from '@tallysync/contracts'
import Link from 'next/link'
import { counts, objects } from '@/lib/repo'
import { RawLink, Table } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default async function Masters({ searchParams }: { searchParams: Promise<{ entity?: string; q?: string }> }) {
  const { entity = 'group', q } = await searchParams
  const c = counts()
  const rows = objects(entity, q)
  return (<><h2>Masters from Tally</h2>
    <p className="tabs">{OBJECT_ENTITIES.filter((e) => e !== 'voucher').map((e) => <Link key={e} href={`/masters?entity=${e}`} className={e === entity ? 'on' : ''}>{e} ({c[e] ?? 0})</Link>)}</p>
    <form className="row" style={{ marginBottom: 12 }}><input type="hidden" name="entity" value={entity} /><input name="q" defaultValue={q} placeholder="Search name" /><button>Search</button></form>
    <Table cols={[['Name'], ['Parent'], ['MasterID', 'num'], ['AlterID', 'num'], ['Fields (normalised)'], ['']]}
      rows={rows.map((r) => [r.name, r.parent ?? '-', r.masterid ?? '-', r.alterid ?? '-', <code key="d" style={{ fontSize: 11 }}>{JSON.stringify(r.data).slice(0, 160)}</code>, <RawLink key="r" entity={entity} guid={r.guid} />])} /></>)
}
