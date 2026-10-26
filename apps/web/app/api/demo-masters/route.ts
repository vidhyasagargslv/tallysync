import { handle, json } from '@/lib/auth'
import { createRecord } from '@/lib/repo'
export const dynamic = 'force-dynamic'

/** Queue a small set of masters (units, godown, ledgers incl. GST, parties, items) so test orders can be pushed. */
const DEMO_MASTERS: Array<[string, Record<string, unknown>]> = [
  ['unit', { name: 'Nos' }],
  ['stock_group', { name: 'Finished Goods' }],
  ['godown', { name: 'Warehouse A' }],
  ['ledger', { name: 'Sales', parent: 'Sales Accounts' }],
  ['ledger', { name: 'Purchase', parent: 'Purchase Accounts' }],
  ['ledger', { name: 'CGST', parent: 'Duties & Taxes', gstDutyHead: 'Central Tax' }],
  ['ledger', { name: 'SGST', parent: 'Duties & Taxes', gstDutyHead: 'State Tax' }],
  ['ledger', { name: 'IGST', parent: 'Duties & Taxes', gstDutyHead: 'Integrated Tax' }],
  ['ledger', { name: 'Ravi Stores', parent: 'Sundry Debtors', gstin: '29ABCDE1234F1Z5', state: 'Karnataka', billWise: true }],
  ['ledger', { name: 'Supreme Supplies', parent: 'Sundry Creditors', gstin: '29PQRSX1234F1Z5', state: 'Karnataka', billWise: true }],
  ['stock_item', { name: 'Widget', parent: 'Finished Goods', baseUnit: 'Nos', hsn: '8471', gstRate: 18, openingQty: 100, openingRate: 50, godown: 'Warehouse A' }],
  ['stock_item', { name: 'Gadget', parent: 'Finished Goods', baseUnit: 'Nos', hsn: '8517', gstRate: 18, openingQty: 20, openingRate: 200, godown: 'Main Location' }]
]
export function POST() {
  return handle(() => json(DEMO_MASTERS.map(([entity, payload]) => createRecord({ entity, payload }).record), 201))
}
