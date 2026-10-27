import { IngestRequestZ } from '@tallysync/contracts'
import { HttpError, handle, json, requireAgent } from '@/lib/auth'
import { ingest } from '@/lib/repo'
export const dynamic = 'force-dynamic'

/** Agent contract: pulled Tally data for one entity (normalised fields + full raw XML/JSON). */
export function POST(req: Request, ctx: { params: Promise<{ entity: string }> }) {
  return handle(async () => {
    const guid = requireAgent(req)
    const { entity } = await ctx.params
    const b = IngestRequestZ.parse(await req.json())
    if (b.entity !== entity) throw new HttpError(400, 'entity in path and body differ')
    if (b.company.guid !== guid) throw new HttpError(409, 'company in body does not match x-company-guid')
    return json({ ok: true, count: ingest(b) })
  })
}
