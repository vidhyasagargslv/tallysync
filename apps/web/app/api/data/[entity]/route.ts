import { handle, json } from '@/lib/auth'
import { objects } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(req: Request, ctx: { params: Promise<{ entity: string }> }) {
  return handle(async () => json(objects((await ctx.params).entity, new URL(req.url).searchParams.get('q'))))
}
