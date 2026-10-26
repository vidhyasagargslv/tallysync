/** Pickers: local master records (outbox) merged with masters pulled from Tally. */
import { loadMapping } from './mapping'
import { listRecords, objects } from './repo'

export function partyGroups() {
  const g = loadMapping().mapping?.groups
  return { customers: g?.customers ?? 'Sundry Debtors', suppliers: g?.suppliers ?? 'Sundry Creditors' }
}

/** Is `group` equal to or under `root` in Tally's pulled group tree? */
function under(group: string | null | undefined, root: string) {
  const parent = new Map(objects('group').map((g) => [g.name.toLowerCase(), g.parent ?? '']))
  let cur = group ?? ''
  for (let i = 0; cur && i < 30; i++) { if (cur.toLowerCase() === root.toLowerCase()) return true; cur = parent.get(cur.toLowerCase()) ?? '' }
  return false
}

export interface PickOption { name: string; source: 'local' | 'tally' | 'both'; status?: string; detail?: string; gstRate?: number | null; unit?: string | null }

function merge(local: PickOption[], tally: PickOption[]) {
  const m = new Map<string, PickOption>()
  for (const t of tally) m.set(t.name.toLowerCase(), t)
  for (const l of local) { const t = m.get(l.name.toLowerCase()); m.set(l.name.toLowerCase(), t ? { ...t, ...l, source: 'both' } : l) }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function parties(kind: 'customers' | 'suppliers'): PickOption[] {
  const root = partyGroups()[kind]
  const local = listRecords({ entity: 'ledger' }).filter((r) => under(r.payload.parent, root) || r.payload.parent === root)
    .map((r) => ({ name: r.payload.name, source: 'local' as const, status: r.status, detail: r.payload.gstin }))
  const tally = objects('ledger').filter((l) => under(l.parent, root)).map((l) => ({ name: l.name, source: 'tally' as const, detail: l.data?.gstin ?? undefined }))
  return merge(local, tally)
}

export function items(): PickOption[] {
  const local = listRecords({ entity: 'stock_item' }).map((r) => ({ name: r.payload.name, source: 'local' as const, status: r.status, gstRate: r.payload.gstRate ?? null, unit: r.payload.baseUnit, detail: r.payload.hsn }))
  const tally = objects('stock_item').map((i) => ({ name: i.name, source: 'tally' as const, gstRate: i.data?.gstRate ?? null, unit: i.data?.baseUnits ?? null, detail: i.data?.hsn ?? undefined }))
  return merge(local, tally)
}

export const names = (entity: string) => [...new Set([...listRecords({ entity }).map((r) => r.payload.name as string), ...objects(entity).map((o) => o.name)])].sort()
