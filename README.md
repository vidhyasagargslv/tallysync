# TallySync

Two deliverables, no central server:

1. **TallySync Agent** (`apps/agent`): one generic Windows exe that runs as a service on the client's Tally PC.
2. **Next.js app** (`apps/web`): full-stack test dashboard + backend (API routes + SQLite). Any other client backend
   (FastAPI, Supabase, Express...) can replace it by implementing the same 4 endpoints.

```
 Next.js app (UI + /api/tally-sync/* + SQLite)  <--HTTPS, outbound only--  TallySync Agent (Windows service)  --XML localhost:9000-->  TallyPrime
```

Shared code (npm workspaces): `packages/contracts` (zod schemas = the API contract), `packages/tally-core`
(Tally XML builders/parsers, full-field pull, ALTERID incremental, idempotent push, mock Tally).

## How it works
- User creates Sales Orders / Purchase Orders (or masters) in the app -> stored in `outbox` as `pending`.
- Agent loop (every 15 s): **company gate** -> `GET /api/tally-sync/pending` -> push each to Tally (lookup first:
  Create or Alter, so no duplicates) -> `POST /api/tally-sync/result` (synced + Tally GUID / voucher no, or failed + Tally's error).
- Timed pulls of every entity (all on by default, toggle each on the agent page): company, group, ledger, cost_centre,
  currency, unit, stock_group, stock_category, godown, stock_item, voucher_type, voucher (incremental by ALTERID),
  stock_summary, outstanding, trial_balance -> `POST /api/tally-sync/data/{entity}`. Every object carries normalised
  fields **plus the full raw XML and raw JSON**; the app records every field path in the schema explorer.
- Heartbeat `POST /api/tally-sync/status`: Tally reachable, gate state, locked company, last pull/push, errors, enabled pulls.

**Company gate.** On the agent you type the company name. On the first successful connect the agent locks that
company's GUID + GSTIN. Before every sync the locked GUID must be open in Tally (GSTIN must match too), otherwise
nothing is pushed or pulled and the reason is reported. The backend also locks to the first GUID it sees and rejects
other GUIDs with 409. To switch company on purpose: "Reset company link" in the app's Settings + "Re-link" on the agent.

## Run on Mac (mock Tally)
```bash
npm install && npm approve-scripts esbuild better-sqlite3
cp apps/web/.env.example apps/web/.env       # API key + SQLite path
npm test                                     # builds the web app + 45-check e2e in mock mode
npm run dev:web                              # http://localhost:3000
# second terminal: agent against mock Tally
TALLY_MODE=mock TALLYSYNC_HOME=./data/agent TALLYSYNC_BACKEND_URL=http://localhost:3000 \
  TALLYSYNC_API_KEY=dev-tallysync-key-change-me TALLY_COMPANY="Demo Sync Co" npm run dev:agent
```
Agent page: http://127.0.0.1:4100. In the app: Masters outbox -> "Queue demo masters", then create a sales order.

## Windows + real Tally
1. TallyPrime: open (or create) the company, F1 > Settings > Connectivity: "TallyPrime acts as" **Both**, port **9000**.
   Check http://localhost:9000 says "TallyPrime Server is Running".
2. Build the exe (Mac or Windows): `npm run build:exe` -> `apps/agent/release/tallysync-agent.exe` (Node SEA, win-x64).
3. Installer (on Windows, needs Inno Setup 6): `powershell -ExecutionPolicy Bypass -File apps\agent\packaging\build-installer.ps1`
   -> `TallySync-Agent-Setup-1.0.0.exe`. It installs a WinSW service "TallySync Agent" (automatic start on boot, delayed,
   restarts on failure). Without Inno Setup: copy the exe, `packaging\*.ps1`, `tallysync-agent-service.xml` and WinSW
   (`node apps/agent/packaging/fetch-winsw.mjs` -> `bin\tallysync-agent-service.exe`) into one folder and run
   `install-service.ps1` as Administrator (optional `-BackendUrl -ApiKey -Company`).
4. Run the Next.js app somewhere the Tally PC can reach (e.g. on the Mac: `npm run build -w @tallysync/web && npm run start:web`,
   use `http://<mac-ip>:3000`). Copy the API key from the app's **Settings** page.
5. On the Tally PC open http://127.0.0.1:4100: backend URL, API key, Tally URL (`http://localhost:9000`), company name
   exactly as in Tally, mode `real` -> **Save & test**. The status card should show *matched* and the locked GUID.
6. Test: queue demo masters -> they appear in Tally; create a SO and PO -> check them in Tally's Day Book (statuses turn
   *synced*); enter a sales/purchase in Tally -> after the next pull it shows under Sales/Purchases/Stock; open another
   company only -> agent blocks with *mismatch*/*not_open*.

Data on Windows: `%ProgramData%\TallySync` (`agent.json` settings, `apikey.dpapi` API key encrypted with DPAPI
LocalMachine, `state\`, `logs\agent.log`). Send `logs\agent.log` when something fails.

CLI: `tallysync-agent.exe --version`, `configure --backend URL --key KEY --company "Name" [--tally URL]`, `sync-once`.

## Adapting to another client's backend
Implement these with header auth `x-api-key` (agent also sends `x-company-guid`, `x-contract-version`); schemas are in
`packages/contracts/src/index.ts`:

| Endpoint | Body / response |
|---|---|
| `GET /api/tally-sync/pending?limit=25` | -> `[{ id, entity, attempts, payload }]` (entity: `sales_order`, `purchase_order`, `sales`, `purchase`, `receipt`, `payment`, `ledger`, `stock_item`, `unit`, `godown`, `group`, `stock_group`). Mark them in-progress with a lease. |
| `POST /api/tally-sync/result` | `{ id, status: synced\|failed, action, error, transient, tallyGuid, tallyMasterId, voucherNumber, requestXml, responseXml }`. `transient=true` -> keep pending and retry. |
| `POST /api/tally-sync/data/{entity}` | `{ entity, full, sinceAlterId, maxAlterId, company, objects: [{ guid, name, masterid, alterid, parent, data, rawXml, rawJson }], rows }`. Upsert by (entity, guid); `full=true` = snapshot (delete others). `rows` = balance refresh for `stock_summary` (stock items) / `outstanding`, `trial_balance` (ledgers). |
| `POST /api/tally-sync/status` | heartbeat (store latest). Should not be company-gated. |

FastAPI: 4 route functions + tables like `apps/web/lib/db.ts` (`outbox`, `tally_objects`, `schema_fields`, `pull_state`,
`agent_status`). Supabase: the same 4 as Edge Functions (or Next/Express routes) over those tables. Reference logic: `apps/web/lib/repo.ts`.

## Layout
```
packages/contracts   API contract + neutral entity schemas (zod)
packages/tally-core  TallyClient, TallyEngine (pull/push/gate helpers), XML import/export, normalise, reports, mock Tally
apps/agent           agent.ts (loop, gate, push, pull, heartbeat), ui.ts (127.0.0.1:4100), secret.ts (DPAPI), packaging/
apps/web             Next.js App Router: app/api/tally-sync/* (agent API), app/api/* (UI API), pages, lib/db.ts (SQLite)
scripts/e2e.ts       mock-mode end-to-end test
```

## Not done yet / gaps
- Not run against real TallyPrime yet (GST field layout, voucher Alter by number+date, GST totals still to confirm).
- Exe is unsigned (SmartScreen warning) and embeds the Node version used to build it (currently 26.x).
- The Next.js UI has no login (fine for testing; add auth before exposing it). One Tally company per agent/backend.
- No auto-update, no tray icon, no Postgres run yet (SQL is portable). Invoice-against-order linking, voucher
  delete/cancel, multi-currency and agent-side mapping UI (mapping lives in `agent.json` -> `mapping`) not built.
