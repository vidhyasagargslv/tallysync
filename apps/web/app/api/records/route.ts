import { handle, json } from '@/lib/auth'
import { createRecord, listRecords } from '@/lib/repo'
export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const p = new URL(req.url).searchParams
  return handle(() => json(listRecords({ entity: p.get('entity'), status: p.get('status') })))
}
/** Create a sales order / purchase order / master record; it is queued for the agent. */
export function POST(req: Request) {
  return handle(async () => {
    const r = createRecord(await req.json())
    return json(r.record, r.created ? 201 : 200)
  })
}
