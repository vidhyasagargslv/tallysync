/**
 * TallyEngine: the only thing that talks to Tally. Stateless apart from the client; the agent keeps cursors.
 * Every request names the company explicitly (SVCURRENTCOMPANY).
 */
import { DEFAULT_VOUCHER_TYPES, type CompanyLink, type PushResult, type Mapping, type MasterKind, type PulledObject, type PushEntity, type Voucher } from '@tallysync/contracts'
import { TallyClient } from './client.js'
import { OBJECTS, buildCollectionExport, buildLookup, tdlString, type ObjectKey } from './exports.js'
import { buildMasterXml, buildVoucherXml, importEnvelope, type ImportAction, type MasterInput, type VoucherInput } from './imports.js'
import { normalize, objectGuid, objectName } from './normalize.js'
import { exportError, parseImportResponse } from './responses.js'
import { extractElements, firstTagText, innerOf, num, parseXml, text } from './xml.js'

export class TallyExportError extends Error {}

export interface PullOutcome { objects: PulledObject[]; maxAlterId: number; requestXml: string; bytes: number }

export class TallyEngine {
  constructor(readonly client: TallyClient, public company: string, public dates: { from: string; to: string }) {}

  /** Companies currently loaded in Tally (no SVCURRENTCOMPANY, so Tally returns all open ones). */
  async openCompanies(): Promise<CompanyLink[]> {
    const xml = await this.client.post(buildCollectionExport(OBJECTS.company, { company: '' }))
    const err = exportError(xml)
    if (err) throw new TallyExportError(err)
    return extractElements(innerOf(xml, 'DATA') || xml, 'COMPANY').map((el) => {
      const j = parseXml(el).COMPANY ?? {}
      const n = normalize('company', j) as any
      return { guid: n.guid, name: n.name, gstin: n.gstin }
    })
  }

  async pull(key: ObjectKey, sinceAlterId = 0): Promise<PullOutcome> {
    const def = OBJECTS[key]
    const since = def.incremental ? sinceAlterId : 0
    const requestXml = buildCollectionExport(def, { company: this.company, sinceAlterId: since, fromDate: this.dates.from, toDate: this.dates.to })
    const xml = await this.client.post(requestXml)
    const err = exportError(xml)
    if (err) throw new TallyExportError(err)
    let maxAlterId = since
    const objects: PulledObject[] = []
    for (const el of extractElements(innerOf(xml, 'DATA') || xml, def.tag)) {
      const j = parseXml(el)[def.tag] ?? {}
      if (key === 'company' && objectName(key, j).toLowerCase() !== this.company.toLowerCase()) continue
      const alterid = num(j.ALTERID) || null
      if (alterid) maxAlterId = Math.max(maxAlterId, alterid)
      const data = normalize(key, j)
      objects.push({ guid: objectGuid(key, j), name: objectName(key, j), masterid: num(j.MASTERID) || null, alterid, parent: (data.parent as string) ?? null, data, rawXml: el, rawJson: j })
    }
    return { objects, maxAlterId, requestXml, bytes: xml.length }
  }

  /**
   * Closing balances change when vouchers are entered without bumping the master's ALTERID,
   * so balances are refreshed with a light full export every time.
   */
  async balances(key: 'ledger' | 'stock_item'): Promise<Array<Record<string, unknown>>> {
    const def = OBJECTS[key]
    const fetch = key === 'ledger' ? ['GUID', 'Name', 'Parent', 'ClosingBalance'] : ['GUID', 'Name', 'ClosingBalance', 'ClosingValue', 'ClosingRate', 'BaseUnits']
    const xml = await this.client.post(buildCollectionExport(def, { company: this.company, fetch }))
    const err = exportError(xml)
    if (err) throw new TallyExportError(err)
    return extractElements(innerOf(xml, 'DATA') || xml, def.tag).map((el) => {
      const j = parseXml(el)[def.tag] ?? {}
      return key === 'ledger'
        ? { guid: text(j.GUID), name: objectName(key, j), closingBalance: num(j.CLOSINGBALANCE) }
        : { guid: text(j.GUID), name: objectName(key, j), closingQty: num(j.CLOSINGBALANCE), closingValue: num(j.CLOSINGVALUE), closingRate: num(j.CLOSINGRATE) }
    })
  }

