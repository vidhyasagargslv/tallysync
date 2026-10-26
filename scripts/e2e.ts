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

if (!fs.existsSync(path.join(root, 'apps/web/.next/BUILD_ID'))) { console.error('build the web app first: npm run build -w @tallysync/web'); process.exit(1) }
const web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: path.join(root, 'apps/web'), env: { ...process.env, DATABASE_PATH: path.join(tmp, 'web.db'), TALLYSYNC_API_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe']
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

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
