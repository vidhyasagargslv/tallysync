import { HttpError, handle, json } from '@/lib/auth'
import { rawObject } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(_req: Request, ctx: { params: Promise<{ entity: string; guid: string }> }) {
  return handle(async () => { const p = await ctx.params; const r = rawObject(p.entity, p.guid); if (!r) throw new HttpError(404, 'not found'); return json(r) })
}
