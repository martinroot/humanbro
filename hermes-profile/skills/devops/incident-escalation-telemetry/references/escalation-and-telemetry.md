# Escalation wiring — concrete implementation (JobLock contour)

Reference for the always-on rules in SKILL.md: exact channels, contracts and
commands as installed. Rebuild only from here; do not invent a second path.

## Channels (two, independent)
- **Project API (default, no key):** `POST http://127.0.0.1:8701/api/tasks`
  (JobLock portal, FastAPI `app.py`).
- **External tracker (second channel):**
  `POST http://5.144.179.170:8080/api/task_queue.php` with header
  `X-Ingest-Key` (same key as the token-usage report). Activates only when
  `X_INGEST_KEY` exists in env or `browser-automation/.env`. Without it the
  answer is `401 bad ingest key` → log to script stdout only, never chat,
  never loop-retried. Tracker limits: server-side dup skip, max 3 open cards
  per `source` per project (429 beyond), one-line `title`, one card handed to
  the fixer at a time.

## Project API task contract (`portal/app.py`)
- `GET /api/tasks` → `{ok, count, tasks:[…]}`; filters `?status=`, `?agent=`;
  ordered by priority, id DESC.
- `POST` body: `title` (required), `status='todo'`, `progress`, `cat`,
  `agent_code`, `agent_slug`, `order_number`, `priority` (int, default 3),
  `note` → `{ok, id}`.
- `PATCH /{id}` — only those fields; `DELETE /{id}` → `{ok, changed}`.
- Board separation: incident cards live on the task board; order status lives
  on the orders board (`/api/orders` + registry) — do not mix them.

## Escalation module: `task_queue.py` (in `%LOCALAPPDATA%\hermes\scripts`)
- Entry point `on_exception(component, exc_type, text, where)`:
  gate → fingerprint → portal card (+ tracker card when the key exists).
- Gate state `task_queue_state.json` beside the module: per
  component+type cooldown (30 min) and noise whitelist
  (`FileNotFoundError/KeyError/IndexError/StopIteration` swallowed);
  CRITICAL classes (Timeout/URLError/Connection*/OperationalError/
  DatabaseError/RuntimeError/CalledProcessError) → `priority 1`, else 2.
- Marker `[EX:<sha1-12>]` of `component|type|normalized-message` leads the
  note; note continues `ID=… | Исключение … | Ошибка … | место … | заказ …`.
- Order binding: when `mode.json` says `режим=execute`, `order_number` is set
  to the focus order — the card lands on the exact order.
- Hook: `install_hook(component)` sets `sys.excepthook` → `on_exception`,
  preserving the previous hook so the process still exits non-zero.

## Hooking a cron script (two lines, after `__future__`/first import)
```python
import sys as _sys_tq
try:
    from task_queue import install_hook as _install_hook
    _install_hook("<script>.py")
except Exception:
    pass
```
Wrap in try/except so a missing module never blocks the script itself;
`compile(source, path, 'exec')` before writing the edited file.

## Status snapshot cron
- Script `status_sys.py` (same scripts dir), job mode `no_agent`
  (`script=…`, no prompt), cadence `every 10m`,
  `deliver: telegram:<owner-dm-id>` — owner DM, not the group: the owner asked
  for the process log privately.
- Content per snapshot: mode/focus + `mode.json` timestamp, order counters from
  `/api/orders`, port liveness (portal/CDP/antidetect) via netstat, diagnostics
  heartbeat age + incident/delivery counts, last cron run statuses parsed from
  `cron/output/<job>/*.md`, last `[task_queue]` line if present.
- stdout verbatim; empty stdout sends nothing. Keep the script quiet by
  printing nothing when healthy — an exception becomes an error alert.

## LLM-free diagnostics daemon (joblock-maintenance)
- Installed dir `C:\Users\Administrator\joblock-maintenance-0.1.0\
  joblock-maintenance-0.1.0`; platform task `JobLockMaintenanceDiagnostics`
  (state Running, re-arms at user logon, owns only itself; stop/remove via
  Stop-ScheduledTask / Unregister-ScheduledTask on that name only).
- Commands: `once | run | status | timings | flush |
  record <component> <code> | confirm-not-sent <fp> --confirmed-absent |
  audit --source … [--log …] --output …`; tests:
  `python -m unittest discover -s tests -v` (21 tests, must stay green).
- Config `maintenance.example.json`: the probe must assert HTTP 200 AND
  `ok=true` (an open port is not health); `task_api.enabled` turns its portal
  adapter on; `source_root` enables syntax scans of the tree.
- Cards carry `[JM:<fp>]` in `note`. Markers and `maintenance-data/` are the
  dedup protection — read-only. `delivery=uncertain` = POST possibly landed:
  reconcile by listing, never blind-repost; only
  `confirm-not-sent … --confirmed-absent` re-arms. Cards do not auto-close on
  service recovery (availability ≠ fixed root cause).
- `audit` exit codes: 0 clean, 1 syntax errors found (report; dead one-off
  patcher files may simply be deleted), 2 tool failure.

## E2E verification (after any change to this path)
1. Clear the cooldown state file.
2. `on_exception('x_probe.py','RuntimeError','simulated crash')` → portal
   answers `{ok, id}`; card present with `[EX:…]` and (if execute mode)
   `order_number` set.
3. Repeat the same call → `skipped: noise or cooldown`.
4. Direct `post_portal` twice with one marker → second returns
   `portal card exists`.
5. DELETE the test cards; leave only real incidents (never touch `[JM:]`
   cards belonging to the diagnostics daemon).
