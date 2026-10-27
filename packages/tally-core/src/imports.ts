import { esc } from './xml.js'

export type MasterKind = 'group' | 'ledger' | 'unit' | 'stock_group' | 'godown' | 'stock_item'
export type VoucherKind = 'sales_order' | 'sales' | 'purchase_order' | 'purchase' | 'receipt' | 'payment' | 'credit_note' | 'debit_note'
/** Customer-side kinds (party = debtor, ledgers from sales mapping). */
export const isSaleSideKind = (k: VoucherKind) => k === 'sales' || k === 'sales_order' || k === 'credit_note'
/** Kinds where stock comes in and the line ledgers are debited: purchase side, and credit notes (sales return). */
const isStockInKind = (k: VoucherKind) => k === 'purchase' || k === 'purchase_order' || k === 'credit_note'
export type ImportAction = 'Create' | 'Alter'

export const MASTER_TAG: Record<MasterKind, string> = {
  group: 'GROUP', ledger: 'LEDGER', unit: 'UNIT', stock_group: 'STOCKGROUP', godown: 'GODOWN', stock_item: 'STOCKITEM'
}

export const VOUCHER_TYPE_NAME: Record<VoucherKind, string> = {
  sales_order: 'Sales Order', sales: 'Sales', purchase_order: 'Purchase Order', purchase: 'Purchase', receipt: 'Receipt', payment: 'Payment',
  credit_note: 'Credit Note', debit_note: 'Debit Note'
}

export interface GroupInput { name: string; parent: string }
export interface LedgerInput {
  name: string
  parent: string
  openingBalance?: number // + = Debit, - = Credit (as accountants read it)
  gstin?: string
  state?: string
  address?: string
  pincode?: string
  phone?: string
  email?: string
  gstRegistrationType?: 'Regular' | 'Composition' | 'Unregistered' | 'Consumer'
  billWise?: boolean
  gstDutyHead?: 'Central Tax' | 'State Tax' | 'Integrated Tax'
  gstRate?: number
  affectsStock?: boolean
}
export interface UnitInput { name: string; decimals?: number; formalName?: string }
export interface StockGroupInput { name: string; parent?: string }
export interface GodownInput { name: string; parent?: string }
export interface StockItemInput {
  name: string
  parent?: string
  baseUnit: string
  hsn?: string
  gstRate?: number
  openingQty?: number
  openingRate?: number
  godown?: string
  /** opening stock per godown (overrides openingQty/openingRate/godown when given) */
  openingBatches?: Array<{ godown: string; qty: number; rate: number }>
  typeOfSupply?: 'Goods' | 'Services'
}
export type MasterInput = GroupInput | LedgerInput | UnitInput | StockGroupInput | GodownInput | StockItemInput

export interface TaxLedgerNames { cgst: string; sgst: string; igst: string }
export interface VoucherLine {
  item: string; qty: number; rate: number; godown?: string; unit?: string; gstRate?: number
  ledger?: string // sales / purchase ledger for this line (rule-based); falls back to VoucherInput.account
  taxLedgers?: TaxLedgerNames // per-rate tax ledgers; falls back to VoucherInput.taxLedgers
}
export interface RoundOffInput { enabled: boolean; ledger: string; mode: 'nearest' | 'up' | 'down'; precision: number }
export interface VoucherInput {
  kind: VoucherKind
  number: string
  date: string // YYYYMMDD
  party: string
  lines?: VoucherLine[]
  account?: string // Sales / Purchase ledger
  taxMode?: 'intra' | 'inter' | 'none'
  taxLedgers?: { cgst: string; sgst: string; igst: string }
  cashLedger?: string // receipt/payment: Cash or bank ledger
  amount?: number // receipt/payment
  narration?: string
  reference?: string
  dueDate?: string
  voucherTypeName?: string // mapping override
  roundOff?: RoundOffInput
  againstInvoice?: string // credit/debit note: original invoice (bill-wise Agst Ref)
  againstInvoiceDate?: string
}

