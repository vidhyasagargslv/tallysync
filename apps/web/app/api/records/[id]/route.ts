import { HttpError, handle, json } from '@/lib/auth'
import { getRecord } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const r = getRecord((await ctx.params).id); if (!r) throw new HttpError(404, 'not found'); return json(r) })
}
