# JobLock Control v3 portal workflow

Use this reference when the dispatcher-backed console is built in the JobLock portal.

## Sources and adapter boundary
- Portal entrypoint is `C:/sites/joblock/portal/app.py`; the established UI runs behind nginx `/portal/` on FastAPI `:8701`. Keep a requested `/portal/log_v2` implementation separate from `/portal/log` until verified and explicitly switched.
- Control v3 lives under `C:/sites/joblock/control-v3`; its `Dispatcher` and `data/control.sqlite3` own isolated runs, scenarios, and event traces. The portal should be a thin API/UI bridge to that dispatcher.
- `joblock.legacy_sync.fetch_legacy_records()` reads the MariaDB and review sources; `Dispatcher.sync_legacy(records)` refreshes only the Control v3 snapshot. Show `legacy_summary().last_sync` and record counts; snapshots are best-effort, not transactional live views.
- For each new stage, add its adapter name to `joblock/scenarios.py`, implement it in `joblock/adapters.py`, and add a one-stage versioned JSON scenario under `scenarios/`. Keep run inputs to stable selectors, not full order payloads.
- Snapshot adapters should return an allowlisted summary, not free-text descriptions, chat contents, credentials, or raw payloads. For chat reads, log counts/times/hashes, not message bodies.

## Verification sequence
Run tests from both repositories:

```text
cd C:/sites/joblock/control-v3
python -m unittest discover -s tests -v
cd C:/sites/joblock/portal
python -m unittest discover -s tests -v
python -m py_compile app.py log_v2.py isolated_control.py
```

For inline JavaScript, render the page into a temporary JS file and run `node --check` on it. Also exercise API route tests with stub dispatchers; tests must not submit real marketplace actions.

Before deployment, identify the listener PID for `:8701` and the active supervisor. The portal does not have an assumed hot reload; restart only the supervised portal application, not all `python.exe` processes and not the parser/worker. Then read back the exact local `/log_v2` route, `/api/log/isolated/summary`, and a filtered records request. Confirm run creation does not advance a step, and confirm one explicit step produces a trace in the shared Control v3 store. Do not create a live order or send a chat message to prove the interface works.

## Unified system log and scheduler controls
- The primary JobLock system-log tab is new-contour-only: query Control v3 `control.sqlite3/events`, including `_system`; do not merge `live_log`, legacy registry steps, or imported snapshots. Keep it global and unfiltered; order selection belongs in the separate DEBUG/phase view.
- Normalize each row to exactly `Время, Фаза, Заказ, Скилл, Инструмент, Описание`. Join dispatcher events to the run document for phase/order/adapter attribution; map global events to `Система` and use `—` only when attribution is unavailable.
- Build descriptions from event kind, step, status, duration, and bounded sanitized reasons. Include `step_finished` retry/review outcomes, `command_failed`, `infrastructure_error`, `lease_expired`, and similar errors as visible error rows. Never serialize raw request/response payloads, diagnostics, customer text, or credentials; populate cells with `textContent`.
- Start/Stop controls only Control v3's `Dispatcher.pause`; require confirmation, read back the paused state and LIVE queue counts, and never alter legacy `mode.json` or legacy pause state. Before testing Start, check for queued/running LIVE runs because unpausing can execute them; restore the initial state afterward.
- Poll the new event API continuously (2 s is the current UI cadence). Emit a scheduler heartbeat only while unpaused, include queued/running counts, and prune old heartbeat rows so idle-but-running state is observable without unbounded log growth. A zero queue means idle, not a reason to fabricate workflow events.
- Test dispatcher-only API rows, system pause/start/stop readback, exception redaction, all six columns, default system tab, and JavaScript syntax. Deploy portal and dispatcher changes through their separate supervisors; verify the live endpoint, running state, queue counts, and heartbeat after restart.
