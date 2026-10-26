/** Pure report derivations used by the server over pulled data (Postgres-agnostic). */
export interface ItemRow { name: string; data: any }
export interface VoucherRow { data: any }
export interface StockRow { item: string; godown: string; qty: number; unit: string | null; value: number | null; source: 'tally_closing' | 'computed' }

/** tally_closing: Tally's own closing per item (godown '*'); computed: per godown from openings + inventory entries. */
export function stockByGodown(items: ItemRow[], vouchers: VoucherRow[], orderTypes: Set<string>): StockRow[] {
  const out: StockRow[] = []
  const computed = new Map<string, number>()
  const unitOf = new Map<string, string>()
  const rateOf = new Map<string, number>()
  const add = (item: string, godown: string, q: number) => computed.set(`${item}\u0000${godown}`, (computed.get(`${item}\u0000${godown}`) ?? 0) + q)
  for (const it of items) {
    const d = it.data ?? {}
    unitOf.set(it.name, d.baseUnits ?? '')
    if (d.closingQty !== null && d.closingQty !== undefined) {
      out.push({ item: it.name, godown: '*', qty: d.closingQty, unit: d.baseUnits ?? null, value: d.closingValue == null ? null : Math.abs(d.closingValue), source: 'tally_closing' })
      if (d.closingQty) rateOf.set(it.name, Math.abs(d.closingValue ?? 0) / Math.abs(d.closingQty))
    }
    for (const b of d.openingBatches ?? []) add(it.name, b.godown, b.qty)
  }
  for (const v of vouchers) {
    const d = v.data ?? {}
    if (d.isCancelled || d.isOptional || orderTypes.has(d.voucherType)) continue
    for (const e of d.inventoryEntries ?? []) add(e.item, e.godown || 'Main Location', e.inward ? e.qty : -e.qty)
  }
  for (const [k, qty] of computed) {
    const [item, godown] = k.split('\u0000')
    const rate = rateOf.get(item)
    out.push({ item, godown, qty, unit: unitOf.get(item) ?? null, value: rate === undefined ? null : Math.round(qty * rate * 100) / 100, source: 'computed' })
  }
  return out
}

export interface LedgerRow { name: string; parent: string | null; closingBalance: number | null }
export interface GroupRow { name: string; parent: string | null }

/** Walk the group tree to the top-level primary group. */
export function rootGroups(groups: GroupRow[]) {
  const parentOf = new Map(groups.map((g) => [g.name, g.parent ?? '']))
  return (name: string, target: string) => {
    let cur: string | undefined = name
    for (let i = 0; cur && i < 50; i++) {
      if (cur === target) return true
      cur = parentOf.get(cur)
    }
    return false
  }
}

/** Tally sign: negative closing = Debit. Receivable = debit balance under Sundry Debtors, payable = credit under Sundry Creditors. */
export function outstanding(ledgers: LedgerRow[], groups: GroupRow[]) {
  const under = rootGroups(groups)
  const rows: Array<{ ledger: string; group: string; side: 'receivable' | 'payable'; amount: number }> = []
  for (const l of ledgers) {
    const bal = l.closingBalance ?? 0
    if (!bal || !l.parent) continue
    if (under(l.parent, 'Sundry Debtors')) rows.push({ ledger: l.name, group: l.parent, side: 'receivable', amount: -bal })
    else if (under(l.parent, 'Sundry Creditors')) rows.push({ ledger: l.name, group: l.parent, side: 'payable', amount: bal })
  }
  return rows
}

export function trialBalance(ledgers: LedgerRow[]) {
  const rows = ledgers.filter((l) => l.closingBalance).map((l) => ({
    ledger: l.name, group: l.parent ?? '', debit: l.closingBalance! < 0 ? -l.closingBalance! : 0, credit: l.closingBalance! > 0 ? l.closingBalance! : 0
  }))
  const r2 = (n: number) => Math.round(n * 100) / 100
  return { rows, totalDebit: r2(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: r2(rows.reduce((s, r) => s + r.credit, 0)) }
}
