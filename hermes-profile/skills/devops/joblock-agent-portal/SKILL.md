---
name: joblock-agent-portal
description: Build on the JobLock agent portal and parser stack.
---

# JobLock agent portal + parser stack

Use when working in the JobLock portal codebase (C:/sites/joblock) or browser-automation parser stack.

## Two codebases, two runtimes
- **PHP витрина/контракт** `C:/sites/joblock` (nginx :8080 → php-cgi :9000, MariaDB :3306). Don't rewrite. Files: `internal/agents.php`, `internal/order.php` (idempotent by source+external_id), `api/run.php`, `admin.php`, `catalog.json` (21 agents), `j/*.html`.
- **Python agent engine** `C:/sites/joblock/portal/` (new layer) on top of same MariaDB.

## Python layer
- `app.py` — FastAPI :8701, via nginx `/portal/` (proxy strips prefix; JS uses `/portal/...`). `/api/tasks`, `/api/agents` (stability), `/api/ingest` (POST card → pick agent → create order; full-auto no price cap).
- `engine.py` — order folder + providers. DB 127.0.0.1/pma/WhoviQuayb4/joblock. PROBE_N=3, list_agents(only_live), find_agent, fetch_order, clean_json.
- `gate.py` — go/need-info/blocked. **Missing access = need-info (ASK customer), offline/promise-later/impossible-tool = blocked.** Word-stem (3-char roots); access-input covered only if real access given (ssh/pass/token).
- `clarify.py` — question per missing input, refusal, MAX_УТОЧНЕНИЙ=2 / 24h, customer style switch (formal/casual/neutral).
- `refresh.py` — `note_from_exchange(external_id,source,text)` finds order by payload.external_id, appends answer to desc, **resets state.status→queued** then re-runs (else run_order early-returns needinfo). `send_waiting()` sends pending questions via msg.ts.
- `ingest.py` — `pick_agent(card)`: HARD keyword rules then soft role-score (live only). **Word-boundary matching `_hit()`: markers ≤3 chars must stand alone (else 'бот' matches внутри 'работа/доработка'); ≥4 match by root.** `ingest(card)` creates order number=source[:2]+'-'+sha1[:8].
- `runner.py` — gate → (probe) → steps → auto-quality → done. probe: first PROBE_N orders build task-specific plan into state `plan` (agents.pipeline untouched). check_quality() PASS/REVISE, one fix, no loop.
- `stability.py` — score/level (probe/learning/stable), lessons in agents.lessons.
- `worker.py` — claims new/queued/running/failed (excludes needinfo/blocked), runs, mirrors to orders+tasks.

## Order lifecycle
card → /api/ingest → orders(new) → worker claims → gate → need-info: build question → send via msg.ts → customer answers → note_from_exchange resets+reruns → gate re-judges → go → probe plan → steps → quality → done. Orders ENUM: new/queued/running/done/failed/paid/needinfo/blocked.

## Money loop (wired 2026-09-15)
`parser.ts` (Workzilla/Kwork/Insolvo) now POSTs each passing finding to `http://127.0.0.1:8701/api/ingest` after filters (source/external_id/title/description/price) → same full lifecycle. Restart parser via killing the bun parser.ts process (keeper recreates). Verified E2E: card→ingest→worker→done quality=pass.

## Fabra parser integration (when explicitly routed)
- Use `PARSER_SINK=joblock|fabra`; never dual-write marketplace projects, since either backend can create and run work. Default to the existing JobLock route unless the owner has selected Fabra and the Fabra token is configured.
- Never print `FABRA_PARSER_TOKEN`, put it in project payloads, or include it in errors. On missing/401 token, bootstrap with `GET /auth` only from the real allowlisted egress IP—never spoof `X-Real-IP`; validate the returned header/base URL and verify `/agents` before persisting in the ACL-restricted local `.env`. No token in Telegram or logs. Bootstrap `403`/validation failure must fail closed without JobLock fallback.
- Use `fabra-client.ts` for the `fabra-parser.v1` API: fetch/cache catalog, batch <=100, idempotent `source+external_id`, retry transient/network failures, poll status changes. The parser client supports exclusive routing and automatic allowlisted bootstrap.
- If the owner requests Fabra intake of all tasks, forward every newly discovered open project-feed card without local agent, price, proposal-count, or text-duplicate filters; omit `agent` for Fabra to handle. Keep Kwork seller-services feeds read-only, retain source-qualified ID dedupe, and do not backfill historical logs unless explicitly asked.
- Do not create fake production projects just to test POST/PATCH; verify those using a real listing or an explicitly approved test fixture.
- Treat HTTP 5xx after POST as an ambiguous commit: query `/projects?since=...` and exact `source+external_id` records before retrying; keep transient failures retryable in parser state, and rely on idempotency only after read-back confirms one record.
- Marketplace offers remain separately gated: importing a project into Fabra is not approval to submit an offer on the exchange.

