/** Local settings/status page. Bound to 127.0.0.1 only: never reachable from the network. */
import http from 'node:http'
import { PULL_ENTITIES, type PullEntity } from '@tallysync/contracts'
import type { Agent } from './agent.js'
import { recent } from './log.js'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function page(a: Agent, msg = '') {
  const s = a.settings, lock = s.lockedCompany
  const ok = (b: boolean, y: string, n: string) => `<span class="${b ? 'ok' : 'bad'}">${b ? y : n}</span>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>TallySync Agent</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:30px auto;color:#222;padding:0 12px}label{display:block;margin:10px 0 4px;font-size:14px}input,select{padding:7px;width:100%;box-sizing:border-box}
button{margin-top:12px;padding:8px 16px;cursor:pointer}.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}.ok{color:#0a7d32;font-weight:600}.bad{color:#b00020;font-weight:600}
pre{background:#f6f6f6;padding:8px;max-height:260px;overflow:auto;font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.grid label{margin:2px}.grid input{width:auto}.row{display:flex;gap:8px;flex-wrap:wrap}</style></head><body>
<h2>TallySync Agent</h2>${msg ? `<p class="card">${esc(msg)}</p>` : ''}
<div class="card"><b>Status</b><br>
Configured: ${ok(a.configured, 'yes', 'no - fill in the connection below')}<br>
Backend: ${esc(s.backendUrl || '-')} (API key ${a.apiKey ? 'saved' : 'not set'})<br>
Tally: ${esc(s.tallyMode)} ${esc(s.tallyUrl)} - ${ok(a.tallyReachable, 'reachable', 'not reachable / not checked')}<br>
Company gate: ${ok(a.companyState === 'matched', 'matched', esc(a.companyState))}<br>
Locked company: ${lock ? `${esc(lock.name)} | GUID ${esc(lock.guid)} | GSTIN ${esc(lock.gstin ?? '-')}` : 'not locked yet (locks on first successful connect)'}<br>
Open in Tally: ${esc(a.openCompanies.map((c) => c.name).join(', ') || '-')}<br>
Last pull: ${esc(a.lastPullAt ?? '-')} / last push: ${esc(a.lastPushAt ?? '-')}<br>
Mapping: ${esc(a.mappingSource)} ${esc(a.mappingCache ? `v${a.mappingCache.version} ${a.mappingCache.hash.slice(0, 12)}` : "(agent.json fallback)")} - ${a.lastValidation ? (a.lastValidation.issues.length ? `<span class="bad">${a.lastValidation.issues.length} issue(s)</span>` : `<span class="ok">valid in Tally</span>`) : "not checked"}<br>
Last manual request from the app: ${esc(a.lastCommand ? `${a.lastCommand.type} ${a.lastCommand.status} at ${a.lastCommand.at}` : '-')}<br>
Last error: ${esc(a.lastError ?? "-")}
<div class="row"><form method="post" action="/sync"><button>Sync now</button></form>
<form method="post" action="/relink" onsubmit="return confirm('Clear the locked company? The next connect locks whichever company matches the name.')"><button>Re-link company</button></form></div></div>
<form class="card" method="post" action="/settings"><b>Connection</b>
<label>Backend URL (your app, e.g. https://app.example.com)</label><input name="backendUrl" value="${esc(s.backendUrl)}" placeholder="http://localhost:3000" required>
<label>API key ${a.apiKey ? '(saved; leave blank to keep)' : ''}</label><input name="apiKey" type="password" autocomplete="off" ${a.apiKey ? '' : 'required'}>
<label>Tally URL</label><input name="tallyUrl" value="${esc(s.tallyUrl)}">
<label>Tally company name (exactly as in Tally)</label><input name="companyName" value="${esc(s.companyName)}" required>
<label>Mode</label><select name="tallyMode"><option ${s.tallyMode === 'real' ? 'selected' : ''}>real</option><option ${s.tallyMode === 'mock' ? 'selected' : ''}>mock</option></select>
<button>Save &amp; test</button></form>
<form class="card" method="post" action="/pulls"><b>What to pull from Tally</b> (all on by default)<div class="grid">
${PULL_ENTITIES.map((e) => `<label><input type="checkbox" name="${e}" ${s.sync.pull[e]?.enabled ? 'checked' : ''}> ${e}</label>`).join('')}
</div><button>Save pulls</button></form>
<div class="card"><b>Recent log</b><pre>${esc(recent.slice(-60).join('\n'))}</pre></div></body></html>`
}

async function form(req: http.IncomingMessage) {
  let body = ''
  for await (const c of req) body += c
  return Object.fromEntries(new URLSearchParams(body))
}

export function startUi(a: Agent) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) { res.writeHead(403).end('forbidden'); return }
    let msg = ''
    try {
      if (req.method === 'POST' && req.url === '/settings') {
        const f = await form(req)
        a.configure({ backendUrl: f.backendUrl, apiKey: f.apiKey || undefined, tallyUrl: f.tallyUrl, companyName: f.companyName, tallyMode: f.tallyMode === 'mock' ? 'mock' : 'real' })
        const r = await a.cycle({ forcePull: true })
        msg = `Saved. Sync: ${JSON.stringify(r)}`
      } else if (req.method === 'POST' && req.url === '/pulls') {
        const f = await form(req)
        for (const e of PULL_ENTITIES) a.setPullEnabled(e as PullEntity, f[e] === 'on')
        msg = 'Pull settings saved.'
      } else if (req.method === 'POST' && req.url === '/sync') { msg = `Sync: ${JSON.stringify(await a.cycle({ forcePull: true }))}` }
      else if (req.method === 'POST' && req.url === '/relink') { a.relink(); msg = 'Company lock cleared. It will lock again on the next sync.' }
      else if (req.url === '/status.json') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ configured: a.configured, companyState: a.companyState, lockedCompany: a.settings.lockedCompany, tallyReachable: a.tallyReachable, lastError: a.lastError }))
        return
      }
    } catch (e) { msg = `Error: ${(e as Error).message}` }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(a, msg))
  })
  server.listen(a.settings.uiPort, '127.0.0.1')
  return server
}
