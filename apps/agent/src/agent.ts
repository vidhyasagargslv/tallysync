/**
 * TallySync Agent: one generic exe for every client.
 * Talks to TallyPrime on localhost (XML) and to the client's own backend (HTTPS, outbound only).
 * Local settings: backend URL, API key (DPAPI on Windows), Tally URL, company name -> GUID/GSTIN locked on first connect.
 */
import os from 'node:os'
import path from 'node:path'
import {
  CONTRACT_VERSION, MappingZ, OBJECT_ENTITIES, PULL_ENTITIES, defaultSyncSettings,
  type CompanyLink, type CompanyState, type Heartbeat, type Mapping, type PendingRecord, type PullEntity, type PushResult, type SyncSettings
} from '@tallysync/contracts'
import { TallyClient, TallyEngine, TallyUnreachableError, mockConfig, type ObjectKey } from '@tallysync/tally-core'
import { log } from './log.js'
import { dataDir, ensureDirs, readJson, writeJsonAtomic } from './paths.js'
import { clearApiKey, loadApiKey, saveApiKey } from './secret.js'

export const AGENT_VERSION = '1.0.0'

export interface LocalSettings {
  backendUrl: string; tallyUrl: string; tallyMode: 'real' | 'mock'; companyName: string
  lockedCompany: CompanyLink | null; sync: SyncSettings; mapping: Mapping; uiPort: number
}
interface State { cursors: Partial<Record<PullEntity, number>>; lastRun: Partial<Record<PullEntity, string>>; cursorCompanyGuid?: string }

export class BackendError extends Error { constructor(readonly status: number, msg: string) { super(msg) } }

export class Agent {
  dir = ensureDirs()
  settingsFile = path.join(this.dir, 'agent.json')
  stateFile = path.join(this.dir, 'state', 'state.json')
  settings: LocalSettings
  state: State
  apiKey?: string
  companyState: CompanyState = 'unconfigured'
  openCompanies: CompanyLink[] = []
  tallyReachable = false
  lastError: string | null = null
  lastPullAt: string | null = null
  lastPushAt: string | null = null
  recentErrors: string[] = []
  private timers: NodeJS.Timeout[] = []
  private busy = false

  constructor() {
    const env = process.env
    const saved = readJson<Partial<LocalSettings>>(this.settingsFile, {})
    const def = defaultSyncSettings()
    this.settings = {
      backendUrl: '', tallyUrl: 'http://localhost:9000', tallyMode: 'real', companyName: '', lockedCompany: null, uiPort: 4100,
      ...saved,
      sync: { ...def, ...saved.sync, pull: { ...def.pull, ...saved.sync?.pull }, push: { ...def.push, ...saved.sync?.push } },
      mapping: MappingZ.parse(saved.mapping ?? {}),
      ...(env.TALLYSYNC_BACKEND_URL ? { backendUrl: env.TALLYSYNC_BACKEND_URL } : {}),
      ...(env.TALLY_URL ? { tallyUrl: env.TALLY_URL } : {}),
      ...(env.TALLY_MODE ? { tallyMode: env.TALLY_MODE as 'real' | 'mock' } : {}),
      ...(env.TALLY_COMPANY ? { companyName: env.TALLY_COMPANY } : {}),
      ...(env.AGENT_UI_PORT ? { uiPort: Number(env.AGENT_UI_PORT) } : {})
    }
    if (env.TALLYSYNC_API_KEY && !loadApiKey()) saveApiKey(env.TALLYSYNC_API_KEY)
    this.state = readJson<State>(this.stateFile, { cursors: {}, lastRun: {} })
    this.apiKey = loadApiKey()
    if (this.settings.tallyMode === 'mock' && !mockConfig.statePath) mockConfig.statePath = path.join(this.dir, 'state', 'mock-tally.json')
  }

  get configured() { return !!this.settings.backendUrl && !!this.apiKey && !!this.settings.companyName }
  saveSettings(patch: Partial<LocalSettings>) { this.settings = { ...this.settings, ...patch }; writeJsonAtomic(this.settingsFile, this.settings) }
  private saveState() { writeJsonAtomic(this.stateFile, this.state) }

