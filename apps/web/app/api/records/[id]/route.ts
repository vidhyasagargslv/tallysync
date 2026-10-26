import { HttpError, handle, json } from '@/lib/auth'
import { getRecord, updateRecord } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const r = getRecord((await ctx.params).id); if (!r) throw new HttpError(404, 'not found'); return json(r) })
}
/** Edit (re-queues; the agent Alters the existing Tally object). Body: the new payload. */
export function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const r = updateRecord((await ctx.params).id, await req.json()); if (!r) throw new HttpError(404, 'not found'); return json(r) })
}
