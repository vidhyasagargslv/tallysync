import { handle, json } from '@/lib/auth'
import { createRequest, listRequests } from '@/lib/syncRequests'
export const dynamic = 'force-dynamic'
/** UI: recent manual sync requests (latest first). */
export function GET(req: Request) {
  return handle(() => json(listRequests(Number(new URL(req.url).searchParams.get('limit') ?? 20))))
}
/** UI: ask the agent to sync now. Body: { type: sync|push|pull|pull_entity|full_repull, entity? } */
export function POST(req: Request) {
  return handle(async () => json(createRequest(await req.json()), 201))
}
