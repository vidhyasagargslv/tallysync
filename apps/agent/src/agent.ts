/**
 * TallySync Agent: one generic exe for every client.
 * Talks to TallyPrime on localhost (XML) and to the client's own backend (HTTPS, outbound only).
 * Local settings: backend URL, API key (DPAPI on Windows), Tally URL, company name -> GUID/GSTIN locked on first connect.
 */
import os from 'node:os'
import path from 'node:path'
import {
  CONTRACT_VERSION, MappingResponseZ, MappingZ, OBJECT_ENTITIES, PULL_ENTITIES, VoucherZ, defaultSyncSettings, mappingReferences,
  type MappingIssue, type MappingValidation, type CompanyLink, type CompanyState, type Heartbeat, type Mapping, type PendingRecord, type PullEntity, type PushResult, type SyncSettings
} from '@tallysync/contracts'
import { TallyClient, TallyEngine, TallyUnreachableError, isVoucher, mockConfig, toVoucherInput, voucherRequirements, type MasterIndex, type ObjectKey } from '@tallysync/tally-core'
import { log } from './log.js'
import { dataDir, ensureDirs, readJson, writeJsonAtomic } from './paths.js'
import { clearApiKey, loadApiKey, saveApiKey } from './secret.js'

export const AGENT_VERSION = '1.0.0'