  /** Save connection settings from the local page. Changing the company name clears the lock. */
  configure(p: { backendUrl?: string; apiKey?: string; tallyUrl?: string; tallyMode?: 'real' | 'mock'; companyName?: string }) {
    const patch: Partial<LocalSettings> = {}
    if (p.backendUrl !== undefined) patch.backendUrl = p.backendUrl.trim().replace(/\/+$/, '')
    if (p.tallyUrl) patch.tallyUrl = p.tallyUrl.trim()
    if (p.tallyMode) patch.tallyMode = p.tallyMode
    if (p.companyName !== undefined && p.companyName.trim() !== this.settings.companyName) { patch.companyName = p.companyName.trim(); patch.lockedCompany = null }
    this.saveSettings(patch)
    if (p.apiKey) { saveApiKey(p.apiKey.trim()); this.apiKey = p.apiKey.trim() }
  }
  setPullEnabled(entity: PullEntity, enabled: boolean) {
    this.settings.sync.pull[entity] = { intervalSec: 900, ...this.settings.sync.pull[entity], enabled }
    this.saveSettings({ sync: this.settings.sync })
  }
  /** Re-link: forget the locked GUID; the next successful connect locks the company again. */
  relink() {
    this.saveSettings({ lockedCompany: null })
    this.state = { cursors: {}, lastRun: {} }; this.saveState()
    log('warn', 're-link requested: company lock cleared')
  }
  forgetApiKey() { clearApiKey(); this.apiKey = undefined }

