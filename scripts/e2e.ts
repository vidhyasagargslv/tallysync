/**
 * End-to-end test in mock mode: the built Next.js app (own SQLite file) + the real agent code + simulated Tally.
 * configure agent -> company locked -> demo masters + SO + PO -> agent pushes -> statuses synced -> pulls all
 * entities -> data via Next.js API -> disable an entity -> GUID mismatch blocks -> bad API key rejected -> closed company.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tallysync-e2e-'))
process.env.TALLYSYNC_HOME = path.join(tmp, 'agent')
process.env.TALLY_MODE = 'mock'
process.env.TALLYSYNC_QUIET = '1'
const KEY = 'e2e-key-123456'
const port = 3900 + Math.floor(Math.random() * 90)
const base = `http://127.0.0.1:${port}`
const mappingFile = path.join(tmp, 'tally-mapping.jsonc')
fs.copyFileSync(path.join(root, 'apps/web/config/tally-mapping.jsonc'), mappingFile)
let mtimeBump = 0
const writeMapping = (m: unknown) => {
  fs.writeFileSync(mappingFile, JSON.stringify(m, null, 2))
  const t = new Date(Date.now() + ++mtimeBump * 2000); fs.utimesSync(mappingFile, t, t)
}

if (!fs.existsSync(path.join(root, 'apps/web/.next/BUILD_ID'))) { console.error('build the web app first: npm run build -w @tallysync/web'); process.exit(1) }
const web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: path.join(root, 'apps/web'), env: { ...process.env, DATABASE_PATH: path.join(tmp, 'web.db'), TALLYSYNC_API_KEY: KEY, TALLY_MAPPING_PATH: mappingFile, SYNC_REQUEST_TTL_SEC: '4' }, stdio: ['ignore', 'pipe', 'pipe']
})
let webOut = ''
web.stdout.on('data', (d) => (webOut += d)); web.stderr.on('data', (d) => (webOut += d))
const cleanup = () => { try { web.kill() } catch {} }
process.on('exit', cleanup)
for (let i = 0; ; i++) {
  try { if ((await fetch(base + '/api/settings')).ok) break } catch {}
  if (i > 120) { console.error('web did not start\n' + webOut); process.exit(1) }
  await new Promise((r) => setTimeout(r, 500))
}

const { Agent } = await import('../apps/agent/src/agent.js')
const { getMockTally, mockConfig } = await import('@tallysync/tally-core')

let pass = 0, fail = 0
const check = (name: string, ok: unknown, detail?: unknown) => {
  if (ok) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 700)) }
}
async function api(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let b: any; try { b = text ? JSON.parse(text) : undefined } catch { b = text }
  return { status: res.status, body: b }
}
console.log(`e2e: web ${base}, temp ${tmp}`)

console.log('1. agent setup + company lock')
const agent = new Agent()
check('all 15 pulls enabled by default', Object.values(agent.settings.sync.pull).filter((x: any) => x.enabled).length === 15)
let c: any = await agent.cycle()
check('unconfigured agent does nothing', c.skipped && c.reason === 'not configured', c)
agent.configure({ backendUrl: base, apiKey: KEY, companyName: 'Demo Sync Co', tallyMode: 'mock' })
let r = await api('POST', '/api/demo-masters')
check('demo masters queued (12)', r.status === 201 && r.body.length === 12, r.body)
c = await agent.cycle({ forcePull: true })
const mockGuid = getMockTally().state.companyGuid
check('gate matched', c.gate === 'matched', c)
check('company GUID locked on first connect', agent.settings.lockedCompany?.guid === mockGuid, agent.settings.lockedCompany)
check('12 masters pushed', c.pushed === 12, c)
check('pulled all 15 entities', c.pulled.length === 15, c.pulled)
r = await api('GET', '/api/settings')
check('backend linked to same GUID', r.body.company.guid === mockGuid && r.body.company.name === 'Demo Sync Co', r.body)
r = await api('GET', '/api/records')
check('all masters synced with Tally GUID', r.body.length === 12 && r.body.every((x: any) => x.status === 'synced' && x.tallyGuid), r.body.filter((x: any) => x.status !== 'synced'))

console.log('2. sales order + purchase order -> Tally')
const so = { number: 'SO-1001', date: '20260415', party: 'Ravi Stores', taxMode: 'intra', lines: [{ item: 'Widget', qty: 10, rate: 100, gstRate: 18, godown: 'Warehouse A' }] }
const po = { number: 'PO-1001', date: '20260416', party: 'Supreme Supplies', taxMode: 'intra', lines: [{ item: 'Gadget', qty: 5, rate: 150, gstRate: 18 }] }
r = await api('POST', '/api/records', { entity: 'sales_order', payload: so }); const soId = r.body.id
check('SO created as pending', r.status === 201 && r.body.status === 'pending', r.body)
r = await api('POST', '/api/records', { entity: 'purchase_order', payload: po }); const poId = r.body.id
check('PO created as pending', r.status === 201 && r.body.status === 'pending', r.body)
r = await api('POST', '/api/records', { entity: 'sales_order', payload: { number: 'SO-BAD', date: '20260415', party: 'Unknown Party', lines: [{ item: 'Widget', qty: 1, rate: 1 }] } }); const badId = r.body.id
r = await api('POST', '/api/records', { entity: 'sales_order', payload: { number: 'X', date: '2026-04-15', party: 'a' } })
check('invalid record rejected by contract (400)', r.status === 400, r.body)
c = await agent.cycle({ forcePull: true })
check('3 records processed', c.pushed === 3, c)
r = await api('GET', `/api/records/${soId}`)
check('SO synced with Tally GUID + voucher no', r.body.status === 'synced' && r.body.tallyGuid && r.body.voucherNumber === 'SO-1001' && r.body.action === 'Create', r.body)
check('SO keeps request/response XML', /<ENVELOPE>/.test(r.body.requestXml ?? '') && /CREATED/.test(r.body.responseXml ?? ''))
r = await api('GET', `/api/records/${poId}`)
check('PO synced', r.body.status === 'synced' && r.body.tallyGuid, r.body)
r = await api('GET', `/api/records/${badId}`)
check('bad SO failed with Tally error', r.body.status === 'failed' && /Unknown Party|does not exist/i.test(r.body.error ?? ''), r.body)
r = await api('POST', `/api/records/${badId}/retry`)
check('retry re-queues failed record', r.body.ok === true)
r = await api('GET', `/api/records/${badId}`)
check('retried record is pending', r.body.status === 'pending')
r = await api('POST', '/api/records', { entity: 'sales_order', payload: { ...so, narration: 'edited' } })
check('same SO number updates + re-queues', r.status === 200 && r.body.id === soId && r.body.status === 'pending', r.body)
c = await agent.cycle()
r = await api('GET', `/api/records/${soId}`)
check('second push is Alter (idempotent, no duplicate)', r.body.status === 'synced' && r.body.action === 'Alter', r.body)

console.log('3. pulled data visible via Next.js API')
c = await agent.cycle({ forcePull: true })
r = await api('GET', '/api/agent-status')
check('heartbeat stored, company matched', r.body.agent?.status.companyState === 'matched' && r.body.agent.online, r.body.agent)
check('pull state for all 15 entities', r.body.pullState.length === 15, r.body.pullState.map((p: any) => p.entity))
r = await api('GET', '/api/data/ledger')
check('ledgers pulled (incl. Ravi Stores)', r.body.some((l: any) => l.name === 'Ravi Stores'), r.body.map((l: any) => l.name))
const ravi = r.body.find((l: any) => l.name === 'Ravi Stores')
r = await api('GET', `/api/data/ledger/${encodeURIComponent(ravi.guid)}`)
check('raw record has full raw JSON + XML', r.body.raw && /<LEDGER/.test(r.body.raw_xml), Object.keys(r.body ?? {}))
for (const e of ['company', 'group', 'cost_centre', 'currency', 'unit', 'stock_group', 'stock_category', 'godown', 'stock_item', 'voucher_type']) {
  const x = await api('GET', `/api/data/${e}`); if (!x.body.length) check(`${e} pulled`, false)
}
check('all master entity types have rows', true)
r = await api('GET', '/api/reports/vouchers?category=sales_order')
check('sales order pulled back (1, no duplicate)', r.body.length === 1 && r.body[0].voucherNumber === 'SO-1001', r.body)
r = await api('GET', '/api/reports/vouchers?category=purchase_order')
check('purchase order pulled back', r.body.length === 1 && r.body[0].voucherNumber === 'PO-1001', r.body)
r = await api('GET', '/api/reports/stock')
check('stock report has Tally closing rows', r.body.some((s: any) => s.item === 'Widget' && s.source === 'tally_closing' && s.qty === 100), r.body)
r = await api('GET', '/api/reports/trial-balance')
check('trial balance returned', Array.isArray(r.body.rows))
r = await api('GET', '/api/reports/outstanding')
check('outstanding returned', Array.isArray(r.body))
r = await api('GET', '/api/schema')
const fields = r.body.reduce((s: number, x: any) => s + x.fields, 0)
check('schema explorer recorded field paths', fields > 100 && r.body.some((x: any) => x.entity === 'voucher'), r.body)
for (const p of ['/', '/orders?type=sales_order', '/orders?type=purchase_order', '/orders?type=masters', '/stock', '/ledgers', '/vouchers', '/reports', '/masters?entity=ledger', '/schema?entity=ledger', '/log', '/settings', `/raw/ledger/${encodeURIComponent(ravi.guid)}`]) {
  const res = await fetch(base + p); if (res.status !== 200) check(`page ${p}`, false, res.status)
}
check('all UI pages render (200)', true)

console.log('4. disable one entity')
agent.setPullEnabled('godown', false)
c = await agent.cycle({ forcePull: true })
check('godown skipped, 14 pulled', c.pulled.length === 14 && !c.pulled.includes('godown'), c.pulled)
r = await api('GET', '/api/agent-status')
check('backend sees godown disabled', !r.body.agent.status.enabledPulls.includes('godown'))
agent.setPullEnabled('godown', true)

console.log('5. company gate')
const lock = agent.settings.lockedCompany!
agent.saveSettings({ lockedCompany: { ...lock, guid: 'wrong-guid' } })
await api('POST', '/api/records', { entity: 'purchase_order', payload: { ...po, number: 'PO-1002' } })
c = await agent.cycle({ forcePull: true })
check('GUID mismatch blocks push + pull', c.gate === 'mismatch' && c.pushed === 0 && c.pulled.length === 0, c)
r = await api('GET', '/api/agent-status')
check('backend sees companyState=mismatch', r.body.agent.status.companyState === 'mismatch', r.body.agent.status)
r = await api('GET', '/api/tally-sync/pending', undefined, { 'x-api-key': KEY, 'x-company-guid': 'wrong-guid' })
check('backend gate rejects wrong company GUID (409)', r.status === 409 && /mismatch/.test(r.body.error), r.body)
r = await api('GET', '/api/records?status=pending')
check('PO-1002 still pending while blocked', r.body.some((x: any) => x.label.startsWith('PO-1002')))
agent.saveSettings({ lockedCompany: lock })
mockConfig.open = false
c = await agent.cycle({ forcePull: true })
check('closed company blocks sync', c.gate === 'not_open' && c.pushed === 0, c)
mockConfig.open = true
c = await agent.cycle()
check('right company again -> PO-1002 pushed', c.gate === 'matched' && c.pushed >= 1, c)

console.log('6. API key')
r = await api('GET', '/api/tally-sync/pending', undefined, { 'x-api-key': 'wrong', 'x-company-guid': lock.guid })
check('bad API key rejected (401)', r.status === 401, r)
r = await api('POST', '/api/tally-sync/status', {}, {})
check('missing API key rejected (401)', r.status === 401)
agent.configure({ apiKey: 'wrong-key' })
c = await agent.cycle()
check('agent with bad key gets 401', c.status === 401, c)
r = await api('POST', '/api/settings/api-key')
const newKey = r.body.apiKey
agent.configure({ apiKey: newKey })
c = await agent.cycle()
check('regenerated key works', c.gate === 'matched' && !c.error, c)

console.log('7. declarative mapping')
const hdr = { 'x-api-key': newKey }
r = await api('GET', '/api/tally-sync/mapping', undefined, hdr)
check('mapping served with version + hash', r.status === 200 && r.body.version === '1' && /^[0-9a-f]{64}$/.test(r.body.hash) && r.body.mapping.sales.default === 'Sales', r.body)
check('agent already uses backend mapping', agent.mappingSource === 'backend' && agent.mappingCache?.hash === r.body.hash, agent.mappingSource)
r = await api('GET', '/api/tally-sync/mapping')
check('mapping endpoint needs API key', r.status === 401)
const rich: any = {
  version: '2',
  sales: { default: 'Sales', rules: [{ gstRate: 5, supply: 'local', ledger: 'Sales 5% Local' }, { supply: 'interstate', ledger: 'Sales Interstate' }] },
  tax: { cgst: 'CGST', sgst: 'SGST', igst: 'IGST', byRate: { '5': { cgst: 'CGST 2.5%', sgst: 'SGST 2.5%', igst: 'IGST 5%' } } },
  roundOff: { enabled: true, ledger: 'Round Off', mode: 'nearest', precision: 1 },
  autoCreate: { parties: false, ledgers: false, items: false }
}
writeMapping(rich)
const inv1 = { number: 'INV-2001', date: '20260420', party: 'New Customer', taxMode: 'intra', lines: [{ item: 'Widget', qty: 2, rate: 100.25, gstRate: 18 }, { item: 'Gadget', qty: 1, rate: 99.99, gstRate: 5 }] }
r = await api('POST', '/api/records', { entity: 'sales', payload: inv1 }); const inv1Id = r.body.id
c = await agent.cycle()
r = await api('GET', '/api/tally-sync/mapping', undefined, hdr)
check('mapping change picked up without restart', agent.mappingCache?.version === '2' && agent.mappingCache?.hash === r.body.hash, agent.mappingCache?.version)
r = await api('GET', '/api/mapping')
const iss = r.body.validation?.issues ?? []
check('missing ledgers reported to backend', ['Sales 5% Local', 'Sales Interstate', 'CGST 2.5%', 'Round Off'].every((n) => iss.some((i: any) => i.name === n && i.kind === 'ledger' && i.level === 'error')), iss)
check('validation hash matches served mapping', r.body.validation.hash === r.body.hash && !r.body.validation.ok)
r = await api('GET', `/api/records/${inv1Id}`)
check('record fails with clear message when autoCreate off', r.body.status === 'failed' && /Party ledger 'New Customer' not found.*autoCreate\.parties/.test(r.body.error ?? ''), r.body.error)
let pageRes = await fetch(base + '/mapping')
check('mapping page renders with issues', pageRes.status === 200 && (await pageRes.text()).includes('Sales 5% Local'))

writeMapping({ ...rich, version: '3', autoCreate: { parties: true, ledgers: true, items: false } })
await api('POST', `/api/records/${inv1Id}/retry`)
const inv2 = { number: 'INV-2002', date: '20260421', party: 'Ravi Stores', taxMode: 'inter', lines: [{ item: 'Widget', qty: 1, rate: 100, gstRate: 18 }] }
r = await api('POST', '/api/records', { entity: 'sales', payload: inv2 }); const inv2Id = r.body.id
c = await agent.cycle({ forcePull: true })
check('v3 picked up', agent.mappingCache?.version === '3')
r = await api('GET', `/api/records/${inv1Id}`)
check('INV-2001 synced after autoCreate', r.body.status === 'synced', r.body.error)
r = await api('GET', `/api/records/${inv2Id}`)
check('INV-2002 (interstate) synced', r.body.status === 'synced', r.body.error)
r = await api('GET', '/api/data/ledger')
const led = new Map(r.body.map((l: any) => [l.name, l]))
check('party auto-created under Sundry Debtors', (led.get('New Customer') as any)?.parent === 'Sundry Debtors', led.get('New Customer'))
check('ledgers auto-created under configured groups', (led.get('Sales 5% Local') as any)?.parent === 'Sales Accounts' && (led.get('CGST 2.5%') as any)?.parent === 'Duties & Taxes' && (led.get('Round Off') as any)?.parent === 'Indirect Expenses', ['Sales 5% Local', 'CGST 2.5%', 'Round Off'].map((n) => led.get(n)))
r = await api('GET', '/api/reports/vouchers?category=sales')
const v1 = r.body.find((v: any) => v.voucherNumber === 'INV-2001')
const v2 = r.body.find((v: any) => v.voucherNumber === 'INV-2002')
const amt = (v: any, n: string) => (v?.ledgerEntries ?? []).filter((e: any) => e.ledger === n).reduce((s: number, e: any) => s + e.amount, 0)
const r2 = (n: number) => Math.round(n * 100) / 100
check('per-rate sales ledger split (18% -> Sales, 5% -> Sales 5% Local)', r2(amt(v1, 'Sales')) === 200.5 && r2(amt(v1, 'Sales 5% Local')) === 99.99, v1?.ledgerEntries)
check('per-rate tax ledgers (CGST 9% on 18%, CGST 2.5% on 5%)', r2(amt(v1, 'CGST')) === 18.05 && r2(amt(v1, 'CGST 2.5%')) === 2.5 && r2(amt(v1, 'SGST 2.5%')) === 2.5, v1?.ledgerEntries)
const nonAlloc = (v: any) => (v?.ledgerEntries ?? []).filter((e: any) => e.source !== 'accounting_allocation')
const sum1 = r2(nonAlloc(v1).reduce((s: number, e: any) => s + e.amount, 0) + (v1?.ledgerEntries ?? []).filter((e: any) => e.source === 'accounting_allocation').reduce((s: number, e: any) => s + e.amount, 0))
check('round-off posted, party total rounded, voucher balanced', v1?.amount === 342 && r2(amt(v1, 'Round Off')) === 0.41 && sum1 === 0, { amount: v1?.amount, ro: amt(v1, 'Round Off'), sum1, e: v1?.ledgerEntries })
check('interstate -> IGST + Sales Interstate, no CGST', r2(amt(v2, 'IGST')) === 18 && r2(amt(v2, 'Sales Interstate')) === 100 && !amt(v2, 'CGST') && v2?.amount === 118, v2?.ledgerEntries)

writeMapping({ ...rich, version: 'broken', sales: { rules: [] } })
c = await agent.cycle()
check('invalid mapping rejected, agent keeps last good copy', agent.mappingCache?.version === '3' && agent.mappingSource === 'cache', agent.mappingSource)
r = await api('GET', '/api/mapping')
check('UI shows schema error', r.body.ok === false && r.body.errors.some((e: string) => /sales\.default/.test(e)), r.body.errors)
fs.copyFileSync(path.join(root, 'apps/web/config/tally-mapping.jsonc'), mappingFile); { const t = new Date(Date.now() + 60_000); fs.utimesSync(mappingFile, t, t) }
r = await api('GET', '/api/tally-sync/mapping', undefined, hdr)
check('shipped JSONC config parses', r.status === 200 && r.body.mapping.groups.customers === 'Sundry Debtors', r.body)

console.log('8. customers, suppliers, items from the app')
const cust = { name: 'Kiran Traders', parent: 'Sundry Debtors', billWise: true, gstRegistrationType: 'Regular', gstin: '29KIRAN1234F1Z5', state: 'Karnataka', address: '12 MG Road, Bengaluru', pincode: '560001', phone: '9876543210', email: 'kiran@example.com', openingBalance: 500 }
const supp = { name: 'Metro Wholesale', parent: 'Sundry Creditors', billWise: true, gstRegistrationType: 'Regular', gstin: '29METRO1234F1Z5', state: 'Karnataka' }
const bolt = { name: 'Bolt', parent: 'Finished Goods', baseUnit: 'Nos', hsn: '7318', gstRate: 12, typeOfSupply: 'Goods', openingBatches: [{ godown: 'Warehouse A', qty: 50, rate: 10 }, { godown: 'Main Location', qty: 20, rate: 10 }] }
r = await api('POST', '/api/records', { entity: 'ledger', payload: cust }); const custId = r.body.id
check('customer created pending', r.status === 201 && r.body.status === 'pending', r.body)
r = await api('POST', '/api/records', { entity: 'ledger', payload: supp }); const suppId = r.body.id
r = await api('POST', '/api/records', { entity: 'stock_item', payload: bolt }); const boltId = r.body.id
r = await api('POST', '/api/records', { entity: 'ledger', payload: { ...cust, name: 'Bad GSTIN Co', gstin: '123' } })
check('invalid GSTIN rejected (400)', r.status === 400)
const so3 = { number: 'SO-3001', date: '20260422', party: 'Kiran Traders', taxMode: 'intra', lines: [{ item: 'Bolt', qty: 5, rate: 20, gstRate: 12 }] }
const po3 = { number: 'PO-3001', date: '20260422', party: 'Metro Wholesale', taxMode: 'intra', lines: [{ item: 'Bolt', qty: 10, rate: 9, gstRate: 12 }] }
r = await api('POST', '/api/records', { entity: 'sales_order', payload: so3 }); const so3Id = r.body.id
r = await api('POST', '/api/records', { entity: 'purchase_order', payload: po3 }); const po3Id = r.body.id
c = await agent.cycle({ forcePull: true })
const st = async (id: string) => (await api('GET', `/api/records/${id}`)).body
check('customer, supplier, item synced (Create)', [await st(custId), await st(suppId), await st(boltId)].every((x) => x.status === 'synced' && x.action === 'Create' && x.tallyGuid), [custId, suppId, boltId])
check('SO + PO using them synced in same cycle', (await st(so3Id)).status === 'synced' && (await st(po3Id)).status === 'synced', [await st(so3Id), await st(po3Id)].map((x) => x.error))
r = await api('GET', '/api/data/ledger')
const kiran = r.body.find((l: any) => l.name === 'Kiran Traders')
check('customer in Tally under Sundry Debtors with GSTIN', kiran?.parent === 'Sundry Debtors' && kiran.data.gstin === '29KIRAN1234F1Z5', kiran)
check('supplier in Tally under Sundry Creditors', r.body.some((l: any) => l.name === 'Metro Wholesale' && l.parent === 'Sundry Creditors'))
r = await api('GET', `/api/data/ledger/${encodeURIComponent(kiran.guid)}`)
check('customer XML has pincode/phone/email/reg type', /<PINCODE>560001/.test(r.body.raw_xml) && /9876543210/.test(r.body.raw_xml) && /kiran@example.com/.test(r.body.raw_xml) && /<GSTREGISTRATIONTYPE>Regular/.test(r.body.raw_xml), r.body.raw_xml?.slice(0, 400))
r = await api('GET', '/api/data/stock_item')
const boltT = r.body.find((i: any) => i.name === 'Bolt')
check('item in Tally: HSN, GST 12%, opening 70 across 2 godowns', boltT?.data.hsn === '7318' && boltT.data.gstRate === 12 && boltT.data.openingBatches?.length === 2 && boltT.parent === 'Finished Goods', boltT?.data)
r = await api('GET', '/api/reports/stock')
check('stock per godown from item openings', r.body.some((s: any) => s.item === 'Bolt' && s.godown === 'Warehouse A' && s.qty === 50) && r.body.some((s: any) => s.item === 'Bolt' && s.godown === 'Main Location' && s.qty === 20), r.body.filter((s: any) => s.item === 'Bolt'))
r = await api('GET', `/api/records/${boltId}`)
check('item request XML uses GSTDETAILS/HSNCODE builder format', /<GSTDETAILS.LIST>.*<HSNCODE>7318<\/HSNCODE>.*<GSTRATE>6<\/GSTRATE>.*<GSTRATE>12<\/GSTRATE>/.test(r.body.requestXml ?? ''))

r = await api('PUT', `/api/records/${custId}`, { ...cust, phone: '9000000000' })
check('edit customer re-queues', r.status === 200 && r.body.status === 'pending', r.body)
r = await api('PUT', `/api/records/${custId}`, { ...cust, name: 'Renamed' })
check('rename rejected (400)', r.status === 400, r.body)
c = await agent.cycle({ forcePull: true })
r = await api('GET', `/api/records/${custId}`)
check('edited customer pushed as Alter', r.body.status === 'synced' && r.body.action === 'Alter', r.body)
r = await api('GET', '/api/data/ledger')
check('no duplicate customer in Tally', r.body.filter((l: any) => l.name === 'Kiran Traders').length === 1)
const kiran2 = r.body.find((l: any) => l.name === 'Kiran Traders')
r = await api('GET', `/api/data/ledger/${encodeURIComponent(kiran2.guid)}`)
check('altered phone in Tally', /9000000000/.test(r.body.raw_xml) && kiran2.guid === kiran.guid)

r = await api('POST', '/api/records', { entity: 'stock_item', payload: { name: 'Nut', parent: 'No Such Group', baseUnit: 'Nos', hsn: '7318', gstRate: 18 } }); const nutId = r.body.id
c = await agent.cycle()
check('item with bad stock group fails', (await st(nutId)).status === 'failed')
r = await api('POST', '/api/records', { entity: 'sales_order', payload: { number: 'SO-3002', date: '20260423', party: 'Kiran Traders', taxMode: 'intra', lines: [{ item: 'Nut', qty: 3, rate: 5, gstRate: 18 }] } }); const so4Id = r.body.id
c = await agent.cycle()
let so4 = await st(so4Id)
check('SO waits for unsynced item (stays pending)', so4.status === 'pending' && /waiting for stock_item Nut/.test(so4.error ?? '') && c.pushed === 0, so4)
r = await api('PUT', `/api/records/${nutId}`, { name: 'Nut', parent: 'Finished Goods', baseUnit: 'Nos', hsn: '7318', gstRate: 18 })
c = await agent.cycle()
so4 = await st(so4Id)
check('item fixed -> item then SO sync in order', (await st(nutId)).status === 'synced' && so4.status === 'synced' && !so4.error, [await st(nutId), so4].map((x) => [x.status, x.error]))
for (const p of ['/customers', '/suppliers', '/items', `/customers?edit=${custId}`, `/items?edit=${boltId}`, '/orders?type=sales_order']) {
  const res = await fetch(base + p); if (res.status !== 200) check(`page ${p}`, false, res.status)
}
const html = await (await fetch(base + '/orders?type=sales_order')).text()
check('SO form picker lists local customer + items', html.includes('Kiran Traders') && html.includes('Bolt'))
check('nav shows Create + Tally data sections', /Customers.*Suppliers.*Items.*Sales Orders.*Purchase Orders/s.test(html) && /Stock.*Ledgers.*Vouchers.*Reports/s.test(html))

console.log('8b. credit note + debit note -> Tally')
{
  const partyAmt = (xml: string, party: string) => Number(new RegExp(`<LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>(Yes|No)</ISDEEMEDPOSITIVE><AMOUNT>(-?[\\d.]+)</AMOUNT><ISPARTYLEDGER>`).exec(xml)?.[2])
  const cn = { number: 'CN-1001', date: '20260425', party: 'Ravi Stores', taxMode: 'intra', againstInvoice: 'SO-1001', againstInvoiceDate: '20260415', narration: 'Damaged goods returned', lines: [{ item: 'Widget', qty: 2, rate: 100, gstRate: 18 }] }
  const dn = { number: 'DN-1001', date: '20260426', party: 'Supreme Supplies', taxMode: 'inter', lines: [{ item: 'Gadget', qty: 1, rate: 150, gstRate: 18 }] }
  r = await api('POST', '/api/records', { entity: 'credit_note', payload: cn }); const cnId = r.body.id
  check('credit note created as pending (priority voucher)', r.status === 201 && r.body.status === 'pending', r.body)
  r = await api('POST', '/api/records', { entity: 'debit_note', payload: dn }); const dnId = r.body.id
  check('debit note created as pending', r.status === 201 && r.body.status === 'pending', r.body)
  r = await api('POST', '/api/records', { entity: 'credit_note', payload: { number: 'CN-BAD', date: '20260425', party: 'Ravi Stores' } })
  check('credit note without lines rejected (400)', r.status === 400, r.body)
  const push = agent.settings.sync.push
  agent.saveSettings({ sync: { ...agent.settings.sync, push: { ...push, credit_note: { enabled: false }, debit_note: { enabled: false } } } })
  await agent.cycle()
  const [cOff, dOff] = [await st(cnId), await st(dnId)]
  check('push toggle off -> notes stay pending, not claimed, no attempts', cOff.status === 'pending' && dOff.status === 'pending' && cOff.attempts === 0 && dOff.attempts === 0, [cOff, dOff].map((x) => [x.status, x.attempts]))
  r = await api('GET', '/api/tally-sync/pending?limit=25&entities=', undefined, { 'x-api-key': newKey, 'x-company-guid': agent.settings.lockedCompany!.guid })
  check('pending with empty entities list claims nothing', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, r)
  agent.saveSettings({ sync: { ...agent.settings.sync, push: { ...push, credit_note: { enabled: true }, debit_note: { enabled: true } } } })
  // master type disabled -> voucher using an unsynced local master of that type is not held
  r = await api('POST', '/api/records', { entity: 'stock_item', payload: { name: 'Washer', parent: 'No Such Group', baseUnit: 'Nos' } }); const washerId = r.body.id
  agent.saveSettings({ sync: { ...agent.settings.sync, push: { ...agent.settings.sync.push, stock_item: { enabled: false } } } })
  r = await api('POST', '/api/records', { entity: 'credit_note', payload: { number: 'CN-1002', date: '20260427', party: 'Ravi Stores', taxMode: 'none', lines: [{ item: 'Washer', qty: 1, rate: 10 }] } }); const cn2Id = r.body.id
  await agent.cycle()
  const [w, cn2] = [await st(washerId), await st(cn2Id)]
  check('disabled master type does not hold voucher (voucher goes, master stays pending)', w.status === 'pending' && w.attempts === 0 && cn2.status !== 'pending' && !/waiting for/.test(cn2.error ?? ''), [[w.status, w.attempts], [cn2.status, cn2.error]])
  agent.saveSettings({ sync: { ...agent.settings.sync, push: { ...agent.settings.sync.push, stock_item: { enabled: true } } } })
  await api('PUT', `/api/records/${washerId}`, { name: 'Washer', parent: 'Finished Goods', baseUnit: 'Nos' })
  await agent.cycle({ forcePull: true })
  const cnr = await st(cnId), dnr = await st(dnId)
  check('credit note synced (balanced in Tally)', cnr.status === 'synced' && cnr.tallyGuid && cnr.voucherNumber === 'CN-1001', [cnr.status, cnr.error])
  check('debit note synced (balanced in Tally)', dnr.status === 'synced' && dnr.tallyGuid && dnr.voucherNumber === 'DN-1001', [dnr.status, dnr.error])
  const cx = cnr.requestXml ?? '', dx = dnr.requestXml ?? ''
  check('credit note: Credit Note type, party credited, stock in', /VCHTYPE="Credit Note"/.test(cx) && partyAmt(cx, 'Ravi Stores') === 236 && /<ALLINVENTORYENTRIES\.LIST><STOCKITEMNAME>Widget<\/STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><RATE>[^<]*<\/RATE><AMOUNT>-200\.00/.test(cx), cx.slice(0, 1500))
  check('credit note: output tax debited + Agst Ref original invoice', /<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-18\.00<\/AMOUNT>/.test(cx) && /<NAME>SO-1001<\/NAME><BILLTYPE>Agst Ref<\/BILLTYPE><AMOUNT>236\.00/.test(cx) && /<ORIGINALINVOICENO>SO-1001<\/ORIGINALINVOICENO>/.test(cx))
  check('debit note: Debit Note type, party debited, input IGST credited, New Ref', /VCHTYPE="Debit Note"/.test(dx) && partyAmt(dx, 'Supreme Supplies') === -177 && /<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><AMOUNT>27\.00<\/AMOUNT>/.test(dx) && /<NAME>DN-1001<\/NAME><BILLTYPE>New Ref<\/BILLTYPE><AMOUNT>-177\.00/.test(dx), dx.slice(0, 1500))
  r = await api('POST', '/api/records', { entity: 'credit_note', payload: { ...cn, narration: 'edited' } })
  await agent.cycle({ forcePull: true })
  check('re-saved credit note pushes as Alter', (await st(cnId)).action === 'Alter' && (await st(cnId)).status === 'synced')
  r = await api('GET', '/api/reports/vouchers?category=credit_note')
  check('credit note pulled back (1)', r.body.length === 1 && r.body[0].voucherNumber === 'CN-1001', r.body)
  r = await api('GET', '/api/reports/vouchers?category=debit_note')
  check('debit note pulled back (1)', r.body.length === 1 && r.body[0].voucherNumber === 'DN-1001', r.body)
  for (const p of ['/orders?type=credit_note', '/orders?type=debit_note', '/vouchers?category=credit_note']) {
    const res = await fetch(base + p); if (res.status !== 200) check(`page ${p}`, false, res.status)
  }
  const h = await (await fetch(base + '/orders?type=credit_note')).text()
  check('credit note page: form + list with sync status', h.includes('credit note (sales return)') && h.includes('Against invoice') && h.includes('CN-1001') && /synced/i.test(h))
}

console.log('8c. trade discount -> discount ledger (items at gross, GST on net) + supplier invoice no')
{
  const amts = (xml: string) => [...xml.matchAll(/<(?:LEDGERENTRIES|ALLINVENTORYENTRIES)\.LIST>.*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/gs)].map((m) => Number(m[1]))
  const ent = (xml: string, ledger: string) => new RegExp(`<LEDGERNAME>${ledger}</LEDGERNAME><ISDEEMEDPOSITIVE>(Yes|No)</ISDEEMEDPOSITIVE><AMOUNT>(-?[\\d.]+)</AMOUNT>`).exec(xml)?.slice(1)
  r = await api('POST', '/api/records', { entity: 'sales', payload: { number: 'SI-D1', date: '20260428', party: 'Ravi Stores', taxMode: 'intra', discount: 35, lines: [{ item: 'Widget', qty: 3, rate: 100, gstRate: 18 }, { item: 'Widget', qty: 1, rate: 50, gstRate: 18, discount: 5 }] } }); const sId = r.body.id
  check('sales with discount accepted', r.status === 201, r.body)
  r = await api('POST', '/api/records', { entity: 'purchase', payload: { number: 'GRN-D1', date: '20260428', party: 'Supreme Supplies', taxMode: 'inter', discount: 30, supplierInvoiceNo: 'SUP/77', supplierInvoiceDate: '20260427', lines: [{ item: 'Gadget', qty: 2, rate: 150, gstRate: 18 }] } }); const pId = r.body.id
  check('purchase with discount + supplier invoice accepted', r.status === 201, r.body)
  r = await api('POST', '/api/records', { entity: 'sales', payload: { number: 'SI-BAD', date: '20260428', party: 'Ravi Stores', discount: 999, lines: [{ item: 'Widget', qty: 1, rate: 10 }] } })
  check('discount above line value rejected (400)', r.status === 400, r.body)
  await agent.cycle({ forcePull: true })
  const s0 = await st(sId)
  check('missing discount ledger + autoCreate off -> clear failure', s0.status === 'failed' && /discount ledger 'Discount Allowed' not found/.test(s0.error ?? ''), s0.error)
  writeMapping({ ...rich, version: '4', autoCreate: { parties: true, ledgers: true, items: false } })
  for (const id of [sId, pId]) await api('POST', `/api/records/${id}/retry`)
  await agent.cycle({ forcePull: true })
  const s1 = await st(sId), p1 = await st(pId)
  check('discounted sales synced (balanced)', s1.status === 'synced', [s1.status, s1.error])
  check('discounted purchase synced (balanced)', p1.status === 'synced', [p1.status, p1.error])
  const sx = s1.requestXml ?? '', px = p1.requestXml ?? ''
  check('sales: entries sum to 0', Math.abs(amts(sx).reduce((a, b) => a + b, 0)) < 0.005, amts(sx))
  check('sales: items at gross rate (300 + 50 credited)', /<AMOUNT>300\.00<\/AMOUNT>/.test(sx) && /<AMOUNT>50\.00<\/AMOUNT>/.test(sx))
  check('sales: Discount Allowed debited 40 (35 invoice + 5 line)', JSON.stringify(ent(sx, 'Discount Allowed')) === '["Yes","-40.00"]', ent(sx, 'Discount Allowed'))
  check('sales: GST on net 310 -> CGST/SGST 27.90 each', /<AMOUNT>27\.90<\/AMOUNT>.*<AMOUNT>27\.90<\/AMOUNT>/s.test(sx), sx.slice(0, 2500))
  const party = Number(ent(sx, 'Ravi Stores')?.[1])
  check('sales: party debited gross - discount + tax (365.80, or rounded)', Math.abs(-party - 365.8) <= 1, party)
  check('purchase: entries sum to 0', Math.abs(amts(px).reduce((a, b) => a + b, 0)) < 0.005, amts(px))
  check('purchase: Discount Received credited 30', JSON.stringify(ent(px, 'Discount Received')) === '["No","30.00"]', ent(px, 'Discount Received'))
  check('purchase: IGST on net 270 = 48.60, items at gross 300', /<AMOUNT>-48\.60<\/AMOUNT>/.test(px) && /<AMOUNT>-300\.00<\/AMOUNT>/.test(px), px.slice(0, 2500))
  check('purchase: supplier invoice -> REFERENCE/REFERENCEDATE + bill ref', /<REFERENCE>SUP\/77<\/REFERENCE><REFERENCEDATE>20260427<\/REFERENCEDATE>/.test(px) && /<NAME>SUP\/77<\/NAME><BILLTYPE>New Ref/.test(px))
  fs.copyFileSync(path.join(root, 'apps/web/config/tally-mapping.jsonc'), mappingFile); { const t = new Date(Date.now() + 120_000); fs.utimesSync(mappingFile, t, t) }
}

console.log('9. manual sync from the web app')
const waitReq = async (id: string, ms = 10_000) => {
  const t0 = Date.now()
  for (;;) {
    const x = (await api('GET', '/api/sync-requests?limit=50')).body.find((q: any) => q.id === id)
    if (['done', 'failed', 'expired'].includes(x?.status) || Date.now() - t0 > ms) return { ...x, ms: Date.now() - t0 }
    await new Promise((res) => setTimeout(res, 200))
  }
}
agent.startCommandPoll(300)
r = await api('POST', '/api/sync-requests', { type: 'sync' })
check('sync request created', r.status === 201 && r.body.status === 'requested', r.body)
let q = await waitReq(r.body.id)
check('agent ran Sync now within seconds -> done with summary', q.status === 'done' && q.ms < 5000 && /pushed \d+, pulled 15 entities/.test(q.summary), q)
r = await api('POST', '/api/sync-requests', { type: 'pull_entity' })
check('pull_entity needs entity (400)', r.status === 400)
r = await api('POST', '/api/sync-requests', { type: 'pull_entity', entity: 'ledger' })
q = await waitReq(r.body.id)
check('pull only one entity', q.status === 'done' && q.result.pushed === 0 && q.result.pulled.length === 1 && q.result.pulled[0] === 'ledger', q)
await api('POST', '/api/records', { entity: 'purchase_order', payload: { ...po3, number: 'PO-3002' } })
r = await api('POST', '/api/sync-requests', { type: 'push' })
q = await waitReq(r.body.id)
check('push only', q.status === 'done' && q.result.pushed === 1 && q.result.pulled.length === 0, q)
r = await api('POST', '/api/sync-requests', { type: 'pull' })
q = await waitReq(r.body.id)
check('pull only (all enabled)', q.status === 'done' && q.result.pushed === 0 && q.result.pulled.length === 15, q)
r = await api('POST', '/api/sync-requests', { type: 'full_repull' })
q = await waitReq(r.body.id)
r = await api('GET', '/api/agent-status')
check('full re-pull ignores ALTERID (all full snapshots)', q.status === 'done' && q.result.pulled.length === 15 && r.body.pullState.filter((p: any) => ['ledger', 'voucher', 'stock_item'].includes(p.entity)).every((p: any) => p.last_full === 1), [q, r.body.pullState])
const running = agent.cycle({ forcePull: true })
r = await api('POST', '/api/sync-requests', { type: 'sync' })
await running
q = await waitReq(r.body.id)
check('request during a running cycle is queued, not dropped', q.status === 'done' && !/skipped/.test(q.summary ?? ''), q)
agent.saveSettings({ lockedCompany: { ...lock, guid: 'wrong-guid' } })
r = await api('POST', '/api/sync-requests', { type: 'sync' })
q = await waitReq(r.body.id)
check('gate mismatch -> request failed with reason', q.status === 'failed' && /mismatch/.test(q.error ?? '') && /gate mismatch/.test(q.summary ?? ''), q)
agent.saveSettings({ lockedCompany: lock })
agent.stopCommandPoll()
r = await api('POST', '/api/sync-requests', { type: 'sync' })
q = await waitReq(r.body.id, 8000)
check('request expires when agent is stopped, with offline hint', q.status === 'expired' && /agent offline.*127\.0\.0\.1:4100.*sync-once/.test(q.error ?? ''), q)
const dash = await (await fetch(base + '/')).text()
check('dashboard shows manual sync panel', dash.includes('Manual sync') && dash.includes('Full re-pull'))

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