const r2 = (n: number) => Math.round(n * 100) / 100
const amt = (n: number) => r2(n).toFixed(2)
const qtyStr = (q: number, unit: string) => ` ${q} ${unit}`

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------
export function importEnvelope(reportName: 'All Masters' | 'Vouchers', company: string, messages: string[]): string {
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.map((m) => `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n${m}\n        </TALLYMESSAGE>`).join('\n')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`
}

const nameList = (name: string) => `<NAME.LIST TYPE="String"><NAME>${esc(name)}</NAME></NAME.LIST>`

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------
export function buildMasterXml(kind: MasterKind, d: MasterInput, action: ImportAction): string {
  switch (kind) {
    case 'group': {
      const g = d as GroupInput
      return `<GROUP NAME="${esc(g.name)}" ACTION="${action}">${nameList(g.name)}<PARENT>${esc(g.parent)}</PARENT><ISSUBLEDGER>No</ISSUBLEDGER><AFFECTSGROSSPROFIT>No</AFFECTSGROSSPROFIT></GROUP>`
    }
    case 'ledger': {
      const l = d as LedgerInput
      const parts = [
        `<LEDGER NAME="${esc(l.name)}" ACTION="${action}">`,
        nameList(l.name),
        `<PARENT>${esc(l.parent)}</PARENT>`,
        `<ISBILLWISEON>${l.billWise ? 'Yes' : 'No'}</ISBILLWISEON>`,
        // Tally XML: debit balances are negative
        `<OPENINGBALANCE>${amt(-(l.openingBalance ?? 0))}</OPENINGBALANCE>`
      ]
      if (l.affectsStock) parts.push('<AFFECTSSTOCK>Yes</AFFECTSSTOCK>')
      const regType = l.gstRegistrationType ?? (l.gstin ? 'Regular' : undefined)
      if (l.address || l.state || l.gstin || l.pincode || l.phone || l.email || regType) {
        // Legacy (TallyPrime <= 2.x / ERP 9) fields
        if (l.address) parts.push(`<ADDRESS.LIST TYPE="String"><ADDRESS>${esc(l.address)}</ADDRESS></ADDRESS.LIST>`)
        if (l.state) parts.push(`<LEDSTATENAME>${esc(l.state)}</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME>`)
        if (l.pincode) parts.push(`<PINCODE>${esc(l.pincode)}</PINCODE>`)
        if (l.phone) parts.push(`<LEDGERPHONE>${esc(l.phone)}</LEDGERPHONE><LEDGERMOBILE>${esc(l.phone)}</LEDGERMOBILE>`)
        if (l.email) parts.push(`<EMAIL>${esc(l.email)}</EMAIL>`)
        if (regType) parts.push(`<GSTREGISTRATIONTYPE>${esc(regType)}</GSTREGISTRATIONTYPE>`)
        if (l.gstin) parts.push(`<PARTYGSTIN>${esc(l.gstin)}</PARTYGSTIN>`)
        // TallyPrime 3.x+/4.x+ dated sub-lists (ignored by older releases)
        parts.push(
          `<LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><MAILINGNAME>${esc(l.name)}</MAILINGNAME>` +
            (l.address ? `<ADDRESS.LIST TYPE="String"><ADDRESS>${esc(l.address)}</ADDRESS></ADDRESS.LIST>` : '') +
            (l.state ? `<STATE>${esc(l.state)}</STATE>` : '') +
            (l.pincode ? `<PINCODE>${esc(l.pincode)}</PINCODE>` : '') +
            `<COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST>`
        )
        if (l.gstin || regType)
          parts.push(
            `<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><GSTREGISTRATIONTYPE>${esc(regType ?? 'Regular')}</GSTREGISTRATIONTYPE>` +
              (l.state ? `<PLACEOFSUPPLY>${esc(l.state)}</PLACEOFSUPPLY>` : '') +
              (l.gstin ? `<GSTIN>${esc(l.gstin)}</GSTIN>` : '') + `</LEDGSTREGDETAILS.LIST>`
          )
      }
      if (l.gstDutyHead) {
        parts.push(`<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${esc(l.gstDutyHead)}</GSTDUTYHEAD>`)
        if (l.gstRate) parts.push(`<RATEOFTAXCALCULATION>${l.gstRate}</RATEOFTAXCALCULATION>`)
      }
      parts.push('</LEDGER>')
      return parts.join('')
    }
    case 'unit': {
      const u = d as UnitInput
      return `<UNIT NAME="${esc(u.name)}" ACTION="${action}"><NAME>${esc(u.name)}</NAME><ORIGINALNAME>${esc(u.formalName ?? u.name)}</ORIGINALNAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>${u.decimals ?? 0}</DECIMALPLACES></UNIT>`
    }
    case 'stock_group': {
      const g = d as StockGroupInput
      return `<STOCKGROUP NAME="${esc(g.name)}" ACTION="${action}">${nameList(g.name)}<PARENT>${esc(g.parent ?? '')}</PARENT><ISADDABLE>Yes</ISADDABLE></STOCKGROUP>`
    }
    case 'godown': {
      const g = d as GodownInput
      return `<GODOWN NAME="${esc(g.name)}" ACTION="${action}">${nameList(g.name)}<PARENT>${esc(g.parent ?? '')}</PARENT></GODOWN>`
    }
    case 'stock_item': {
      const s = d as StockItemInput
      const batches = s.openingBatches?.length
        ? s.openingBatches.filter((b) => b.qty)
        : s.openingQty ? [{ godown: s.godown || 'Main Location', qty: s.openingQty, rate: s.openingRate ?? 0 }] : []
      const q = batches.reduce((t, b) => t + b.qty, 0)
      const value = r2(batches.reduce((t, b) => t + r2(b.qty * b.rate), 0))
      const rate = q ? r2(value / q) : 0
      const parts = [
        `<STOCKITEM NAME="${esc(s.name)}" ACTION="${action}">`,
        nameList(s.name),
        `<PARENT>${esc(s.parent ?? '')}</PARENT>`,
        `<BASEUNITS>${esc(s.baseUnit)}</BASEUNITS>`,
        `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>`,
        `<GSTTYPEOFSUPPLY>${s.typeOfSupply ?? 'Goods'}</GSTTYPEOFSUPPLY>`
      ]
      if (q) {
        // Stock opening value is a debit -> negative in Tally XML
        parts.push(`<OPENINGBALANCE>${qtyStr(q, s.baseUnit)}</OPENINGBALANCE><OPENINGVALUE>${amt(-value)}</OPENINGVALUE><OPENINGRATE>${amt(rate)}/${esc(s.baseUnit)}</OPENINGRATE>`)
        for (const b of batches)
          parts.push(`<BATCHALLOCATIONS.LIST><GODOWNNAME>${esc(b.godown)}</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE>${qtyStr(b.qty, s.baseUnit)}</OPENINGBALANCE><OPENINGVALUE>${amt(-r2(b.qty * b.rate))}</OPENINGVALUE><OPENINGRATE>${amt(b.rate)}/${esc(s.baseUnit)}</OPENINGRATE></BATCHALLOCATIONS.LIST>`)
      }
      if (s.gstRate !== undefined || s.hsn) {
        const rate = s.gstRate ?? 0
        parts.push(
          `<GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>${esc(s.hsn ?? '')}</HSNCODE><TAXABILITY>Taxable</TAXABILITY>` +
            `<STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>` +
            `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${rate / 2}</GSTRATE></RATEDETAILS.LIST>` +
            `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${rate / 2}</GSTRATE></RATEDETAILS.LIST>` +
            `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${rate}</GSTRATE></RATEDETAILS.LIST>` +
            `</STATEWISEDETAILS.LIST></GSTDETAILS.LIST>`
        )
      }
      parts.push('</STOCKITEM>')
      return parts.join('')
    }
  }
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------
export interface VoucherTotals {
  lines: Array<VoucherLine & { amount: number }>
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export function computeTotals(v: VoucherInput): VoucherTotals {
  if (v.kind === 'receipt' || v.kind === 'payment') {
    const total = r2(v.amount ?? 0)
    return { lines: [], taxable: total, cgst: 0, sgst: 0, igst: 0, total }
  }
  const lines = (v.lines ?? []).map((l) => ({ ...l, amount: r2(l.qty * l.rate) }))
  const taxable = r2(lines.reduce((s, l) => s + l.amount, 0))
  let cgst = 0, sgst = 0, igst = 0
  for (const l of lines) {
    const rate = l.gstRate ?? 0
    if (v.taxMode === 'intra') { cgst += (l.amount * rate) / 200; sgst += (l.amount * rate) / 200 }
    else if (v.taxMode === 'inter') igst += (l.amount * rate) / 100
  }
  cgst = r2(cgst); sgst = r2(sgst); igst = r2(igst)
  return { lines, taxable, cgst, sgst, igst, total: r2(taxable + cgst + sgst + igst) }
}

export interface VoucherPostings {
  lines: Array<VoucherLine & { amount: number; ledger: string }>
  taxable: number
  tax: Array<{ ledger: string; head: 'cgst' | 'sgst' | 'igst'; amount: number }>
  roundOff: { ledger: string; amount: number } | null
  total: number // party amount (after rounding)
}

/** Every posting of an inventory voucher: per-line ledgers, tax per ledger, round-off. Sums balance exactly. */
export function voucherPostings(v: VoucherInput): VoucherPostings {
  const isSaleSide = isSaleSideKind(v.kind)
  const account = v.account ?? (isSaleSide ? 'Sales' : 'Purchase')
  const defTax = v.taxLedgers ?? { cgst: 'CGST', sgst: 'SGST', igst: 'IGST' }
  const lines = (v.lines ?? []).map((l) => ({ ...l, amount: r2(l.qty * l.rate), ledger: l.ledger ?? account }))
  const taxable = r2(lines.reduce((s, l) => s + l.amount, 0))
  const acc = new Map<string, { ledger: string; head: 'cgst' | 'sgst' | 'igst'; amount: number }>()
  const add = (ledger: string, head: 'cgst' | 'sgst' | 'igst', a: number) => {
    const k = `${head}\u0000${ledger}`
    const e = acc.get(k) ?? { ledger, head, amount: 0 }
    e.amount += a; acc.set(k, e)
  }
  for (const l of lines) {
    const rate = l.gstRate ?? 0
    if (!rate) continue
    const tl = l.taxLedgers ?? defTax
    if (v.taxMode === 'intra') { add(tl.cgst, 'cgst', (l.amount * rate) / 200); add(tl.sgst, 'sgst', (l.amount * rate) / 200) }
    else if (v.taxMode === 'inter') add(tl.igst, 'igst', (l.amount * rate) / 100)
  }
  const tax = [...acc.values()].map((t) => ({ ...t, amount: r2(t.amount) })).filter((t) => t.amount)
  const gross = r2(taxable + tax.reduce((s, t) => s + t.amount, 0))
  let total = gross
  let roundOff: VoucherPostings['roundOff'] = null
  if (v.roundOff?.enabled) {
    const q = gross / v.roundOff.precision
    const n = v.roundOff.mode === 'up' ? Math.ceil(q - 1e-9) : v.roundOff.mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q)
    total = r2(n * v.roundOff.precision)
    const diff = r2(total - gross)
    if (diff) roundOff = { ledger: v.roundOff.ledger, amount: diff }
  }
  return { lines, taxable, tax, roundOff, total }
}

function ledgerEntry(ledger: string, deemedPositive: boolean, amount: number, extra = '') {
  return `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${deemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(amount)}</AMOUNT>${extra}</LEDGERENTRIES.LIST>`
}

/**
 * Build a voucher. Sign convention in Tally XML: Debit = negative AMOUNT + ISDEEMEDPOSITIVE=Yes,
 * Credit = positive AMOUNT + ISDEEMEDPOSITIVE=No. All entries must sum to exactly 0.
 */
export function buildVoucherXml(v: VoucherInput, action: ImportAction): string {
  const vchType = v.voucherTypeName ?? VOUCHER_TYPE_NAME[v.kind]
  const t = computeTotals(v)
  const isOrder = v.kind === 'sales_order' || v.kind === 'purchase_order'
  const isNote = v.kind === 'credit_note' || v.kind === 'debit_note'
  const isInventory = v.kind !== 'receipt' && v.kind !== 'payment'
  const view = isInventory ? 'Invoice Voucher View' : 'Accounting Voucher View'
  const attrs =
    action === 'Alter'
      ? `DATE="${v.date}" TAGNAME="Voucher Number" TAGVALUE="${esc(v.number)}" VCHTYPE="${vchType}" ACTION="Alter" OBJVIEW="${view}"`
      : `VCHTYPE="${vchType}" ACTION="Create" OBJVIEW="${view}"`
  const head = [
    `<VOUCHER ${attrs}>`,
    `<DATE>${v.date}</DATE>`,
    `<EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>`,
    `<VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${esc(v.number)}</VOUCHERNUMBER>`,
    `<REFERENCE>${esc(v.reference ?? v.number)}</REFERENCE>`,
    `<PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>`,
    `<PARTYNAME>${esc(v.party)}</PARTYNAME>`,
    `<BASICBASEPARTYNAME>${esc(v.party)}</BASICBASEPARTYNAME>`,
    `<PERSISTEDVIEW>${view}</PERSISTEDVIEW>`,
    `<NARRATION>${esc(v.narration ?? `Created by TallySync [${v.number}]`)}</NARRATION>`
  ]
  const body: string[] = []

  if (isInventory) {
    head.push(`<ISINVOICE>${isOrder ? 'No' : 'Yes'}</ISINVOICE>`)
    if (isOrder) head.push(`<BASICORDERREF>${esc(v.number)}</BASICORDERREF>`)
    if (isNote && v.againstInvoice) head.push(`<ORIGINALINVOICENO>${esc(v.againstInvoice)}</ORIGINALINVOICENO>${v.againstInvoiceDate ? `<ORIGINALINVOICEDATE>${v.againstInvoiceDate}</ORIGINALINVOICEDATE>` : ''}`)
    const p = voucherPostings(v)
    // stock out (sales, sales order, debit note): line ledgers credited (positive), party debited.
    // stock in (purchase, purchase order, credit note): line ledgers debited (negative), party credited.
    const sign = isStockInKind(v.kind) ? -1 : 1
    const deemed = sign === -1
    for (const l of p.lines) {
      const unit = l.unit ?? 'Nos'
      const godown = l.godown || 'Main Location'
      const orderBits = isOrder
        ? `<ORDERNO>${esc(v.number)}</ORDERNO><ORDERDUEDATE P="${v.dueDate ?? v.date}">${v.dueDate ?? v.date}</ORDERDUEDATE>`
        : ''
      body.push(
        `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.item)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${deemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>` +
          `<RATE>${amt(l.rate)}/${esc(unit)}</RATE><AMOUNT>${amt(sign * l.amount)}</AMOUNT><ACTUALQTY>${qtyStr(l.qty, unit)}</ACTUALQTY><BILLEDQTY>${qtyStr(l.qty, unit)}</BILLEDQTY>` +
          `<BATCHALLOCATIONS.LIST><GODOWNNAME>${esc(godown)}</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME>${orderBits}<AMOUNT>${amt(sign * l.amount)}</AMOUNT><ACTUALQTY>${qtyStr(l.qty, unit)}</ACTUALQTY><BILLEDQTY>${qtyStr(l.qty, unit)}</BILLEDQTY></BATCHALLOCATIONS.LIST>` +
          `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${deemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(sign * l.amount)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` +
          `</ALLINVENTORYENTRIES.LIST>`
      )
    }
    const billRef = isNote && v.againstInvoice ? v.againstInvoice : v.number
    const bill = isOrder
      ? ''
      : `<BILLALLOCATIONS.LIST><NAME>${esc(billRef)}</NAME><BILLTYPE>${isNote && v.againstInvoice ? 'Agst Ref' : 'New Ref'}</BILLTYPE><AMOUNT>${amt(-sign * p.total)}</AMOUNT></BILLALLOCATIONS.LIST>`
    // party: opposite side of the line ledgers (debit = negative + deemed positive)
    body.push(ledgerEntry(v.party, sign === 1, -sign * p.total, `<ISPARTYLEDGER>Yes</ISPARTYLEDGER>${bill}`))
    for (const t of p.tax) body.push(ledgerEntry(t.ledger, deemed, sign * t.amount))
    if (p.roundOff) { const a = sign * p.roundOff.amount; body.push(ledgerEntry(p.roundOff.ledger, a < 0, a)) }
  } else {
    const cash = v.cashLedger ?? 'Cash'
    const receipt = v.kind === 'receipt'
    // Receipt: party credit (+), cash debit (-). Payment: party debit (-), cash credit (+)
    const partySign = receipt ? 1 : -1
    body.push(
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(v.party)}</LEDGERNAME><ISDEEMEDPOSITIVE>${receipt ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${amt(partySign * t.total)}</AMOUNT>` +
        `<BILLALLOCATIONS.LIST><NAME>${esc(v.reference ?? v.number)}</NAME><BILLTYPE>${v.reference ? 'Agst Ref' : 'On Account'}</BILLTYPE><AMOUNT>${amt(partySign * t.total)}</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>`,
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(cash)}</LEDGERNAME><ISDEEMEDPOSITIVE>${receipt ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(-partySign * t.total)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
    )
  }
  return [...head, ...body, '</VOUCHER>'].join('')
}