  // ----------------------------------------------------------- backend I/O
  async api<T>(method: string, p: string, body?: unknown, retries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json', 'x-contract-version': CONTRACT_VERSION, 'x-api-key': this.apiKey ?? '' }
        if (this.settings.lockedCompany) headers['x-company-guid'] = this.settings.lockedCompany.guid
        const res = await fetch(new URL(p, this.settings.backendUrl + '/'), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
        const text = await res.text()
        let json: any
        try { json = text ? JSON.parse(text) : undefined } catch { json = { error: text.slice(0, 200) } }
        if (!res.ok) {
          if (res.status >= 500 && attempt < retries) throw new Error(`backend ${res.status}`)
          throw new BackendError(res.status, json?.error ?? `HTTP ${res.status}`)
        }
        return json as T
      } catch (e) {
        if (e instanceof BackendError || attempt >= retries) throw e
        await sleep(Math.min(1000 * 2 ** attempt, 30_000) * (0.5 + Math.random()))
      }
    }
  }

  private noteError(msg: string) {
    this.lastError = msg
    this.recentErrors.push(`${new Date().toISOString()} ${msg}`); if (this.recentErrors.length > 20) this.recentErrors.shift()
  }

  // -------------------------------------------------------------- tally
  engine(companyName = this.settings.lockedCompany?.name ?? this.settings.companyName) {
    const client = new TallyClient({ mode: this.settings.tallyMode, url: this.settings.tallyUrl })
    return new TallyEngine(client, companyName, { from: this.settings.sync.fromDate, to: this.settings.sync.toDate })
  }

  /**
   * Company gate, run before every sync. The company must be open in Tally and match the locked GUID
   * (and GSTIN when both sides have one). First successful connect by name locks GUID + GSTIN.
   */
  async checkGate(): Promise<{ ok: boolean; engine?: TallyEngine; message?: string }> {
    const s = this.settings
    if (!s.companyName) { this.companyState = 'unconfigured'; return { ok: false, message: 'Tally company name not set' } }
    let open: CompanyLink[] = []
    try {
      open = await this.engine().openCompanies()
      this.tallyReachable = true
    } catch (e) {
      this.tallyReachable = !(e instanceof TallyUnreachableError)
      this.companyState = this.tallyReachable ? 'not_open' : 'unreachable'
      this.openCompanies = []
      return this.block((e as Error).message)
    }
    this.openCompanies = open
    if (!s.lockedCompany) {
      const byName = open.find((c) => c.name.toLowerCase() === s.companyName.toLowerCase())
      if (!byName) { this.companyState = 'not_open'; return this.block(`company "${s.companyName}" is not open in Tally (open: ${open.map((c) => c.name).join(', ') || 'none'})`) }
      this.saveSettings({ lockedCompany: byName })
      this.state = { cursors: {}, lastRun: {}, cursorCompanyGuid: byName.guid }; this.saveState()
      log('info', `company locked: "${byName.name}" GUID ${byName.guid} GSTIN ${byName.gstin ?? '-'}`)
    }
    const lock = this.settings.lockedCompany!
    const match = open.find((c) => c.guid === lock.guid)
    const gstOk = !match || !lock.gstin || !match.gstin || match.gstin.toUpperCase() === lock.gstin.toUpperCase()
    if (match && gstOk) {
      this.companyState = 'matched'
      if (this.state.cursorCompanyGuid !== lock.guid) { this.state = { cursors: {}, lastRun: {}, cursorCompanyGuid: lock.guid }; this.saveState() }
      return { ok: true, engine: this.engine(match.name) }
    }
    const sameName = open.find((c) => c.name.toLowerCase() === lock.name.toLowerCase())
    if (!match && !sameName && !open.length) { this.companyState = 'not_open'; return this.block(`locked company "${lock.name}" is not open in Tally`) }
    this.companyState = 'mismatch'
    return this.block(`company mismatch: locked "${lock.name}" (${lock.guid}${lock.gstin ? `, GSTIN ${lock.gstin}` : ''}) but Tally has ${open.map((c) => `"${c.name}" (${c.guid}${c.gstin ? `, ${c.gstin}` : ''})`).join(', ')}. Open the right company, or use Re-link if this is intended.`)
  }
  private block(msg: string) {
    if (this.lastError !== msg) log('warn', `gate blocked: ${msg}`)
    this.noteError(msg)
    return { ok: false as const, message: msg }
  }

  async heartbeat() {
    const hb: Heartbeat = {
      agentVersion: AGENT_VERSION, contractVersion: CONTRACT_VERSION, machine: os.hostname(), tallyUrl: this.settings.tallyUrl, tallyMode: this.settings.tallyMode,
      tallyReachable: this.tallyReachable, companyState: this.companyState, lockedCompany: this.settings.lockedCompany, openCompanies: this.openCompanies,
      lastPullAt: this.lastPullAt, lastPushAt: this.lastPushAt, lastError: this.lastError,
      enabledPulls: PULL_ENTITIES.filter((e) => this.settings.sync.pull[e]?.enabled), recentErrors: this.recentErrors.slice(-10)
    }
    await this.api('POST', '/api/tally-sync/status', hb, 1)
  }

  // ---------------------------------------------------------------- push
  async pushPending(engine: TallyEngine): Promise<number> {
    const recs = await this.api<PendingRecord[]>('GET', '/api/tally-sync/pending?limit=25')
    let n = 0
    for (const rec of recs) {
      if (this.settings.sync.push[rec.entity]?.enabled === false) continue
      const r = await engine.push(rec.entity, rec.payload, this.settings.mapping)
      const res: PushResult = { id: rec.id, ...r, transient: r.status === 'failed' && /Cannot reach Tally/.test(r.error ?? '') }
      await this.api('POST', '/api/tally-sync/result', res)
      log(res.status === 'synced' ? 'info' : 'warn', `push ${rec.entity} ${rec.id}: ${res.status}${res.action ? ` ${res.action}` : ''}${res.error ? ` - ${res.error}` : ''}`)
      if (res.status === 'failed') this.noteError(`push ${rec.entity} ${rec.id}: ${res.error}`)
      this.lastPushAt = new Date().toISOString()
      n++
    }
    return n
  }

  // ---------------------------------------------------------------- pull
  dueEntities(force = false): PullEntity[] {
    return PULL_ENTITIES.filter((e) => {
      const st = this.settings.sync.pull[e]
      if (!st?.enabled) return false
      if (force) return true
      const last = this.state.lastRun[e]
      return !last || Date.now() - Date.parse(last) >= st.intervalSec * 1000
    })
  }

  async pullEntity(engine: TallyEngine, entity: PullEntity, full = false) {
    const since = full ? 0 : this.state.cursors[entity] ?? 0
    const company = this.settings.lockedCompany!
    const post = (b: object) => this.api('POST', `/api/tally-sync/data/${entity}`, { entity, company, ...b })
    try {
      if ((OBJECT_ENTITIES as readonly string[]).includes(entity)) {
        const r = await engine.pull(entity as ObjectKey, since)
        const chunk = 500
        const isFull = since === 0 || entity === 'company'
        if (!r.objects.length) await post({ full: false, sinceAlterId: since, maxAlterId: r.maxAlterId, objects: [] })
        for (let i = 0; i < r.objects.length; i += chunk)
          await post({ full: isFull && i === 0 && r.objects.length <= chunk, sinceAlterId: since, maxAlterId: r.maxAlterId, objects: r.objects.slice(i, i + chunk) })
        this.state.cursors[entity] = r.maxAlterId
        log('info', `pull ${entity}: ${r.objects.length} objects (since ALTERID ${since})`)
      } else {
        const rows = await engine.balances(entity === 'stock_summary' ? 'stock_item' : 'ledger')
        await post({ full: true, sinceAlterId: 0, maxAlterId: 0, rows })
        log('info', `pull ${entity}: ${rows.length} balance rows`)
      }
      this.state.lastRun[entity] = new Date().toISOString()
      this.lastPullAt = this.state.lastRun[entity]!
      this.saveState()
    } catch (e) {
      const msg = (e as Error).message
      log('error', `pull ${entity} failed: ${msg}`)
      this.noteError(`pull ${entity}: ${msg}`)
    }
  }

  /** One cycle: gate -> push pending -> pull due entities -> heartbeat. */
  async cycle(opts: { forcePull?: boolean; full?: boolean } = {}) {
    if (!this.configured) return { skipped: true as const, reason: 'not configured' }
    if (this.busy) return { skipped: true as const, reason: 'busy' }
    this.busy = true
    try {
      const gate = await this.checkGate()
      let pushed = 0
      const pulled: PullEntity[] = []
      if (gate.ok) {
        this.lastError = null
        pushed = await this.pushPending(gate.engine!)
        for (const e of this.dueEntities(opts.forcePull)) { await this.pullEntity(gate.engine!, e, opts.full); pulled.push(e) }
      }
      try { await this.heartbeat() } catch (e) { log('warn', `heartbeat failed: ${(e as Error).message}`) }
      return { skipped: false as const, gate: this.companyState, message: gate.message, pushed, pulled }
    } catch (e) {
      const msg = (e as Error).message
      this.noteError(msg)
      log('error', `cycle failed: ${msg}`)
      if (e instanceof BackendError && e.status === 401) log('error', 'API key rejected by backend; fix it on the local settings page')
      return { skipped: false as const, gate: this.companyState, pushed: 0, pulled: [] as PullEntity[], error: msg, status: e instanceof BackendError ? e.status : undefined }
    } finally { this.busy = false }
  }

  start() {
    const loop = (fn: () => Promise<unknown>, sec: () => number) => {
      const run = async () => {
        try { await fn() } catch (e) { log('warn', (e as Error).message) }
        this.timers.push(setTimeout(run, sec() * 1000))
      }
      this.timers.push(setTimeout(run, 1000))
    }
    loop(() => this.cycle(), () => this.settings.sync.jobPollSec)
    log('info', `TallySync agent ${AGENT_VERSION} started; data dir ${dataDir()}; tally ${this.settings.tallyMode} ${this.settings.tallyUrl}; settings http://127.0.0.1:${this.settings.uiPort}`)
  }
  stop() { for (const t of this.timers) clearTimeout(t); this.timers = [] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
