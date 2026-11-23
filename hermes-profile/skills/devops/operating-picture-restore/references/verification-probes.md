# Probes for restoring the operating picture

Concrete probes per claim class. Run them, keep the raw output, and compare it
with what the handoff file claims. Paths are the ones this box actually uses —
adjust to the current layout rather than trusting a stale path from a file.

## Processes and ports

```
netstat -ano | grep -E ':3001|:8701|:9222|:8790'
```
The owning PID is the last column. Match it against the process list before
believing a service is up — a stale `gateway_state.json` says "running" for a
process that is gone.

To know *when* a process started (needed to decide whether it has picked up a
config edit):

```python
import psutil, datetime
print(datetime.datetime.fromtimestamp(psutil.Process(pid).create_time()))
```

Compare that against the config file's mtime. A process started **before** the
config was written has not read it.

## Scheduled jobs and their deliveries

- Job definitions: `%LOCALAPPDATA%/hermes/cron/jobs.json` — read
  `name`, `schedule`, `deliver`, `enabled`.
- Execution history: `%LOCALAPPDATA%/hermes/cron/executions.db` (SQLite).
  The row's `delivery_outcome` is the ground truth for delivery:
  `delivered` = the message went out, `suppressed` = the job ran and
  deliberately sent nothing. A job that "runs every 10m" but only ever
  records `suppressed` is not delivering.

```
python -c "import sqlite3;c=sqlite3.connect(r'C:/Users/Administrator/AppData/Local/hermes/cron/executions.db');cur=c.execute('select job_id,status,delivery_outcome,started_at,finished_at from executions order by rowid desc limit 10');[print(r) for r in cur]"
```

Read `status` and `delivery_outcome` together: `completed` + `suppressed` is
a healthy no-op, `failed` is a real fault.

## Hermes config surfaces

`%LOCALAPPDATA%/hermes/config.yaml` and `.env`. Two different lifetimes:

- **Read at gateway start** — `telegram.allowed_chats`,
  `platforms.telegram.allowed_chats`, `TELEGRAM_HOME_CHANNEL`, the `model`
  block. Editing these needs a gateway restart to take effect.
- **Read per trigger** — a cron job's `deliver` target is taken from the job
  config when the job fires, so changing it needs no restart.

So a handoff's "restart the gateway so allowed_chats is picked up" is only
about the first group; a cron delivery change is live immediately.

Also: `hermes config set` takes **one key at a time** — a space-separated
multi-key line errors. List values (like `allowed_chats`) are written as a
string, which is not a list, so those are edited through YAML directly with a
backup taken first.

## Registries and order state

The review/account registry is a SQLite DB. Query it; never trust a count
from a note.

```
python -c "import sqlite3;c=sqlite3.connect('reviews/data/registry.db');print([r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")])"
```

Useful shapes:

- `accounts` — one row per identity: `status`, `profile_id`, `proxy_id`,
  `last_used_at`, `posts_total`, `city`, `has_phone`, `level`.
- `flow` — one row per order: `state`, `target` (the **external** order id),
  `account_id`, `updated_at`.
- `steps` — the per-order step log (`activity` / `route` / `publish` /
  `submit`), each with a timestamp; this is where "published at 16:30" lives.
- `jobs` — the ingested card list, separate from `flow`.

Two traps:

- **Query by the external order id.** `flow.id` is a local row number and
  `flow.target` is the marketplace's id; a lookup that assumes they are equal
  matches nothing.
- **The table that records a publication may not be the one you expect.** A
  `reviews` table can sit empty while the real record of what was published
  lives in `steps` and `flow.state='on-review'`. Check the schema and the
  actual row counts before concluding that nothing was published.

## Antidetect profile artifacts

A cloud profile list is not the truth about whether an identity is logged in.
The profile's own data dir is: `%APPDATA%/dolphin_anty/browser_profiles/<id>/`
holds `<id>.datadir.zip` (archived) or `data_dir/` (live). The Chromium
`Default/Cookies` file inside is a SQLite DB; its `host_key` column lists the
domains that profile holds cookies for. Read it with the pool skill's
`scripts/check_profile_session.py <profileId>`.

An empty remote `export-cookies` answer plus a populated local Cookies DB
means: logged in, remote endpoint not reporting it. Do not re-login and burn
the identity — the session is fine.

## Vendor money

Proxy/provider balances come from the vendor's own API or the local ledger
script, not from the handoff file. Balance plus the port count plus the
per-port country mix are three separate facts; check all three before
claiming the pool is funded.
