import Link from 'next/link'
import { schemaFields, schemaSummary } from '@/lib/repo'
import { Table } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default async function Schema({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity } = await searchParams
  const sum = schemaSummary()
  return (<><h2>Schema explorer</h2>
    <p className="muted">Every field path Tally has returned so far, per entity (from the full raw records).</p>
    <p className="tabs">{sum.map((s) => <Link key={s.entity} href={`/schema?entity=${s.entity}`} className={s.entity === entity ? 'on' : ''}>{s.entity} ({s.fields})</Link>)}</p>
    {entity && <Table cols={[['Path'], ['Tally type'], ['Seen', 'num'], ['Sample'], ['Last seen']]}
      rows={schemaFields(entity).map((f) => [<code key="p">{f.path}</code>, f.tally_type || '-', f.occurrences, String(f.sample_value ?? '').slice(0, 80), f.last_seen])} />}</>)
}
