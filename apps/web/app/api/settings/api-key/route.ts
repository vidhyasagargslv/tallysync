import { handle, json, regenerateApiKey } from '@/lib/auth'
export const dynamic = 'force-dynamic'
/** Regenerate the agent API key (the old one stops working immediately). */
export function POST() { return handle(() => json({ apiKey: regenerateApiKey() })) }
