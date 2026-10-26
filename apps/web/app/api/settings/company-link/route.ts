import { handle, json } from '@/lib/auth'
import { resetCompanyLink } from '@/lib/repo'
export const dynamic = 'force-dynamic'
/** Forget the backend-side company GUID link (use with Re-link on the agent). */
export function DELETE() { return handle(() => { resetCompanyLink(); return json({ ok: true }) }) }
