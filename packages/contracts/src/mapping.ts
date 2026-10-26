/**
 * Declarative Tally mapping: where sales, purchases, taxes, round-off, receipts/payments go, which groups
 * auto-created masters land in, and name overrides. Served by the backend (GET /api/tally-sync/mapping)
 * and applied by the agent. Every field has a default, so `{}` is a valid mapping.
 */
import { z } from 'zod'

const name = z.string().min(1)
export const SupplyZ = z.enum(['local', 'interstate'])
export type Supply = z.infer<typeof SupplyZ>

/** One ledger-selection rule. All given conditions must match; first matching rule wins. */
export const LedgerRuleZ = z.object({
  gstRate: z.number().optional(),
  supply: SupplyZ.optional(),
  itemGroup: z.string().optional(),
  item: z.string().optional(),
  ledger: name
}).strict()
export type LedgerRule = z.infer<typeof LedgerRuleZ>

/** Sales or purchase ledger selection: items > itemGroups > rules (in order) > default. */
export const LedgerSelectZ = z.object({
  default: name,
  rules: z.array(LedgerRuleZ).default([]),
  itemGroups: z.record(z.string(), name).default({}),
  items: z.record(z.string(), name).default({})
}).strict()
export type LedgerSelect = z.infer<typeof LedgerSelectZ>

export const TaxLedgersZ = z.object({ cgst: name, sgst: name, igst: name }).strict()
export const TaxSetZ = z.object({
  cgst: name.default('CGST'), sgst: name.default('SGST'), igst: name.default('IGST'),
  /** per GST rate overrides, key = rate as string ("5", "12", "18", "28") */
  byRate: z.record(z.string(), TaxLedgersZ.partial()).default({})
}).strict()
export type TaxSet = z.infer<typeof TaxSetZ>

export const RoundOffZ = z.object({
  enabled: z.boolean().default(false),
  ledger: name.default('Round Off'),
  /** nearest | up | down, to a multiple of `precision` (1 = whole rupee, 0.05, 0.1, 10, ...) */
  mode: z.enum(['nearest', 'up', 'down']).default('nearest'),
  precision: z.number().positive().default(1)
}).strict()
export type RoundOff = z.infer<typeof RoundOffZ>

export const TallyMappingZ = z.object({
  $schema: z.string().optional(),
  version: z.string().default('1'),
  voucherTypes: z.object({
    sales_order: name.default('Sales Order'), sales: name.default('Sales'), purchase_order: name.default('Purchase Order'),
    purchase: name.default('Purchase'), receipt: name.default('Receipt'), payment: name.default('Payment')
  }).strict().default({}),
  sales: LedgerSelectZ.default({ default: 'Sales' }),
  purchase: LedgerSelectZ.default({ default: 'Purchase' }),
  /** output tax (sales side) */
  tax: TaxSetZ.default({}),
  /** input tax (purchase side); omit to use `tax` */
  purchaseTax: TaxSetZ.optional(),
  roundOff: RoundOffZ.default({}),
  cashBank: z.object({ receipt: name.default('Cash'), payment: name.default('Cash') }).strict().default({}),
  defaultGodown: name.default('Main Location'),
  groups: z.object({
    customers: name.default('Sundry Debtors'), suppliers: name.default('Sundry Creditors'),
    salesLedgers: name.default('Sales Accounts'), purchaseLedgers: name.default('Purchase Accounts'),
    taxLedgers: name.default('Duties & Taxes'), roundOff: name.default('Indirect Expenses'),
    /** stock group for auto-created items ('' = Primary) */
    items: z.string().default(''),
    defaultUnit: name.default('Nos')
  }).strict().default({}),
  autoCreate: z.object({ parties: z.boolean().default(false), ledgers: z.boolean().default(false), items: z.boolean().default(false) }).strict().default({}),
  names: z.object({
    parties: z.record(z.string(), name).default({}), items: z.record(z.string(), name).default({}), units: z.record(z.string(), name).default({})
  }).strict().default({})
}).strict()
export type TallyMapping = z.infer<typeof TallyMappingZ>
/** Kept for older code: Mapping == TallyMapping. */
export const MappingZ = TallyMappingZ
export type Mapping = TallyMapping

/** GET /api/tally-sync/mapping response */
export const MappingResponseZ = z.object({ version: z.string(), hash: z.string(), source: z.string(), mapping: TallyMappingZ })
export type MappingResponse = z.infer<typeof MappingResponseZ>

/** POST /api/tally-sync/mapping/validation (optional endpoint for other backends) */
export const MappingIssueZ = z.object({
  level: z.enum(['error', 'warning']), kind: z.enum(['ledger', 'group', 'voucher_type', 'godown', 'unit', 'stock_group']),
  name: z.string(), path: z.string(), message: z.string(), autoCreate: z.boolean()
})
export type MappingIssue = z.infer<typeof MappingIssueZ>
export const MappingValidationZ = z.object({ hash: z.string(), checkedAt: z.string(), company: z.string(), ok: z.boolean(), issues: z.array(MappingIssueZ) })
export type MappingValidation = z.infer<typeof MappingValidationZ>

