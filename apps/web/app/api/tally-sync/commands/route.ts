import { handle, json, requireAgent } from '@/lib/auth'
import { pendingCommands } from '@/lib/syncRequests'
export const dynamic = 'force-dynamic'
/** Agent contract (optional): manual sync requests waiting to run. Not company-gated so a blocked agent can report failure. */
export function GET(req: Request) {
  return handle(() => { requireAgent(req, { gate: false }); return json(pendingCommands()) })
}
