import { notFound } from 'next/navigation'
import { rawObject } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export default async function Raw({ params }: { params: Promise<{ entity: string; guid: string }> }) {
  const p = await params
  const r = rawObject(p.entity, decodeURIComponent(p.guid))
  if (!r) notFound()
  return (<><h2>{p.entity}: {r.name}</h2>
    <p className="muted">GUID {r.guid} | MasterID {r.masterid} | AlterID {r.alterid} | pulled {r.pulled_at}</p>
    <h3>Normalised</h3><pre>{JSON.stringify(r.data, null, 2)}</pre>
    <h3>Full raw JSON (every field Tally sent)</h3><pre>{JSON.stringify(r.raw, null, 2)}</pre>
    <h3>Raw XML</h3><pre>{r.raw_xml}</pre></>)
}
