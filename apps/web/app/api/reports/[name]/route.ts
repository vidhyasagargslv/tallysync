import { HttpError, handle, json } from '@/lib/auth'
import { report } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  return handle(async () => {
    const r = report((await ctx.params).name, new URL(req.url).searchParams.get('category'))
    if (r === null) throw new HttpError(404, 'unknown report'); return json(r)
  })
}