// ---------------------------------------------------------------------------
// Resolution helpers (pure; used by tally-core and the web UI)
// ---------------------------------------------------------------------------
const eqi = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
const lookupI = (dict: Record<string, string>, k?: string) => (k === undefined ? undefined : dict[k] ?? Object.entries(dict).find(([x]) => eqi(x, k))?.[1])

export function selectLedger(sel: LedgerSelect, line: { item: string; itemGroup?: string; gstRate?: number }, supply: Supply): string {
  const byItem = lookupI(sel.items, line.item)
  if (byItem) return byItem
  const byGroup = lookupI(sel.itemGroups, line.itemGroup)
  if (byGroup) return byGroup
  for (const r of sel.rules) {
    if (r.gstRate !== undefined && r.gstRate !== (line.gstRate ?? 0)) continue
    if (r.supply && r.supply !== supply) continue
    if (r.itemGroup && !eqi(r.itemGroup, line.itemGroup)) continue
    if (r.item && !eqi(r.item, line.item)) continue
    return r.ledger
  }
  return sel.default
}
export function taxLedgersFor(set: TaxSet, rate: number) {
  const o = set.byRate[String(rate)] ?? {}
  return { cgst: o.cgst ?? set.cgst, sgst: o.sgst ?? set.sgst, igst: o.igst ?? set.igst }
}
export function applyRounding(total: number, r: RoundOff): number {
  if (!r.enabled) return total
  const q = total / r.precision
  const n = r.mode === 'up' ? Math.ceil(q - 1e-9) : r.mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q)
  return Math.round(n * r.precision * 100) / 100
}

/** Every master name the mapping refers to, for validation against Tally. */
export function mappingReferences(m: TallyMapping) {
  const refs: Array<{ kind: MappingIssue['kind']; name: string; path: string; group?: string; dutyHead?: string }> = []
  const L = (n: string, path: string, group: string, dutyHead?: string) => refs.push({ kind: 'ledger', name: n, path, group, dutyHead })
  for (const [side, sel, grp] of [['sales', m.sales, m.groups.salesLedgers], ['purchase', m.purchase, m.groups.purchaseLedgers]] as const) {
    L(sel.default, `${side}.default`, grp)
    sel.rules.forEach((r, i) => L(r.ledger, `${side}.rules[${i}].ledger`, grp))
    for (const [k, v] of Object.entries(sel.itemGroups)) L(v, `${side}.itemGroups.${k}`, grp)
    for (const [k, v] of Object.entries(sel.items)) L(v, `${side}.items.${k}`, grp)
  }
  for (const [p, set] of [['tax', m.tax], ['purchaseTax', m.purchaseTax]] as const) {
    if (!set) continue
    L(set.cgst, `${p}.cgst`, m.groups.taxLedgers, 'Central Tax'); L(set.sgst, `${p}.sgst`, m.groups.taxLedgers, 'State Tax'); L(set.igst, `${p}.igst`, m.groups.taxLedgers, 'Integrated Tax')
    for (const [rate, o] of Object.entries(set.byRate)) {
      if (o.cgst) L(o.cgst, `${p}.byRate.${rate}.cgst`, m.groups.taxLedgers, 'Central Tax')
      if (o.sgst) L(o.sgst, `${p}.byRate.${rate}.sgst`, m.groups.taxLedgers, 'State Tax')
      if (o.igst) L(o.igst, `${p}.byRate.${rate}.igst`, m.groups.taxLedgers, 'Integrated Tax')
    }
  }
  if (m.roundOff.enabled) L(m.roundOff.ledger, 'roundOff.ledger', m.groups.roundOff)
  refs.push({ kind: 'ledger', name: m.cashBank.receipt, path: 'cashBank.receipt' }, { kind: 'ledger', name: m.cashBank.payment, path: 'cashBank.payment' })
  for (const [k, v] of Object.entries(m.voucherTypes)) refs.push({ kind: 'voucher_type', name: v, path: `voucherTypes.${k}` })
  refs.push({ kind: 'godown', name: m.defaultGodown, path: 'defaultGodown' })
  for (const [k, v] of Object.entries(m.groups)) {
    if (k === 'defaultUnit') refs.push({ kind: 'unit', name: v, path: 'groups.defaultUnit' })
    else if (k === 'items') { if (v) refs.push({ kind: 'stock_group', name: v, path: 'groups.items' }) }
    else refs.push({ kind: 'group', name: v, path: `groups.${k}` })
  }
  return refs
}