## Orders folder (per order)
`C:/var/lib/joblock/works/<NUMBER>/`: order.json, plan.yaml, state.json (status/progress/step/history/plan/final/quality/clarify_*), in/ out/, log.jsonl.

## Windows marketplace monitoring and Kwork seller dashboard
- For Kwork `/manage_kworks`, use the authenticated same-origin GET `/api/user/get_kworks_tab?group=all&page=N`; page size is 12, so use `pagingdata.total` and verify collected unique IDs equals total. Group counts are `rejected`, `feated` (stopped), `draft`, `all`. Read `commonRejectReason.decision` and `rejectFieldsString` for moderation alerts; keep this monitor read-only.
- Reuse the authenticated Kwork projects tab for seller-monitor API reads; `fetch(..., {credentials:'same-origin'})` preserves the user's browser session and avoids another Chrome tab. Persist a snapshot and alert only on warning changes, warning resolution, sales, or count/status changes—not view-count churn.
- Keep browser tabs by exact monitor routes, not broad substring patterns like `kwork` or `freelancer`; broad matching keeps every offer/detail page and defeats tab cleanup. Close ephemeral detail/offer tabs and preserve only feed roots, current-orders, and user editing forms.
- Do not emit Telegram inline buttons unless the one permitted callback consumer is running. When callbacks are not consumed, send one plain report with the ingest result. Keep bids off by default; only add the exact source-qualified `source:id` to the approved-offers allowlist after the owner explicitly approves that listing. Even after approval, require a new live-agent JobLock order (`candidate_ready`, `ingest_ok`, `ingest_new`); source-qualify external IDs to avoid cross-market collisions.

## Key facts / pitfalls
- MariaDB 127.0.0.1:3306. Only xAI (xai.key) → route_model all to grok-4.5.
- JSONResponse breaks on datetime/Decimal → clean(). **pymysql returns JSON column as str → json.loads before .get().** run_order early-returns needinfo/blocked → refresh must reset status→queued.
- tasks.status ENUM≠order status → map (needinfo→blocked) in report_task(number,title,status,progress,slug,note='').
- Python re has no `\p{L}` → `[^\w\u0400-\u04FF-]`.
- venv python pip via ensurepip. PYTHON for keeper: hermes venv. No hot-reload: kill python to reload portal code. Two `python.exe` per service = wrapper+runtime of ONE (not dupes).
- keeper.ts (browser-automation dir) supervises parser/watch-orders/php/nginx/MariaDB + python portal+worker. `msg.ts <id> <file>` sends Workzilla chat msg (text from file, not argv — cyrillic).
- `bun build parser.ts --target=bun` fails on playwright chromium-bidi deps — NOT our code; runtime runs via `bun parser.ts` fine.

## Portal + Jobsy integration checks
- Keep each top-level tool as a separate page module and URL with a shared native-anchor header. Do not make navigation depend on a global inline `onclick`; one script error can disable every button.
- Embed JavaScript in Python-generated HTML as a raw string; Python escape processing can turn `\\n` into literal line breaks inside JS strings. Extract the script from the rendered response and run `node --check` before restart.
- The public nginx path retains `/portal/` in the browser URL while stripping it upstream. Build API URLs with a prefix-aware helper and verify `http://host:8080/portal/jobsy/...` externally; direct `:8701/jobsy/...` alone does not verify this route.
- On first entry to “Исполнение заказов”, load both Jobsy templates and order list; test in a browser after waiting for async fetches and assert the select options are populated.
- Delegate execution buttons with `data-action` rather than composing inline `onclick` strings. Open the chat composer and refresh events; syntax-only tests won't catch bad generated attributes or hidden controls.
- Dagi bridge template lookup should accept the configured template `slug`, `name`, or `id`; preserve exact values. Treat transport failure as Dagi unavailable, return 503, and persist failed status instead of leaving the order running.
- Before claiming execution E2E, check `:8791` and GET `/api/templates`. If Dagi is absent, test create → assign → start failure/read-back with a uniquely named disposable QA order and remove only that exact order folder afterward; report real execution as blocked until Dagi is deployed.
