/**
 * TallySync shared contract between the agent and the client backend (Next.js app or any other backend).
 * Bump CONTRACT_VERSION (major) on breaking changes; backends may reject other majors with HTTP 426.
 *
 */
import { z } from 'zod'

export const CONTRACT_VERSION = '1.0.0'
export const contractMajor = (v: string) => Number(v.split('.')[0])

// ---------------------------------------------------------------------------
// Entity catalogue: everything the agent can pull / push
// ---------------------------------------------------------------------------
export const PULL_ENTITIES = [
  'company', 'group', 'ledger', 'cost_centre', 'currency', 'unit', 'stock_group', 'stock_category',
  'godown', 'stock_item', 'voucher_type', 'voucher', 'stock_summary', 'outstanding', 'trial_balance'
] as const
export type PullEntity = (typeof PULL_ENTITIES)[number]
/** Pull entities that are raw Tally object collections (the rest are derived/balance reports). */
export const OBJECT_ENTITIES = PULL_ENTITIES.slice(0, 12) as unknown as readonly ObjectEntity[]
export type ObjectEntity = Exclude<PullEntity, 'stock_summary' | 'outstanding' | 'trial_balance'>

export const MASTER_KINDS = ['group', 'ledger', 'unit', 'stock_group', 'godown', 'stock_item'] as const
export type MasterKind = (typeof MASTER_KINDS)[number]
export const VOUCHER_KINDS = ['sales_order', 'sales', 'purchase_order', 'purchase', 'receipt', 'payment', 'credit_note', 'debit_note'] as const
/** Kinds whose party is a customer / whose ledgers come from the sales side of the mapping. */
export const SALE_SIDE_KINDS: readonly VoucherKind[] = ['sales_order', 'sales', 'credit_note']
export type VoucherKind = (typeof VOUCHER_KINDS)[number]
export const PUSH_ENTITIES = [...MASTER_KINDS, ...VOUCHER_KINDS] as const
export type PushEntity = (typeof PUSH_ENTITIES)[number]

// ---------------------------------------------------------------------------
// Neutral JSON entities (what the dashboard speaks; never Tally XML)
// ---------------------------------------------------------------------------
const date = z.string().regex(/^\d{8}$/, 'YYYYMMDD')
export const GroupZ = z.object({ name: z.string().min(1), parent: z.string().default('') })
export const LedgerZ = z.object({
  name: z.string().min(1), parent: z.string().min(1), openingBalance: z.number().optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN must be 15 characters').optional(), state: z.string().optional(), address: z.string().optional(), billWise: z.boolean().optional(),
  pincode: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional(),
  gstRegistrationType: z.enum(['Regular', 'Composition', 'Unregistered', 'Consumer']).optional(),
  gstDutyHead: z.enum(['Central Tax', 'State Tax', 'Integrated Tax']).optional(), gstRate: z.number().optional(), affectsStock: z.boolean().optional()
})
export const UnitZ = z.object({ name: z.string().min(1), decimals: z.number().int().optional(), formalName: z.string().optional() })
export const StockGroupZ = z.object({ name: z.string().min(1), parent: z.string().optional() })
export const GodownZ = z.object({ name: z.string().min(1), parent: z.string().optional() })
export const StockItemZ = z.object({
  name: z.string().min(1), parent: z.string().optional(), baseUnit: z.string().min(1), hsn: z.string().optional(), gstRate: z.number().optional(),
  openingQty: z.number().optional(), openingRate: z.number().optional(), godown: z.string().optional(),
  openingBatches: z.array(z.object({ godown: z.string().min(1), qty: z.number(), rate: z.number().nonnegative() })).optional(),
  typeOfSupply: z.enum(['Goods', 'Services']).optional()
})
export const MasterDataZ = { group: GroupZ, ledger: LedgerZ, unit: UnitZ, stock_group: StockGroupZ, godown: GodownZ, stock_item: StockItemZ } as const

export const VoucherLineZ = z.object({
  item: z.string().min(1), qty: z.number().positive(), rate: z.number().nonnegative(),
  godown: z.string().optional(), unit: z.string().optional(), gstRate: z.number().optional()
})
export const VoucherZ = z.object({
  kind: z.enum(VOUCHER_KINDS), number: z.string().min(1), date, party: z.string().min(1),
  lines: z.array(VoucherLineZ).optional(), taxMode: z.enum(['intra', 'inter', 'none']).default('none'),
  amount: z.number().optional(), narration: z.string().optional(), reference: z.string().optional(), dueDate: date.optional(),
  /** credit_note / debit_note: original invoice number; the note is adjusted against it (bill-wise Agst Ref) */
  againstInvoice: z.string().min(1).optional(),
  /** credit_note / debit_note: original invoice date (YYYYMMDD), informational for GST */
  againstInvoiceDate: date.optional()
}).superRefine((v, ctx) => {
  if ((v.kind === 'credit_note' || v.kind === 'debit_note') && !(v.lines ?? []).length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'credit/debit notes need at least one item line' })
})
export type Voucher = z.infer<typeof VoucherZ>

/** Normalised view of a pulled object, extracted by the agent; the raw object is always sent too. */
export const PulledObjectZ = z.object({
  guid: z.string(), name: z.string(), masterid: z.number().nullable(), alterid: z.number().nullable(),
  parent: z.string().nullable().optional(),
  data: z.record(z.any()), // neutral fields (closing balance, gstin, entries, ...)
  rawXml: z.string(), rawJson: z.any()
})
export type PulledObject = z.infer<typeof PulledObjectZ>

