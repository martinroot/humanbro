---
name: incident-escalation
description: Use when a cron or pipeline failure needs engineering.
---

# Incident escalation for the autonomous loop

When a cron/pipeline step crashes, the loop must route the failure to whoever fixes code, without waking the owner and without repeating itself. Escalation is a gated, verifiable write — never a chat message and never a bare log line.

## Procedure (order matters)
1. **Let the self-heal layer run first.** The watchdog owns infrastructure it can restart from a clean slate (services, browsers, collector processes, duplicate processes, stale orders). Only a failure the watchdog cannot absorb is an engineering incident.
2. **Catch at both levels.** Every wrapper script installs `sys.excepthook` at import (catches anything unhandled) AND calls the escalation helper inside its explicit `except` blocks (catches what the script handles and continues from). A handled path that only prints is invisible to escalation.
3. **Run the gate before any write.** The gate decides noise vs incident: known-noise exception types are swallowed locally; a repeat of the same component+type inside the cooldown window (30 min) is dropped; everything else is classified — timeout/network/DB/runtime classes escalate as prio 1, the rest prio 2. State lives in a JSON file next to the module.
4. **Post one line, then read back.** The escalation payload is a single title line: `ID <component> | Исключение <type> | Ошибка: <text>` — that line is all the executor sees, so component, exception and error text must all fit in it. After posting, verify the card/list contains the marker before claiming delivery.
5. **Keep the fact even when suppressed.** A swallowed or cooldown-blocked escalation still prints `[task_queue] ... -> skipped` to the script stdout, so the run log preserves what happened without duplicating the card.

## Channels
- **Portal `GET/POST /api/tasks` (port 8701)** — GET returns `{ok, tasks}`, POST returns `{ok, id}`; PATCH/DELETE at `/api/tasks/<tid>`. No auth on the local port. Verified end to end; usable as the fallback channel while the tracker key is absent.
- **WINTASK tracker (`/api/task_queue.php`)** — header `X-Ingest-Key`, body `{project_ref, title, prio, source, note}` → `{ok, task_id, dup}`. `dry_run: true` validates the payload shape without creating a card — use it before a new field goes live. Without the key: `401 bad ingest key`, which must be logged locally and never retried blindly. Server rules: duplicate titles are suppressed, max 3 open tasks per `source` per project (else 429), the agent receives only `title` — no note, no protocol lines. Read the tracker's API doc before adding a new field.
- **Choose one channel per incident class; do not fan out to both** — duplicate cards on two systems are two backlogs to reconcile, and neither side can see the other's marker.

## Diagnostics daemon (joblock-maintenance)
A separate LLM-free loop that keeps its own health history and can open engineering cards itself:
- Probe = HTTP 200 AND `ok=true` on the API path — an open port proves nothing.
- Incidents in SQLite WAL: the same error updates ONE row (no duplicate stream); one card per component/code/location.
- Cards carry a `[JM:<fingerprint>]` marker in `note`; the marker is the duplicate guard — never edit or strip it, never delete the state directory.
- A lost POST stays `delivery=uncertain`: reconcile by listing, do not repost; allow a repost only via `confirm-not-sent <fp> --confirmed-absent` after independent confirmation.
- Recovery of the probed service does NOT auto-close a card — availability is not proof the root cause is fixed.
- Install = its own scheduled task at logon (`install-windows.ps1`), touching no other task or process; status commands: `once | status | run | flush | record | timings | audit`.
- The heartbeat's `task_delivery_enabled` reflects the config as of the last cycle, not the file just edited.

## Idle-but-alive diagnosis (a pipeline that runs but delivers nothing)
Before hunting a bug, decide whether anything crashed at all:
1. **Aggregate every output file of every job for the silent period**, not the latest one — a uniform one-line failure repeating in 100% of runs is a limiter, not a code defect.
2. **The wrapper's own budget is the usual limiter**: an in-process `subprocess.run(timeout=...)` smaller than a slow-feed run kills every cycle at the entrance; the exit marker (`TimeoutExpired` + an escalation line) proves the cap, not the loop. Fix the cap in the wrapper, keeping it under the cron interval minus a margin.
3. **Check the operating mode next** (`mode.json`): a pipeline in a search/reading mode may spend its whole budget on feeds while queued orders wait — mode and queue state are read together with the logs.
4. **Separate "system worked" from "orders moved"**: watchdog/status/collector jobs staying green while only the executor job fails is the signature of this class — non-executor jobs cannot substitute for it.
5. Verify with one instrumented run (wall-clock printed) before resuming the schedule.

## Pitfalls
- **A bare `print` in an exception path fixes nothing** — cron `no_agent` scripts have no reader unless their stdout is non-empty and the owner reads it; pair every handler's print with an escalation call.
- **Escalating on every tick is how the 3-open-tasks limit burns down** — the local cooldown and the server's dup suppression are both required; skipping the local gate turns one flapping service into a full quota in minutes.
- **The executor sees only the title line** — putting the error in `note` hides it from the agent that must fix the code.
- **A fixed-looking service after an incident proves nothing** — report the card as open until the fix is verified by a fresh run, not by liveness.
- **Key material never enters the code or the config** — read it from an env var or an env file; an API that answers 401 tells you the key is missing, not which key to invent.
- **A green job that never fires is usually paused, not broken** — before reading any code, check the scheduler's own record (`cronjob_manage list`: `enabled`/`paused_at`, `next_run_at` in the past vs `last_run_at` freshness). A pause written by another session leaves `failure_streak: 0` and `last_status: ok`, so every counter looks healthy while the schedule is dead — and any watchdog under it dies with it, which is why heartbeat age and job state are checked together, never one without the other.