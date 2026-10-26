import { handle, json } from '@/lib/auth'
import { schemaFields, schemaSummary } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET(req: Request) {
  const e = new URL(req.url).searchParams.get('entity')
  return handle(() => json(e ? schemaFields(e) : schemaSummary()))
}
