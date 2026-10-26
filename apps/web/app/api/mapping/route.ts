import { getSetting, J } from '@/lib/db'
import { handle, json } from '@/lib/auth'
import { loadMapping } from '@/lib/mapping'
export const dynamic = 'force-dynamic'
/** UI: active mapping, schema errors and the agent's last validation against Tally. */
export function GET() {
  return handle(() => json({ ...loadMapping(), validation: J(getSetting('mapping_validation')) }))
}
