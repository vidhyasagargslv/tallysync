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
- User creates Sales Orders / Purchase Orders / Credit Notes / Debit Notes (or masters) in the app -> stored in `outbox` as `pending`.
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
npm test                                     # builds the web app + 96-check e2e in mock mode
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

## Creating data in the app
Create (pushes to Tally): **Customers** (ledger under `groups.customers`), **Suppliers** (`groups.suppliers`), **Items**
(unit, stock group, HSN/SAC, GST rate, opening stock per godown), **Sales Orders**, **Purchase Orders**, **Credit Notes**, **Debit Notes**. Every save queues a
record (pending -> synced/failed, error, Retry, request/response XML). Edits (`PUT /api/records/:id`; name/number fixed)
push as Alter. Order pickers merge local masters with masters pulled from Tally. A voucher that uses a local master not yet
synced waits ("waiting for ...") until that master syncs; masters always go before vouchers.

Credit / debit notes (`credit_note`, `debit_note`) take the same payload as sales/purchase (party, date, number, item lines,
GST mode, narration) plus optional `againstInvoice` (+ `againstInvoiceDate`). Credit note (sales return): party credited,
sales-return ledger + output GST debited, stock comes in. Debit note (purchase return): party debited, purchase-return
ledger + input GST credited, stock goes out. With `againstInvoice` the party's bill allocation is `Agst Ref <invoice>`,
otherwise `New Ref <note number>`. Ledgers come from mapping `salesReturn` / `purchaseReturn` (default: reuse `sales` /
`purchase`); voucher type names from `voucherTypes.credit_note` / `voucherTypes.debit_note` (default `Credit Note` / `Debit Note`).

## Manual sync (when you don't want to wait for the 15 s cycle)
1. **Web app dashboard -> Manual sync:** Sync now (push + pull), Push only, Pull only, Pull one entity, Full re-pull
   (ignores ALTERID cursors, full snapshots). The request is stored in `sync_requests`; the agent polls
   `GET /api/tally-sync/commands` every ~4 s (`TALLYSYNC_COMMAND_POLL_MS`), runs it immediately (company gate applies; if a
   cycle is running it queues behind it) and reports `running` -> `done`/`failed` with a summary, shown live on the dashboard.
   Requests not picked up within 2 min (`SYNC_REQUEST_TTL_SEC`) become `expired`: the agent is offline or can't reach the app.
2. **On the Tally PC:** http://127.0.0.1:4100 -> **Sync now** (works even when the app can't reach the agent's commands).
3. **CLI on the Tally PC:** `tallysync-agent.exe sync-once` (with `TALLYSYNC_HOME=%ProgramData%\TallySync` when run by hand)
   runs one full cycle and prints the result JSON.

## Tally mapping (declarative config)
Where sales, purchases, taxes, round-off and auto-created masters go is defined in one file:
`apps/web/config/tally-mapping.jsonc` (JSON with comments; path overridable with `TALLY_MAPPING_PATH`). Schema:
`TallyMappingZ` in `packages/contracts/src/mapping.ts`. Every key is optional; `{}` gives the defaults.

- The app serves it at `GET /api/tally-sync/mapping` (API key) as `{ version, hash, source, mapping }`. An invalid file
  returns 422 and the agent keeps its last good copy (cached in `state/mapping-cache.json`). `agent.json` -> `mapping`
  is only used if the agent has never fetched one.
- Each cycle the agent re-fetches it (edits apply without restart), checks every name it references against the Tally
  company's ledgers/groups/voucher types/godowns/units, and posts the result to `POST /api/tally-sync/mapping/validation`.
  The **Tally mapping** page shows the active file, schema errors, which version the agent uses and the issues.
- Before each voucher the agent checks the party, line ledgers, tax ledgers, round-off ledger, items, godowns and voucher
  type. Missing ones are created under the configured group when `autoCreate` allows it; otherwise the record fails with
  a message saying what is missing and how to fix it.

Ledger choice per line: `items` > `itemGroups` (Tally stock group of the item) > `rules` (first match; conditions
`gstRate`, `supply` local/interstate from the order's GST mode, `itemGroup`, `item`) > `default`. Lines with
different rates can land in different sales ledgers. Tax ledgers come from `tax` (or `purchaseTax` for purchases) with
`byRate` overrides. With `roundOff.enabled` the party total is rounded (`nearest`/`up`/`down` to `precision`) and the
difference is posted to the round-off ledger so the voucher balances.

**Trade discount (optional, backward compatible).** A voucher may carry `discount` (invoice-level amount) and/or a
per-line `discount` (amount). Items are posted at their gross rate; the invoice discount is apportioned over lines by
value, GST is computed on each line's value *after* discount (a trade discount shown on the invoice reduces the taxable
value, CGST Act s.15(3)(a)), and the total discount is posted to `discountLedgers.sales` (debited, default
`Discount Allowed`) or `discountLedgers.purchase` (credited, default `Discount Received`); credit/debit notes use
`salesReturn`/`purchaseReturn` or fall back. Party = gross − discount + tax (± round-off). Missing discount ledgers are
only a validation *warning* (needed when used); with `autoCreate.ledgers` they are created under
`groups.discountAllowed` / `groups.discountReceived`. Purchases may send `supplierInvoiceNo`/`supplierInvoiceDate`,
posted as Tally REFERENCE / REFERENCEDATE (Supplier Invoice No.) and used as the bill-wise reference.

