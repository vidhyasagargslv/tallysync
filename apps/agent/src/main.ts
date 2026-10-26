import { Agent, AGENT_VERSION } from './agent.js'
import { log } from './log.js'
import { startUi } from './ui.js'

async function main() {
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
