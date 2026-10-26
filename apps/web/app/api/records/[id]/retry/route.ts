import { handle, json } from '@/lib/auth'
import { retryRecord } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json({ ok: retryRecord((await ctx.params).id) }))
}