```jsonc
{
  "version": "2",
  "voucherTypes": { "sales": "GST Sales" },
  "sales": {
    "default": "Sales",
    "rules": [
      { "gstRate": 5, "supply": "local", "ledger": "Sales 5% Local" },
      { "supply": "interstate", "ledger": "Sales Interstate" }
    ],
    "itemGroups": { "Services": "Service Income" }
  },
  "purchase": { "default": "Purchase" },
  "salesReturn": { "default": "Sales Returns" },       // credit notes (optional; defaults to "sales")
  "purchaseReturn": { "default": "Purchase Returns" }, // debit notes (optional; defaults to "purchase")
  "tax": { "cgst": "CGST", "sgst": "SGST", "igst": "IGST", "byRate": { "5": { "cgst": "CGST 2.5%", "sgst": "SGST 2.5%", "igst": "IGST 5%" } } },
  "roundOff": { "enabled": true, "ledger": "Round Off", "mode": "nearest", "precision": 1 },
  "cashBank": { "receipt": "Cash", "payment": "HDFC Bank" },
  "defaultGodown": "Main Location",
  "groups": { "customers": "Sundry Debtors", "suppliers": "Sundry Creditors", "salesLedgers": "Sales Accounts",
              "purchaseLedgers": "Purchase Accounts", "taxLedgers": "Duties & Taxes", "roundOff": "Indirect Expenses",
              "items": "", "defaultUnit": "Nos" },
  "autoCreate": { "parties": true, "ledgers": true, "items": false },
  "names": { "parties": { "Ravi": "Ravi Stores" }, "items": {}, "units": { "pcs": "Nos" } }
}
```
Other backends: serve the same JSON from `GET /api/tally-sync/mapping` (validation endpoint optional; 404 is ignored).

## Adapting to another client's backend
Implement these with header auth `x-api-key` (agent also sends `x-company-guid`, `x-contract-version`); schemas are in
`packages/contracts/src/index.ts`:

| Endpoint | Body / response |
|---|---|
| `GET /api/tally-sync/pending?limit=25&entities=sales_order,ledger,...` | -> `[{ id, entity, attempts, payload }]` (entity: `sales_order`, `purchase_order`, `sales`, `purchase`, `receipt`, `payment`, `credit_note`, `debit_note`, `ledger`, `stock_item`, `unit`, `godown`, `group`, `stock_group`). Mark them in-progress with a lease. Optional `entities` (comma-separated push kinds): claim only those; the agent sends its enabled push kinds so disabled ones stay `pending` (not leased, attempts unchanged). Absent = all kinds (backward compatible); empty = nothing. A voucher is held ("waiting for ...") only on unsynced local masters whose kind is in `entities` (or any kind when absent); masters of a disabled kind don't hold it. |
| `POST /api/tally-sync/result` | `{ id, status: synced\|failed, action, error, transient, tallyGuid, tallyMasterId, voucherNumber, requestXml, responseXml }`. `transient=true` -> keep pending and retry. |
| `POST /api/tally-sync/data/{entity}` | `{ entity, full, sinceAlterId, maxAlterId, company, objects: [{ guid, name, masterid, alterid, parent, data, rawXml, rawJson }], rows }`. Upsert by (entity, guid); `full=true` = snapshot (delete others). `rows` = balance refresh for `stock_summary` (stock items) / `outstanding`, `trial_balance` (ledgers). |
| `POST /api/tally-sync/status` | heartbeat (store latest). Should not be company-gated. |
| `GET /api/tally-sync/mapping` | `{ version, hash, source, mapping }` (see Tally mapping above). |
| `POST /api/tally-sync/mapping/validation` | optional; `{ hash, checkedAt, company, ok, issues[] }`. |
| `GET /api/tally-sync/commands` | optional (404 = unsupported, agent backs off 10 min); `[{ id, type: sync\|push\|pull\|pull_entity\|full_repull, entity?, full? }]`, each returned once. |
| `POST /api/tally-sync/commands/:id` | optional; `{ status: running\|done\|failed, summary?, error?, result?: { gate, pushed, pulled[] } }`. |

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
  delete/cancel, multi-currency not built. Mapping page is read-only (edit the file).