export interface LocalSettings {
  backendUrl: string; tallyUrl: string; tallyMode: 'real' | 'mock'; companyName: string
  lockedCompany: CompanyLink | null; sync: SyncSettings; mapping: Mapping; uiPort: number
}
interface MappingCache { hash: string; version: string; source: string; mapping: Mapping; fetchedAt: string }
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
  mappingCache: MappingCache | null
  mappingSource: 'backend' | 'cache' | 'local' = 'local'
  lastValidation: MappingValidation | null = null
  private lastValidationKey = ''
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
    this.mappingCache = readJson<MappingCache | null>(path.join(this.dir, 'state', 'mapping-cache.json'), null)
    if (this.mappingCache) this.mappingSource = 'cache'
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

  /** Active mapping: backend file (last good copy cached on disk) > agent.json `mapping` fallback. */
  get mapping(): Mapping { return this.mappingCache?.mapping ?? this.settings.mapping }

  async refreshMapping() {
    try {
      const r = MappingResponseZ.parse(await this.api('GET', '/api/tally-sync/mapping', undefined, 1))
      if (r.hash !== this.mappingCache?.hash) log('info', `mapping ${this.mappingCache ? 'changed' : 'loaded'}: version ${r.version} hash ${r.hash.slice(0, 12)} (${r.source})`)
      this.mappingCache = { hash: r.hash, version: r.version, source: r.source, mapping: r.mapping, fetchedAt: new Date().toISOString() }
      writeJsonAtomic(path.join(this.dir, 'state', 'mapping-cache.json'), this.mappingCache)
      this.mappingSource = 'backend'
    } catch (e) {
      this.mappingSource = this.mappingCache ? 'cache' : 'local'
      if (e instanceof BackendError && e.status === 401) throw e
      log('warn', `mapping fetch failed (${(e as Error).message}); using ${this.mappingSource} mapping`)
    }
  }

  /** Check every ledger/group/voucher type/godown the mapping names against Tally's masters. */
  validateMapping(index: MasterIndex): MappingValidation {
    const m = this.mapping
    const issues: MappingIssue[] = []
    for (const r of mappingReferences(m)) {
      if (index[r.kind].has(r.name.toLowerCase())) continue
      const canCreate = r.kind === 'ledger' && !!r.group && m.autoCreate.ledgers
      issues.push({
        level: canCreate ? 'warning' : 'error', kind: r.kind, name: r.name, path: r.path, autoCreate: canCreate,
        message: `${r.kind.replace('_', ' ')} '${r.name}' (${r.path}) not found in Tally${canCreate ? `; will be auto-created under '${r.group}' when first used` : ''}`
      })
    }
    return { hash: this.mappingCache?.hash ?? 'local', checkedAt: new Date().toISOString(), company: this.settings.lockedCompany?.name ?? '', ok: !issues.some((i) => i.level === 'error'), issues }
  }

  private async reportValidation(v: MappingValidation) {
    this.lastValidation = v
    const key = JSON.stringify([v.hash, v.issues])
    if (key === this.lastValidationKey) return
    try { await this.api('POST', '/api/tally-sync/mapping/validation', v, 1); this.lastValidationKey = key }
    catch (e) { if (!(e instanceof BackendError && e.status === 404)) log('warn', `mapping validation report failed: ${(e as Error).message}`) }
    if (v.issues.length) log('warn', `mapping: ${v.issues.length} issue(s): ${v.issues.map((i) => i.message).join(' | ')}`)
  }

  /**
   * Make sure every master a voucher needs exists. Missing party/ledger/item is auto-created under the
   * configured group when allowed, otherwise the record fails with a clear message.
   */
  private async ensureMasters(engine: TallyEngine, index: MasterIndex, payload: any): Promise<string | null> {
    const m = this.mapping
    const v = VoucherZ.parse(payload)
    const input = toVoucherInput(v, m, { itemGroup: (i) => index.stock_item.get(i.toLowerCase()) || undefined })
    const req = voucherRequirements(input)
    const has = (k: keyof MasterIndex, n: string) => index[k].has(n.toLowerCase())
    const problems: string[] = []
    if (!has('voucher_type', req.voucherType)) problems.push(`Voucher type '${req.voucherType}' not found in Tally (mapping voucherTypes.${v.kind})`)
    for (const g of req.godowns) if (!has('godown', g)) problems.push(`Godown '${g}' not found in Tally`)
    const create = async (entity: 'ledger' | 'stock_item' | 'unit', p: any, what: string) => {
      const r = await engine.push(entity, p, m)
      if (r.status !== 'synced') { problems.push(`auto-create ${what} '${p.name}' failed: ${r.error}`); return }
      index[entity].set(p.name.toLowerCase(), p.parent ?? '')
      log('info', `auto-created ${what} '${p.name}'${p.parent ? ` under '${p.parent}'` : ''}`)
    }
    const saleSide = v.kind === 'sales' || v.kind === 'sales_order'
    for (const l of req.ledgers) {
      if (has('ledger', l.name)) continue
      const group = l.role === 'party' ? (saleSide ? m.groups.customers : m.groups.suppliers)
        : l.role === 'sales' ? m.groups.salesLedgers : l.role === 'purchase' ? m.groups.purchaseLedgers
        : l.role === 'tax' ? m.groups.taxLedgers : l.role === 'roundOff' ? m.groups.roundOff : null
      const allowed = l.role === 'party' ? m.autoCreate.parties : l.role === 'cash' ? false : m.autoCreate.ledgers
      const flag = l.role === 'party' ? 'autoCreate.parties' : 'autoCreate.ledgers'
      if (!allowed || !group) { problems.push(`${l.role === 'party' ? 'Party ledger' : `${l.role} ledger`} '${l.name}' not found in Tally. Create it in Tally, map it in tally-mapping.json${l.role !== 'cash' ? `, or enable ${flag}` : ''}`); continue }
      if (!has('group', group)) { problems.push(`cannot auto-create ledger '${l.name}': group '${group}' not found in Tally`); continue }
      const head = l.head === 'cgst' ? 'Central Tax' : l.head === 'sgst' ? 'State Tax' : l.head === 'igst' ? 'Integrated Tax' : undefined
      await create('ledger', { name: l.name, parent: group, billWise: l.role === 'party' || undefined, gstDutyHead: head }, l.role === 'party' ? 'party ledger' : 'ledger')
    }
    for (const item of req.items) {
      if (has('stock_item', item)) continue
      if (!m.autoCreate.items) { problems.push(`Stock item '${item}' not found in Tally. Create it, map it in names.items, or enable autoCreate.items`); continue }
      if (!has('unit', m.groups.defaultUnit)) await create('unit', { name: m.groups.defaultUnit }, 'unit')
      if (m.groups.items && !has('stock_group', m.groups.items)) { problems.push(`cannot auto-create item '${item}': stock group '${m.groups.items}' not found`); continue }
      await create('stock_item', { name: item, parent: m.groups.items || undefined, baseUnit: m.groups.defaultUnit }, 'stock item')
    }
    return problems.length ? problems.join('; ') : null
  }

  async heartbeat() {
    const hb: Heartbeat = {
      agentVersion: AGENT_VERSION, contractVersion: CONTRACT_VERSION, machine: os.hostname(), tallyUrl: this.settings.tallyUrl, tallyMode: this.settings.tallyMode,
      tallyReachable: this.tallyReachable, companyState: this.companyState, lockedCompany: this.settings.lockedCompany, openCompanies: this.openCompanies,
      lastPullAt: this.lastPullAt, lastPushAt: this.lastPushAt, lastError: this.lastError,
      enabledPulls: PULL_ENTITIES.filter((e) => this.settings.sync.pull[e]?.enabled), recentErrors: this.recentErrors.slice(-10),
      mapping: { source: this.mappingSource, hash: this.mappingCache?.hash ?? null, version: this.mappingCache?.version ?? null, issues: this.lastValidation?.issues.length ?? 0 }
    }
    await this.api('POST', '/api/tally-sync/status', hb, 1)
  }

  // ---------------------------------------------------------------- push
  async pushPending(engine: TallyEngine, index: MasterIndex): Promise<number> {
    const recs = await this.api<PendingRecord[]>('GET', '/api/tally-sync/pending?limit=25')
    let n = 0
    for (const rec of recs) {
      if (this.settings.sync.push[rec.entity]?.enabled === false) continue
      let res: PushResult
      const problem = isVoucher(rec.entity) ? await this.ensureMasters(engine, index, { ...rec.payload, kind: rec.entity }).catch((e) => `invalid record: ${(e as Error).message}`) : null
      if (problem) res = { id: rec.id, status: 'failed', error: problem }
      else {
        const r = await engine.push(rec.entity, rec.payload, this.mapping, { itemGroup: (i) => index.stock_item.get(i.toLowerCase()) || undefined })
        res = { id: rec.id, ...r, transient: r.status === 'failed' && /Cannot reach Tally/.test(r.error ?? '') }
        if (r.status === 'synced' && !isVoucher(rec.entity)) {
          const k = rec.entity as keyof MasterIndex
          if (index[k]) index[k].set(String(rec.payload.name).toLowerCase(), String(rec.payload.parent ?? ''))
        }
      }
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
  async cycle(opts: CycleOptions = {}) {
    if (!this.configured) return { skipped: true as const, reason: 'not configured' }
    if (this.busy) return { skipped: true as const, reason: 'busy' }
    this.busy = true
    try {
      const gate = await this.checkGate()
      let pushed = 0
      const pulled: PullEntity[] = []
      if (gate.ok) {
        this.lastError = null
        await this.refreshMapping()
        const index = await gate.engine!.masterIndex()
        await this.reportValidation(this.validateMapping(index))
        if (opts.push !== false) pushed = await this.pushPending(gate.engine!, index)
        const entities = opts.pull === false ? [] : opts.only ? opts.only : this.dueEntities(opts.forcePull)
        for (const e of entities) { await this.pullEntity(gate.engine!, e, opts.full); pulled.push(e) }
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

  // ------------------------------------------------------- manual commands
  private commandsUnsupportedUntil = 0
  private commandTimer?: NodeJS.Timeout
  lastCommand: { id: string; type: string; status: string; at: string } | null = null

  /** Wait for a running cycle to finish (manual commands queue behind it instead of being dropped). */
  private async idle(maxMs = 10 * 60_000) {
    const t0 = Date.now()
    while (this.busy && Date.now() - t0 < maxMs) await sleep(200)
  }

  /** Map a backend sync request to cycle options. */
  static commandOptions(c: SyncCommand): CycleOptions {
    switch (c.type) {
      case 'push': return { push: true, pull: false }
      case 'pull': return { push: false, pull: true, forcePull: true }
      case 'pull_entity': return { push: false, pull: true, only: c.entity ? [c.entity] : undefined, forcePull: true, full: !!c.full }
      case 'full_repull': return { push: false, pull: true, forcePull: true, full: true }
      default: return { push: true, pull: true, forcePull: true }
    }
  }

  /** Poll the backend for manual sync requests and run them. 404 = backend has no commands feature. */
  async pollCommands() {
    if (!this.configured || Date.now() < this.commandsUnsupportedUntil) return 0
    let cmds: SyncCommand[]
    try { cmds = await this.api<SyncCommand[]>('GET', '/api/tally-sync/commands', undefined, 0) }
    catch (e) {
      if (e instanceof BackendError && e.status === 404) { this.commandsUnsupportedUntil = Date.now() + 10 * 60_000; return 0 }
      throw e
    }
    for (const c of cmds) {
      await this.api('POST', `/api/tally-sync/commands/${c.id}`, { status: 'running' }, 1)
      this.lastCommand = { id: c.id, type: c.type, status: 'running', at: new Date().toISOString() }
      log('info', `manual ${c.type}${c.entity ? ` ${c.entity}` : ''} requested from backend (${c.id})`)
      await this.idle()
      const r: any = await this.cycle(Agent.commandOptions(c))
      const ok = !r.skipped && r.gate === 'matched' && !r.error
      const summary = r.skipped ? `skipped: ${r.reason}` : ok
        ? `pushed ${r.pushed}, pulled ${r.pulled.length} entit${r.pulled.length === 1 ? 'y' : 'ies'}${r.pulled.length ? ` (${r.pulled.join(', ')})` : ''}`
        : `gate ${r.gate}`
      const body = { status: ok ? 'done' : 'failed', summary, error: ok ? undefined : r.error ?? r.message ?? r.reason, result: { gate: r.gate, pushed: r.pushed ?? 0, pulled: r.pulled ?? [] } }
      await this.api('POST', `/api/tally-sync/commands/${c.id}`, body, 2).catch((e) => log('warn', `command report failed: ${(e as Error).message}`))
      this.lastCommand = { id: c.id, type: c.type, status: body.status, at: new Date().toISOString() }
      log(ok ? 'info' : 'warn', `manual ${c.type}: ${body.status} - ${summary}${body.error ? ` - ${body.error}` : ''}`)
    }
    return cmds.length
  }

  startCommandPoll(ms = 4000) {
    this.stopCommandPoll()
    const run = async () => {
      try { await this.pollCommands() } catch (e) { log('warn', `command poll: ${(e as Error).message}`) }
      this.commandTimer = setTimeout(run, ms)
    }
    this.commandTimer = setTimeout(run, Math.min(ms, 1000))
  }
  stopCommandPoll() { if (this.commandTimer) clearTimeout(this.commandTimer); this.commandTimer = undefined }

  start() {
    const loop = (fn: () => Promise<unknown>, sec: () => number) => {
      const run = async () => {
        try { await fn() } catch (e) { log('warn', (e as Error).message) }
        this.timers.push(setTimeout(run, sec() * 1000))
      }
      this.timers.push(setTimeout(run, 1000))
    }
    loop(() => this.cycle(), () => this.settings.sync.jobPollSec)
    this.startCommandPoll(Number(process.env.TALLYSYNC_COMMAND_POLL_MS ?? 4000))
    log('info', `TallySync agent ${AGENT_VERSION} started; data dir ${dataDir()}; tally ${this.settings.tallyMode} ${this.settings.tallyUrl}; settings http://127.0.0.1:${this.settings.uiPort}`)
  }
  stop() { this.stopCommandPoll(); for (const t of this.timers) clearTimeout(t); this.timers = [] }
}

export interface CycleOptions { forcePull?: boolean; full?: boolean; push?: boolean; pull?: boolean; only?: PullEntity[] }
export interface SyncCommand { id: string; type: 'sync' | 'push' | 'pull' | 'pull_entity' | 'full_repull'; entity?: PullEntity | null; full?: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