export const StockRowZ = z.object({ item: z.string(), godown: z.string(), qty: z.number(), unit: z.string().nullable(), value: z.number().nullable(), source: z.string() })
export const OutstandingRowZ = z.object({ ledger: z.string(), group: z.string(), side: z.enum(['receivable', 'payable']), amount: z.number() })
export const TrialBalanceRowZ = z.object({ ledger: z.string(), group: z.string(), debit: z.number(), credit: z.number() })

// ---------------------------------------------------------------------------
// Mapping + sync settings (kept locally by the agent)
// ---------------------------------------------------------------------------
export const DEFAULT_VOUCHER_TYPES: Record<VoucherKind, string> = {
  sales_order: 'Sales Order', sales: 'Sales', purchase_order: 'Purchase Order', purchase: 'Purchase', receipt: 'Receipt', payment: 'Payment',
  credit_note: 'Credit Note', debit_note: 'Debit Note'
}

export const EntitySettingZ = z.object({ enabled: z.boolean(), intervalSec: z.number().int().min(30) })
export const SyncSettingsZ = z.object({
  pull: z.record(z.enum(PULL_ENTITIES), EntitySettingZ),
  push: z.record(z.enum(PUSH_ENTITIES), z.object({ enabled: z.boolean() })),
  jobPollSec: z.number().int().min(5).default(15),
  heartbeatSec: z.number().int().min(10).default(30),
  fromDate: date, toDate: date
})
export type SyncSettings = z.infer<typeof SyncSettingsZ>

/** Everything ON by default; switch off per entity later. */
export function defaultSyncSettings(fromDate = '20260401', toDate = '20270331'): SyncSettings {
  const pull = Object.fromEntries(PULL_ENTITIES.map((e) => [e, { enabled: true, intervalSec: e === 'voucher' || e === 'stock_summary' ? 300 : 900 }])) as SyncSettings['pull']
  const push = Object.fromEntries(PUSH_ENTITIES.map((e) => [e, { enabled: true }])) as SyncSettings['push']
  return { pull, push, jobPollSec: 15, heartbeatSec: 30, fromDate, toDate }
}

export const CompanyLinkZ = z.object({ guid: z.string().min(1), name: z.string().min(1), gstin: z.string().nullable() })
export type CompanyLink = z.infer<typeof CompanyLinkZ>

// ---------------------------------------------------------------------------
// Agent <-> client backend API (the fixed contract every backend implements)
//   All calls: header  x-api-key: <key>   x-contract-version: 1.x   x-company-guid: <locked guid>
//   GET  /api/tally-sync/pending?limit=25      -> PendingRecord[]   (records waiting to go to Tally)
//   POST /api/tally-sync/result                <- PushResult        (synced / failed per record)
//   POST /api/tally-sync/data/{entity}         <- IngestRequest     (pulled Tally data, full raw)
//   POST /api/tally-sync/status                <- Heartbeat         (agent + gate status)
// ---------------------------------------------------------------------------
export const CompanyStateZ = z.enum(['matched', 'mismatch', 'not_open', 'unreachable', 'unconfigured'])
export type CompanyState = z.infer<typeof CompanyStateZ>

export const PendingRecordZ = z.object({
  id: z.string(), entity: z.enum(PUSH_ENTITIES), attempts: z.number().int().default(0),
  payload: z.record(z.any()) // neutral entity: MasterDataZ[entity] or VoucherZ
})
export type PendingRecord = z.infer<typeof PendingRecordZ>

export const PushResultZ = z.object({
  id: z.string(), status: z.enum(['synced', 'failed']), action: z.enum(['Create', 'Alter']).optional(), error: z.string().optional(),
  transient: z.boolean().optional(), // true = Tally unreachable etc.; backend should keep it pending
  tallyGuid: z.string().optional(), tallyMasterId: z.number().optional(), voucherNumber: z.string().optional(),
  requestXml: z.string().optional(), responseXml: z.string().optional()
})
export type PushResult = z.infer<typeof PushResultZ>

export const IngestRequestZ = z.object({
  entity: z.enum(PULL_ENTITIES), full: z.boolean(), sinceAlterId: z.number(), maxAlterId: z.number(),
  company: CompanyLinkZ,
  objects: z.array(PulledObjectZ).default([]),
  rows: z.array(z.record(z.any())).default([]) // stock_summary / outstanding / trial_balance balance refresh
})
export type IngestRequest = z.infer<typeof IngestRequestZ>

export const HeartbeatZ = z.object({
  agentVersion: z.string(), contractVersion: z.string(), machine: z.string(), tallyUrl: z.string(), tallyMode: z.enum(['real', 'mock']),
  tallyReachable: z.boolean(), companyState: CompanyStateZ,
  lockedCompany: CompanyLinkZ.nullable(), openCompanies: z.array(CompanyLinkZ),
  lastPullAt: z.string().nullable(), lastPushAt: z.string().nullable(), lastError: z.string().nullable(),
  enabledPulls: z.array(z.enum(PULL_ENTITIES)), recentErrors: z.array(z.string()).default([]),
  mapping: z.object({ source: z.enum(['backend', 'cache', 'local']), hash: z.string().nullable(), version: z.string().nullable(), issues: z.number().int() }).optional()
})
export type Heartbeat = z.infer<typeof HeartbeatZ>

export * from './mapping.js'
