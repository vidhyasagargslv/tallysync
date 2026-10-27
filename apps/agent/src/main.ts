import { Agent, AGENT_VERSION } from './agent.js'
import { log } from './log.js'
import { startUi } from './ui.js'

import http from 'node:http'
import tls from 'node:tls'

/** Remote HTTPS backend support: honour HTTPS_PROXY/HTTP_PROXY (never for the local Tally port) and, with
 *  TALLYSYNC_USE_SYSTEM_CA=1, trust the Windows certificate store too (corporate TLS-inspecting proxies). */
function setupNetwork() {
  const env = process.env
  const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
  const h = http as unknown as { setGlobalProxyFromEnv?: (e: Record<string, string | undefined>) => void }
  if (proxy && h.setGlobalProxyFromEnv) {
    const noProxy = [env.NO_PROXY ?? env.no_proxy, 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',')
    h.setGlobalProxyFromEnv({ HTTPS_PROXY: env.HTTPS_PROXY ?? env.https_proxy ?? proxy, HTTP_PROXY: env.HTTP_PROXY ?? env.http_proxy ?? proxy, NO_PROXY: noProxy })
    log('info', `using proxy ${proxy.replace(/\/\/[^@/]*@/, '//***@')} (NO_PROXY ${noProxy})`)
  }
  const t = tls as unknown as { getCACertificates?: (k: string) => string[]; setDefaultCACertificates?: (c: string[]) => void }
  if (env.TALLYSYNC_USE_SYSTEM_CA === '1' && t.getCACertificates && t.setDefaultCACertificates) {
    t.setDefaultCACertificates([...t.getCACertificates('bundled'), ...t.getCACertificates('system')])
    log('info', 'trusting system CA certificates')
  }
}

async function main() {
  setupNetwork()
  const args = process.argv.slice(2)
  if (args[0] === '--version') { console.log(AGENT_VERSION); process.exit(0) }
  const agent = new Agent()
  if (args[0] === 'configure') {
    // tallysync-agent.exe configure --backend URL --key KEY --company "Name" [--tally URL]
    const get = (k: string) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : undefined }
    agent.configure({ backendUrl: get('--backend'), apiKey: get('--key'), companyName: get('--company'), tallyUrl: get('--tally') })
    console.log('saved'); process.exit(0)
  }
  if (args[0] === 'sync-once') { console.log(JSON.stringify(await agent.cycle({ forcePull: true }))); process.exit(0) }
  startUi(agent)
  agent.start()
  if (!agent.configured) log('info', `not configured yet: open http://127.0.0.1:${agent.settings.uiPort}`)
  process.on('uncaughtException', (e) => log('error', `uncaught: ${e.stack ?? e}`))
  process.on('unhandledRejection', (e) => log('error', `unhandled: ${String(e)}`))
  const stop = () => { agent.stop(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
main().catch((e) => { log('error', `fatal: ${e?.stack ?? e}`); process.exit(1) })