  private async lookup(key: ObjectKey, filter: string, dates?: { from: string; to: string }) {
    const def = OBJECTS[key]
    const xml = await this.client.post(buildLookup(def, this.company, filter, dates))
    const el = extractElements(innerOf(xml, 'DATA') || xml, def.tag)[0]
    if (!el) return undefined
    return { guid: firstTagText(el, 'GUID') ?? '', masterid: num(firstTagText(el, 'MASTERID')) }
  }

  /** Idempotent push: look the object up first; Alter when it exists, otherwise Create. */
  async push(entity: PushEntity, payload: any, mapping: Mapping): Promise<Omit<PushResult, "id">> {
    let requestXml = ''
    let responseXml = ''
    let action: ImportAction = 'Create'
    try {
      let after: () => Promise<{ guid: string; masterid: number } | undefined>
      if (isVoucher(entity)) {
        const input = toVoucherInput(payload as Voucher, mapping)
        const filter = `$VoucherNumber = ${tdlString(input.number)} AND $VoucherTypeName = ${tdlString(input.voucherTypeName!)}`
        const dates = { from: input.date < this.dates.from ? input.date : this.dates.from, to: input.date > this.dates.to ? input.date : this.dates.to }
        action = (await this.lookup('voucher', filter, dates)) ? 'Alter' : 'Create'
        requestXml = importEnvelope('Vouchers', this.company, [buildVoucherXml(input, action)])
        after = () => this.lookup('voucher', filter, dates)
      } else {
        const kind = entity as MasterKind
        const filter = `$Name = ${tdlString(payload.name)}`
        action = (await this.lookup(kind, filter)) ? 'Alter' : 'Create'
        requestXml = importEnvelope('All Masters', this.company, [buildMasterXml(kind, payload as MasterInput, action)])
        after = () => this.lookup(kind, filter)
      }
      responseXml = await this.client.post(requestXml)
      const r = parseImportResponse(responseXml)
      if (!r.ok) throw new Error(r.lineErrors.join(' | ') || `Tally did not create/alter anything (CREATED=${r.created} ALTERED=${r.altered} ERRORS=${r.errors} EXCEPTIONS=${r.exceptions})`)
      const ids = await after()
      return { status: "synced", action, voucherNumber: isVoucher(entity) ? String(payload.number) : undefined, tallyGuid: ids?.guid || undefined, tallyMasterId: ids?.masterid || undefined, requestXml, responseXml }
    } catch (e) {
      return { status: 'failed', action, error: e instanceof Error ? e.message : String(e), requestXml: requestXml || undefined, responseXml: responseXml || undefined }
    }
  }
}

export const isVoucher = (e: string) => ['sales_order', 'sales', 'purchase_order', 'purchase', 'receipt', 'payment'].includes(e)

/** Neutral voucher + tenant mapping -> Tally voucher input. */
export function toVoucherInput(v: Voucher, m: Mapping): VoucherInput {
  const saleSide = v.kind === 'sales' || v.kind === 'sales_order'
  const map = (dict: Record<string, string>, k: string) => dict[k] ?? k
  return {
    ...v,
    party: map(m.parties, v.party),
    voucherTypeName: m.voucherTypes[v.kind] ?? DEFAULT_VOUCHER_TYPES[v.kind],
    account: saleSide ? m.ledgers.sales : m.ledgers.purchase,
    taxLedgers: { cgst: m.ledgers.cgst, sgst: m.ledgers.sgst, igst: m.ledgers.igst },
    cashLedger: m.ledgers.cash,
    lines: v.lines?.map((l) => ({ ...l, item: map(m.items, l.item), unit: l.unit ? map(m.units, l.unit) : undefined, godown: l.godown || m.defaultGodown }))
  }
}
