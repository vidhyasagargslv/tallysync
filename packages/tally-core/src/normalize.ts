/** Tally parsed JSON -> neutral fields. The raw object is always kept alongside, this is only the convenient subset. */
import type { ObjectKey } from './exports.js'
import { asArray, num, text } from './xml.js'

const latest = (list: unknown) => {
  const a = asArray<any>(list)
  return a.length ? a[a.length - 1] : undefined
}
const has = (v: unknown) => text(v) !== ''

export function objectName(key: ObjectKey, j: any): string {
  if (key === 'voucher') return `${text(j.VOUCHERTYPENAME) || j['@VCHTYPE'] || ''}/${text(j.VOUCHERNUMBER)}`
  return String(j['@NAME'] ?? '') || text(j.NAME) || text(j['LANGUAGENAME.LIST']?.[0]?.['NAME.LIST']?.[0]?.NAME)
}

export function objectGuid(key: ObjectKey, j: any): string {
  return text(j.GUID) || String(j['@REMOTEID'] ?? '') || `${key}:${objectName(key, j)}`
}

export interface LedgerEntry { ledger: string; amount: number; isDeemedPositive: boolean; isParty: boolean; source: string }
export interface InventoryEntry { item: string; godown: string | null; batch: string | null; qty: number; unit: string; rate: number; amount: number; inward: boolean }

export function normalize(key: ObjectKey, j: any): Record<string, unknown> {
  switch (key) {
    case 'company':
      return {
        guid: text(j.GUID), name: objectName(key, j), gstin: text(j.GSTREGISTRATIONNUMBER) || text(j.GSTIN) || null,
        booksFrom: text(j.BOOKSFROM) || null, startingFrom: text(j.STARTINGFROM) || null, state: text(j.STATENAME) || null,
        altMstId: num(j.ALTMSTID), altVchId: num(j.ALTVCHID)
      }
    case 'voucher': return normalizeVoucher(j)
    default: {
      const d: Record<string, unknown> = { parent: text(j.PARENT) || null, reservedName: String(j['@RESERVEDNAME'] ?? '') || null }
      if (key === 'ledger') {
        const mailing = latest(j['LEDMAILINGDETAILS.LIST'])
        const gstReg = latest(j['LEDGSTREGDETAILS.LIST'])
        Object.assign(d, {
          openingBalance: has(j.OPENINGBALANCE) ? num(j.OPENINGBALANCE) : null,
          closingBalance: has(j.CLOSINGBALANCE) ? num(j.CLOSINGBALANCE) : null,
          gstin: text(j.PARTYGSTIN) || text(gstReg?.GSTIN) || null,
          state: text(j.LEDSTATENAME) || text(mailing?.STATE) || null
        })
      }
      if (key === 'stock_item') {
        let gstRate: number | null = null
        const gst = latest(j['GSTDETAILS.LIST'])
        for (const sw of asArray<any>(gst?.['STATEWISEDETAILS.LIST']))
          for (const rd of asArray<any>(sw['RATEDETAILS.LIST'])) if (/IGST|Integrated/i.test(text(rd.GSTRATEDUTYHEAD))) gstRate = num(rd.GSTRATE)
        Object.assign(d, {
          baseUnits: text(j.BASEUNITS) || null, hsn: text(gst?.HSNCODE) || null, gstRate,
          openingQty: has(j.OPENINGBALANCE) ? num(j.OPENINGBALANCE) : null,
          closingQty: has(j.CLOSINGBALANCE) ? num(j.CLOSINGBALANCE) : null,
          closingValue: has(j.CLOSINGVALUE) ? num(j.CLOSINGVALUE) : null,
          openingBatches: asArray<any>(j['BATCHALLOCATIONS.LIST']).map((b) => ({ godown: text(b.GODOWNNAME) || 'Main Location', qty: num(b.OPENINGBALANCE) }))
        })
      }
      return d
    }
  }
}

function normalizeVoucher(j: any) {
  const party = text(j.PARTYLEDGERNAME) || text(j.PARTYNAME)
  const all = asArray<any>(j['ALLLEDGERENTRIES.LIST'])
  const ledgerEntries: LedgerEntry[] = []
  let partyAmount: number | undefined
  let positive = 0
  for (const e of all.length ? all : asArray<any>(j['LEDGERENTRIES.LIST'])) {
    const ledger = text(e.LEDGERNAME)
    const amount = num(e.AMOUNT)
    const isParty = text(e.ISPARTYLEDGER) === 'Yes' || ledger === party
    if (isParty && partyAmount === undefined) partyAmount = Math.abs(amount)
    if (amount > 0) positive += amount
    ledgerEntries.push({ ledger, amount, isDeemedPositive: text(e.ISDEEMEDPOSITIVE) === 'Yes', isParty, source: 'ledger_entries' })
  }
  const inventoryEntries: InventoryEntry[] = []
  const allInv = asArray<any>(j['ALLINVENTORYENTRIES.LIST'])
  for (const e of allInv.length ? allInv : asArray<any>(j['INVENTORYENTRIES.LIST'])) {
    const item = text(e.STOCKITEMNAME)
    const inward = text(e.ISDEEMEDPOSITIVE) === 'Yes'
    const unit = text(e.ACTUALQTY).replace(/^[-\d.\s]+/, '').trim() || text(e.BILLEDQTY).replace(/^[-\d.\s]+/, '').trim()
    const rate = num(e.RATE)
    for (const a of asArray<any>(e['ACCOUNTINGALLOCATIONS.LIST'])) {
      const amount = num(a.AMOUNT)
      if (amount > 0) positive += amount
      ledgerEntries.push({ ledger: text(a.LEDGERNAME), amount, isDeemedPositive: text(a.ISDEEMEDPOSITIVE) === 'Yes', isParty: false, source: 'accounting_allocation' })
    }
    const batches = asArray<any>(e['BATCHALLOCATIONS.LIST'])
    if (batches.length) for (const b of batches)
      inventoryEntries.push({ item, godown: text(b.GODOWNNAME) || null, batch: text(b.BATCHNAME) || null, qty: num(b.ACTUALQTY), unit, rate, amount: num(b.AMOUNT), inward })
    else inventoryEntries.push({ item, godown: null, batch: null, qty: num(e.ACTUALQTY), unit, rate, amount: num(e.AMOUNT), inward })
  }
  return {
    date: text(j.DATE), voucherType: text(j.VOUCHERTYPENAME) || String(j['@VCHTYPE'] ?? ''), voucherNumber: text(j.VOUCHERNUMBER),
    reference: text(j.REFERENCE) || null, party: party || null, amount: partyAmount ?? positive, narration: text(j.NARRATION) || null,
    isCancelled: text(j.ISCANCELLED) === 'Yes', isOptional: text(j.ISOPTIONAL) === 'Yes', ledgerEntries, inventoryEntries
  }
}
