---
name: hermes-gateway-ops
description: "Use when the Hermes Telegram gateway goes silent."
version: 1.0.0
metadata:
  hermes:
    tags: [hermes, gateway, telegram, messaging, restart, service, migration, secrets]
---

# Hermes messaging-gateway operations

Keeping the Hermes messaging gateway (Telegram and friends) alive and diagnosing why it went quiet on this Windows box. Companion to the bundled `hermes-agent` skill's gateway docs — this carries the operational pitfalls that actually bite, not the setup wizard.

## Owner hands you the task: implement, don't keep diagnosing

When the owner forwards a written task with explicit acceptance criteria, execute it; do not keep issuing more probes and explaining why it might not work. A short gateway restart (~10-20 s; sometimes ~40 s cold start) is an acceptable price for a working profile switch — do not build a hot-reload mechanism the owner did not ask for. Diagnose only to the depth needed to choose the implementation, then ship it and verify. The owner's standing preference: "take the order, do it, deliver" over a chain of clarifying questions and status reports. Do not repeat a discriminating ingress probe across turns: consolidate into one technical probe (raw API, parser, state file) plus one implementation, then verify — repeated "please send ping" asks burn trust without new information.

## Durable start: use the Scheduled Task, not a manual background run

- `hermes gateway run` in a bash background session is **fragile**: a long reply or a load spike can get the process killed (`exited UNCLEANLY when no exit path ran — SIGKILL/OOM`) and the bot **silently stops answering**. The symptom in `logs/gateway.log` is a log that just stops mid-send; `hermes gateway status` then reports a **stale** `gateway_state.json` (`recorded 'running' but process gone`).
- Durable install for login autostart:
  ```
  hermes gateway install --start-now --start-on-login
  ```
  This creates a Windows Scheduled Task `Hermes_Gateway`.
- **Before installing, stop the manual instance first** (`hermes gateway stop`) — otherwise two processes can fight over one bot token.
- Confirm connection from the **log**, not just PID: `tail logs/gateway.log` until you see `✓ telegram connected` and `set_my_commands OK`. `hermes gateway status` only proves a PID is up.

## Verify externally, never through redacted output

Hermes redacts secrets in tool output (`8763281594:***`). You cannot read a token and paste it — the value is gone from your view.
- Move credentials source→`$HERMES_HOME/.env` **programmatically in one `execute_code` step**; never print the value. Print only key counts and a `sha1(...)hexdigest()[:16]` fingerprint.
- Prove the outside world agrees: read the token back in-process from `.env`, then call the provider API and assert the identity matches the old install (Telegram: `GET https://api.telegram.org/bot<token>/getMe` → `ok:true` + same bot id/username).
- `.env` token edits only take effect at **gateway restart** — write, restart, then check the log. See `references/migrate-and-verify.md` for the full OpenClaw→Hermes migration.

## Diagnosing "a second gateway" / the process tree

- Before killing anything, identify the **real** gateway by command line and PID, not by port or by matching 'gateway' in a process listing.
- The live **desktop app** runs a `hermes serve` tree (parent PID of your own session → child `-m hermes_cli.main serve`), and its worker children can look like a gateway chain. Those are your session's own processes — **never kill anything sitting under the desktop server PID** (walk `ProcessId`→`ParentProcessId`).
- The installed gateway is the one whose command line is `-m hermes_cli.main gateway run` and whose PID matches `hermes gateway status`. Its child is the `hermes-runtime` python. That pair, and only that, owns the bot token.

## Installing a gateway plugin on Windows (no sudo, no systemd)

Plugin bundles often ship a Linux-first `install.sh` (`sudo`, `systemctl`,
`/home/<user>/.hermes`). On Windows the same install is a manual three-step
copy, and the script's other jobs must be reviewed rather than run blind.

- **Copy the plugin folder into `%LOCALAPPDATA%\hermes\plugins\<plugin-id>\`**:
  the manifest stays `plugin.yaml`, the Python module becomes `__init__.py`.
  A plugin with `hooks:` in its manifest needs no code edits to register.
- **Enable it in `config.yaml`**: `plugins.enabled` must list the plugin id.
  Keep `plugins.entries.<id>.allow_tool_override: false` unless the owner asks
  for tool overriding.
- **Validate with the real runtime**, not by reading the manifest:
  `hermes plugins doctor <folder>` → `OK: runtime discovery, manifest
  parsing, import, and registration passed` and the expected hook count. A
  plugin that imports but registers zero hooks is installed and inert.
- **Edits to a plugin's code need a gateway restart** to take effect; the
  manifest alone is read at start-up.

**The Windows `hermes` binary is not on PATH — call it by its full path.**
`%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe` (and
`...\Scripts\python.exe` for its own scripts) is the working invocation; a
bare `hermes` in a bash tool call is «command not found» and the plugin then
looks uninstalled. Note the exe name is `hermes.exe`, so the shell form is
`C:/Users/<user>/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe`
with forward slashes — MSYS path conversion is off for native binaries.

**A plugin bundle that ships `install.sh` may be unusable as-is, but its
bundled `configure.py` is the readable spec of what it wants changed.**
Read that script first and apply its edits by hand: it names every key it
touches, and its defaults are the thing to check against the owner's actual
request. The `token-usage-footer` bundle, for example, folds in
`gateway.allow_all_users: true` — every sender on every platform gains
access to the bot — as a side effect of installing a usage footer. Apply the
footer, leave access control as it was, and say in the report which line you
deliberately did not apply.

**Read what the installer's config step does before running it.** Bundled
installers often fold in changes the owner did not ask for — opening
`gateway.allow_all_users` (every sender on every platform gains access) or
disabling the native runtime footer. Apply the requested part, leave access
control as it was, and say in the report which line you deliberately did not
apply. Access widening is a decision for the owner, not a side effect of a
plugin.

**On Windows, do the config edit yourself rather than running the bundled
`configure.py`.** That script expects a POSIX `$HERMES_HOME` layout and
rewrites the whole YAML through `yaml.safe_dump`, which drops comments and
reorders keys. Patch the three keys in place with a targeted edit, and keep
a `.bak` of `config.yaml` next to it.

**The plugin takes effect only after a gateway restart** — the manifest and
the hooks are read at start-up. Enabling it in `config.yaml` while the
gateway keeps running produces exactly the same symptom as not installing it
at all, and the owner's report will be «the plugin is installed but nothing
appears». Say plainly that a restart is pending instead of implying the
plugin is live.

**Installing a plugin is not the same as trusting its payload.** Read the
plugin's own code before enabling it: a per-turn accounting hook that renders
a line into every reply changes every message the owner reads, and one that
appends a JSONL sidecar writes data to disk on every turn. Both are the
owner's explicit ask here, but the review is what makes the difference
between installing what was requested and installing what the bundle also
did.

## Per-turn token accounting as a plugin hook

The `token-usage-footer` pattern: `post_api_request` accumulates each provider
call's usage into a per-turn bucket (uncached input / output / cache read /
cache write / reasoning / call count / wall time), and `transform_llm_output`
renders one compact line appended to the finished reply. Two properties make
it safe: the line is appended AFTER the model loop (the model never sees it,
so prompt caching is untouched), and it lands only on messaging surfaces —
CLI, TUI and delegated subagents are skipped. The same plugin can append a
JSONL sidecar for a database.

Pitfalls:
- the accounting line must be **derived from the provider's own usage
  buckets**, never re-estimated from the prompt text;
- free-tier models have no published rate for every bucket — print the cost
  as empty rather than inventing a number;
- a plugin that is installed but not enabled in `config.yaml` (or enabled
  without a restart) produces nothing and looks installed.

## Self-recovery watchdog for the "stop fires, start never does" restart

A requested restart can drain and stop the gateway cleanly but never spawn the
replacement: the log shows `Restart requested ... Stopping gateway for restart...`
and then silence, `hermes gateway status` reports `No gateway process detected`.
Observed triggers: config.yaml edits (model/provider switches) some 15+ minutes
earlier. Until the restart path is fixed in code, guarantee recovery with a
watchdog instead of manually restarting after every incident.

- `scripts/watchdog-gateway.py` (in this skill) reads `gateway_state.json`,
  checks the PID with tasklist, and runs `hermes gateway start` when down.
- Register it as a Scheduled Task — **via PowerShell, not `schtasks` from
  git-bash**: the MSYS `//Create` flag form is rejected («Invalid argument»)
  and `/Create` gets path-mangled. The working registration:
  ```powershell
  $action  = New-ScheduledTaskAction -Execute '<venv python.exe>' -Argument '<path to watchdog-gateway.py>'
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'Hermes_Gateway_Watchdog' -Action $action -Trigger $trigger -RunLevel Highest -Force
  ```
- Verify BOTH branches before trusting it: with the gateway up the script must
  print `gateway OK pid=<n>`, and after a manual `hermes gateway stop` it must
  print `gateway DOWN ... -> starting` and bring the process back (check
  `✓ telegram connected` in the log). A watchdog only ever tested in the OK
  branch is unproven.
- The script's `alive()` must decode tasklist output as bytes with
  `cp866` + `errors='ignore'` — a plain `text=True` read crashes with
  `UnicodeDecodeError` on a RU-locale box the moment tasklist prints anything
  non-ASCII.

With the watchdog live, the operational answer to «the bot went silent again»
shifts: the gateway self-heals within the task interval, so diagnose the
*recurring stop trigger* (who issues the restarts) instead of babysitting
restarts.

## Read watch-pattern notifications as context, not as failures

Background notifications from a `gateway run` process surface **other** gateway-adjacent sessions' log lines: `agent.message_sanitization: Unrepairable tool_call arguments... replaced with empty object`, `finish_reason='length'`, tool `Traceback`s, and the bot's own inbound turns. They are informational — your session id (in brackets, e.g. `20260915_211944_cfeabe`) differs from the session they belong to. Don't treat another session's sanitization/truncation/traceback as a failure of your turn or of the gateway.

## Two config lifetimes: process start vs per trigger

Not every setting needs a restart, and restarting for the wrong one is wasted work.

- **Read at gateway start** — `telegram.allowed_chats`,
  `platforms.telegram.allowed_chats`, `TELEGRAM_HOME_CHANNEL`, the `model`
  block, platform credentials. Editing these needs `hermes gateway restart`.
- **Read per trigger** — a cron job's `deliver` target is taken from the job
  config when the job fires. Changing `deliver` in the job definition is live
  immediately; **no gateway restart**.

Proof for the first group: compare the gateway's start time with the config
file's mtime. A process started before the config was written has not read it.

```
python -c "import psutil,datetime;print(datetime.datetime.fromtimestamp(psutil.Process(<pid>).create_time()))"
```

Proof for the second group: run the job once and read the delivery outcome.

## Read the delivery outcome, not just the job config

`%LOCALAPPDATA%/hermes/cron/executions.db` (SQLite) holds one row per fire:
`job_id`, `status`, `delivery_outcome`, `started_at`, `finished_at`.
`delivered` = the message went out; `suppressed` = the job ran and correctly
sent nothing. `completed` + `suppressed` is a healthy no-op, `failed` is a
real fault. A job whose rows are all `suppressed` is not delivering, whatever
its `deliver` field says.

```
python -c "import sqlite3;c=sqlite3.connect(r'C:/Users/Administrator/AppData/Local/hermes/cron/executions.db');cur=c.execute('select job_id,status,delivery_outcome,started_at from executions order by rowid desc limit 10');[print(r) for r in cur]"
```

## Creating a cron job through the deferred tool — the argument shape is strict

A scheduled job is the right answer to a brief that says «wait N hours, then
publish»: it keeps the contour free instead of blocking a cycle on a timer.
The `cronjob_manage` tool is reached through `tool_call`, and its shape
fails in confusing ways:

- `calls[].name` is the **tool name as a plain string** (`"cronjob_manage"`).
  It is NOT a list, and it is NOT the job's name. Putting the job's title
  there yields «'...' is not a deferrable tool».
- The job's human-readable name belongs in `arguments.name`.
- The `schedule` duration grammar accepts `in 30m` / `in 2h` — a compound
  like `in 2h20m` is rejected («Invalid duration ... after 'in '»). Round the
  wait to the nearest whole unit the grammar supports.
- `arguments` requires `action`, `schedule` and `prompt`; `deliver` and
  `repeat` are optional (`repeat: 1` makes it a one-shot).

**When a `tool_call` fails, do not re-issue it with the same arguments.** A
failed call is information: read the error, fix the shape it names, and
change the call. Repeating an identical call is guaranteed to fail again
and burns the turn's tool budget.

## Long batch work belongs in a background terminal, not in `execute_code`

`execute_code` has a hard cell timeout (~300 s). A batch that outlives it
does not just fail — the **kernel is killed and its state is lost**, so
every variable, every cached read and every partial result computed in that
cell is gone, and the next call starts from zero.

Split work so each cell finishes well inside the budget, and put anything
that genuinely takes longer into a background process:

```
terminal(command="cd <dir> && python <script> > logs-<name>.log 2>&1", background=True, notify=True)
```

The script writes its own artifact per item (one file per order) and the log
is read back afterwards — a batch that is resumed by re-reading artifacts
survives the timeout, one that keeps state only in memory does not. Reading
the results back out of per-item files is also what makes the batch
verifiable against the count that was asked for.

## Windows console output is CP866, not UTF-8

`tasklist` and other console tools emit CP866; piping them into grep makes
grep treat the stream as binary and print "Binary file (standard input)
matches" with no usable lines. Convert first:

```
tasklist | iconv -f CP866 -t UTF-8 | grep -i chrome
```

## Configuring the active model / provider for the Telegram gateway

The `model` section in config.yaml is global, but the Telegram adapter only reads it on gateway startup.

1. Set the desired model — **one key per invocation**: `hermes config set` accepts a single key and a space-separated multi-key line errors with `hermes: error: unrecognized arguments`. Example for grok-build-0.1 via xAI (Responses API):
   ```
   hermes config set model.default grok-build-0.1
   hermes config set model.provider xai
   hermes config set model.base_url https://api.x.ai/v1
   hermes config set model.api_mode codex_responses
   ```
2. Restart the gateway cleanly:
   - `hermes gateway stop`
   - `hermes gateway start` (or `hermes gateway install --force --start-now` if the Scheduled Task needs refresh)
3. Confirm in the new log tail: client creation line names the exact model/provider, followed by `✓ telegram connected` and `set_my_commands OK`.
4. Externally verify the bot still answers on the same identity (getMe via in-process read of .env token).

Pitfall: config changes do not hot-reload into a running gateway process. The bot will keep using the previous model until the process is replaced — always restart and check the log after any model or provider edit.

Pitfall: `model.api_mode` does not auto-reset when you switch providers — the previous provider's value stays and forces the wrong transport, silently breaking LLM calls (e.g. moving xai→openrouter with a leftover `codex_responses` while openrouter's pool default is `chat_completions`). After any provider change, reset it to the provider's default with `hermes config set model.api_mode ""` and only set it explicitly (e.g. `codex_responses` for xai) when that provider genuinely needs a non-default transport.

## Inspecting Grok / model token usage for the current gateway session

- High-level aggregate: `hermes insights` (input/output by model, by platform, estimated cost, top sessions).
- Precise for the live Telegram session:
  - Locate the internal session_id (bracketed in agent.log lines for the TG DM, or the routing key "agent:main:telegram:dm:<userid>").
  - Grep agent.log for lines containing that session_id AND "API call #N:".
  - Sum the `in=`, `out=`, and `total=` values across all matching calls for that session.
  - High `cache=...` percentages in the same lines mean most prompt tokens were cache hits.
- sessions.json records last_prompt_tokens (current context size) and routing metadata but the billed usage lives in the per-call log lines.

Pitfall: the input/output fields on the routing entry in sessions.json are frequently zero or stale. Always sum from the bracketed session's API call telemetry in agent.log for accurate consumption numbers.

## Group chat "bot is silent" = authz by sender user_id, not the chat gate

When the bot answers in the DM but is mute in a group, the chat's `allowed_chats` entry is usually NOT the blocker (the group can be in the allowlist and still be dropped). The gateway authorizes group messages by the **sender's user_id** against `TELEGRAM_ALLOWED_USERS` (which lists only the owner's user id), long before any "inbound message" log line. Non-listed members are blocked at the authz layer.

- Diagnostic signature (search `logs/gateway.log` / `errors.log`): `[Telegram] Blocked unauthorized user <userid> in chat -<groupid>`. This proves the messages ARE arriving from Telegram; they are being dropped at authorization, not lost in transport. The absence of any "inbound message" line for that group is consistent with this.
- Find the sender's identity with the Bot API: `getChatMember` on `-<groupid>` / the blocked user id, and `getChatAdministrators` to see who's actually in the group.
- Fix (".env", then `hermes gateway restart`):
  ```
  TELEGRAM_GROUP_ALLOWED_CHATS=-<chat_id>          # chat-scoped grant, checked BEFORE user_id → lets any member of this group through
  TELEGRAM_GROUP_ALLOWED_USERS=<userid1>,<userid2>  # explicit per-user fallback
  ```
- `TELEGRAM_GROUP_ALLOWED_CHATS` is a separate env from `allowed_chats`; shared-key mapping lives in `gateway/config_loader.py` `_SHARED_KEYS` (allowed_chats / group_allowed_chats). Prefer the chat-scoped grant when the owner says "everyone in the group is allowed" (e.g. all admins).

## Custom long-poll bots beside native gateways

A hand-rolled Python long-poll loop (portal thread, worker script) competing with a native Hermes gateway is a recurring failure shape. The owner's standing preference: **do not attach custom scripts to a chat — bind the executor bot directly to a native Hermes profile gateway.** The executor group is a plain Hermes conversation; keep menus, order lists, preset controls, and other custom command handling in the separate order-management bot/group. Custom loops are a diagnostic tool at most.

## Switching one Telegram gateway between prepared Hermes profiles

Use this when the same executor bot and group must run one of several prepared agents, each with isolated context, memory, skills, and session storage. A Telegram bot token has only one active `getUpdates` poller: switching profiles is sequential, not running two gateways against the same token.

1. Inventory prepared profiles first: `hermes profile list` and `hermes profile show <name>`. Exclude `default` or other system profiles from user-selectable targets unless explicitly intended; verify each target has its own context, memories, skills, model credentials, and session store. A profile switch does not migrate chat history.
2. Keep the control plane separate from the executor. In the two-bot order workflow, expose `/profiles`, `/profile <name>`, and the profile selector in the order-management bot/group; `/use` selects an order preset, not a Hermes profile. Leave the executor group as a direct native Hermes conversation, with no custom polling/menu worker attached.
3. Provision the target profile's own Telegram settings from the known-working profile: token, `TELEGRAM_HOME_CHANNEL`, `TELEGRAM_ALLOWED_USERS`, `TELEGRAM_ALLOWED_CHATS`, and group allowlists. Transfer secrets programmatically and never print them. For `telegram.allowed_chats`, pass valid JSON inside shell single quotes, e.g. `hermes -p <target> config set telegram.allowed_chats '["<owner_id>","<chat_id>"]'`. The key is string-typed; Python-style single-quoted list syntax can be stored as malformed text and silently reject every group message. Make the target's chat allowlist explicit in its own `.env` as well, so a process-level value from another profile cannot silently override it.
4. On Windows, ensure the target has a registered `Hermes_Gateway_<target>` Scheduled Task (`hermes -p <target> gateway install --no-start-now --start-on-login` when missing). Then switch exclusively: stop the current profile with `hermes -p <current> gateway stop`, disable its task, enable the target task, and start it with `schtasks /Run /TN Hermes_Gateway_<target>`. Keep only the selected executor profile's task enabled; the default/order-bot gateway is a separate token and must not be stopped as part of this switch.
5. Confirm the target with `hermes -p <target> gateway status` and its `logs/gateway.log` (`✓ telegram connected`); only after it is live persist the active-profile marker. If target startup fails, disable it and restore the old task/profile before reporting failure. `getMe`, successful `sendMessage`, task `Ready`, or a live PID alone does not prove end-to-end inbound handling; finish with an owner reply/command in the group and confirm a session appears in the target profile's own state database.
6. The first message to a profile with no Telegram history creates a new profile-local session. Memory, skills, and future history remain isolated to that profile; never fake session creation with an echo worker or `--continue` against a nonexistent session.

Pitfalls:
- Never leave two profile gateways polling the same Telegram token; 409 conflicts can make the executor silent.
- A Scheduled Task marked `Ready` is not proof that its process is running; check the Hermes profile status, active PID, and gateway connection log.
- Do not place profile-switch commands in the executor group. Put the controls in the order bot/group while keeping the executor directly attached to the selected native Hermes profile.

- **Find who actually polls a token with netstat, not guesswork:** `netstat -ano | grep 149.154` → the ESTABLISHED connection's PID → `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` → CommandLine. This names the real consumer of a bot token when updates mysteriously vanish.
- **A 409-conflict loop in the bot's own log means two pollers share one token.** Kill duplicates until exactly one poller per token; a duplicated portal process (task autostart + manual `/Run`) is a common source.
- **Never switch per-thread config by mutating a module global from inside a thread.** Thread A sets `_Роль='exec'`, thread B's next `_конфиг()` read picks it up and both threads poll one token. Select by `threading.current_thread().name` in the getter instead.
- **«Bot reads but never answers» = an exception swallowed between getUpdates and sendMessage.** Add a one-line inbound log file (`chat=… text=…`) right after consuming each update — it proves delivery and isolates the broken stage. Then replay the exact reply path in a foreground one-shot with the same thread identity; the real error surfaces (e.g. `pymysql.connect(**DB, cursorclass=…)` where the DB dict already contains cursorclass = duplicate-kwarg TypeError).
- **A command bot that only reacts to `/`-messages is silent on plain text by design.** If the chat is meant as a conversational gateway, plain-text handling is required code, not a delivery bug — check what the handler does with non-`/` text before blaming transport.
- **A second bot as a native gateway needs `--create-if-missing` semantics for sessions, and `hermes -z <msg> --continue <session>` errors out with «No session found» on the first turn** — one-shot reply loops must create the session explicitly or seed it.

## Diagnosing a silent Telegram group gateway

Separate transport, authorization, agent execution, and reply delivery; a live PID or `Connected to Telegram` log proves only that the adapter started. Do not infer that Telegram withheld an update from an empty session list or quiet log until a known test message has been sent after the gateway is live.

1. Confirm the exact target group ID and active profile. Check `hermes gateway list`, `hermes -p <profile> gateway status`, that profile's `logs/gateway.log` and `state.db`, `getMe`, `getChat`, and `getChatMember`. Check that only one live gateway polls the bot token; `getMe` verifies identity, not inbound delivery.
2. Compare the selected profile's Telegram `.env` and config with the previously working profile: token, `TELEGRAM_HOME_CHANNEL`, `TELEGRAM_ALLOWED_USERS`, group allowlists, and `telegram.allowed_chats`. `TELEGRAM_ALLOWED_CHATS` from the profile environment overrides YAML, so a default-profile value can silently whitelist the wrong group. `telegram.allowed_chats` is string-typed; pass a valid JSON array to `hermes config set` (e.g. `'["<owner_id>","<chat_id>"]'`), not Python-list syntax. Inspect the effective adapter allowlist and run `_should_process_message()` with the exact group/user IDs; `config get` output or a connected poller alone does not prove inbound authorization. Restart after start-time changes; do not assume profile values are inherited.
3. Make one discriminating ingress probe: have the owner reply to a message sent by the bot with plain `ping`, or send `/whoami@<bot_username>`. A reply is visible even when Telegram group privacy is enabled; a slash command is also delivered. Then inspect the selected profile's session database/logs for that exact test turn.
4. If the reply/command creates a session but unaddressed plain text does not, check Telegram BotFather Group Privacy and `telegram.require_mention`; mention/reply gating is then the likely cause. Telegram's Bot API does not expose the privacy flag. The official Telegram guide says privacy-mode changes require removing and re-adding the bot; bot admins can receive all group messages.
5. If the known reply/command creates no session, inspect the active adapter's logs for authorization drops, Telegram 409 conflicts, stale/duplicate pollers, and profile allowlists. If an inbound session exists but no answer is sent, inspect the corresponding agent/error logs and provider response, then test outbound delivery separately.

Pitfalls:
- An empty `state.db` or absence of `inbound` log lines proves only that no session was recorded; it does not prove the owner sent a message to this group or that Telegram withheld it.
- Outbound `hermes send`, bot membership/admin status, webhook status, and healthy polling are separate checks; none alone proves end-to-end conversation.
- Do not call `getUpdates` manually while the gateway is polling; a second poller can cause a 409 conflict or consume updates. Use the gateway's own logs/session state for inbound verification.
- Do not stop a healthy gateway for a speculative BotFather privacy test. First use an owner reply to the bot's message or a bot-addressed command; change privacy only when that probe isolates the restriction.
- If the bot is not already an admin and privacy is enabled, use BotFather `/setprivacy` → Disable, then remove and re-add the bot; verify membership and repeat the same ingress probe before declaring recovery.
- Keep the executor group attached directly to a native Hermes profile gateway. Do not add a custom poller/echo handler to diagnose silence; keep menus and order controls in the separate order-management bot/group.

## Reading gateway liveness cheaply from portal code

Do not spawn `hermes -p <profile> gateway status` once per profile just to find which gateway is running: 20+ profiles take minutes and time out. Read each `gateway_state.json` (`<home>/gateway_state.json` for default, `<home>/profiles/<name>/gateway_state.json` otherwise), require `gateway_state == "running"` plus a live PID, and get all PIDs with one `tasklist /FO CSV /NH` (decode cp866, strip quotes). Keep a runner-based fallback in code paths whose tests inject a fake runner and assert on status calls.

`default` is not in `profiles()` (the catalog deliberately excludes the system profile) — include it explicitly in the running-detection candidate list, or `active_profile()` will report a switchable profile as the only running one. `active_profile()` must prefer the actually running gateway: when exactly one profile is live, return it and rewrite the stale `gateway_active_profile.json`; trust the file only when no gateway is running or when it names one of several live profiles.

## Duplicate gateway process = silent bot; verify there is exactly one

A `hermes gateway stop` that ends with `Failed to kill PID <n>: ... could not be terminated` can leave a live second gateway chain beside the fresh one. Two processes polling one bot token fight over getUpdates (409 conflict) and the bot becomes unreliable/silent.

- After any restart, list ALL `gateway run` chains, not just the status PID:
  ```
  Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match 'gateway run'} | Select ProcessId,ParentProcessId,CreationDate,CommandLine
  ```
- The authoritative instance is the one in `gateway_state.json` (its `pid` / `platforms.telegram.writer_pid` + `writer_start_time`). Any other `gateway run` chain is a duplicate — kill its whole chain by walking ParentProcessId, and re-check so you end with exactly one.
- The duplicate may also die on its own shortly after (its parent was the half-killed shim); before killing, re-poll once — but do not report "restarted cleanly" until exactly one `gateway run` process remains.

## Multiplex gateway for per-topic presets

When one group must route different topics to different profiles, run ONE multiplex gateway for that group and leave the other group's gateway as an ordinary single-profile instance. `gateway.multiplex_profiles: true` belongs in the config of the profile that owns the switchable group's bot; do not enable it on the normal working gateway.

- Configure `gateway.profile_routes` as `platform: telegram`, `chat_id: "<group>"`, `thread_id: "<topic>"`, `profile: <target>`; omit `thread_id` for the catch-all route. Verify with the real parser: `parse_profile_routes()` + `match_profile_route()` for each topic, including an unmapped one.
- Only one gateway may act as multiplexer. Starting a per-profile gateway while a multiplex gateway claims that profile is refused with "The default gateway is running as a profile multiplexer and already serves profile '<name>'".
- A multiplex gateway tries to connect every profile's Telegram. A credential owned by the other gateway shows up as a `fatal` platform (`<profile>:telegram`, "credential is held by another gateway — parked, not retried"); this is harmless and expected. Do not stop the other gateway to clear it.
- **One token, one owning profile.** Duplicate `TELEGRAM_BOT_TOKEN` across profiles makes multiplex fail at startup with "Profile X and Y both configure telegram with the same credential — refusing to start the duplicate" and leaves the gateway stuck `starting`. Inventory every profile's `.env` by token-id/fingerprint (never print secrets) and disable duplicates before starting; keep exactly one owner per token.
- The catch-all route's target must be a clean profile: verify its skills tree contains none of the preset skills (pdf, short-video, grok-image) — quarantine offending directories rather than deleting them.
- Full implementation recipe (route shape, atomic config rewrite, restart-and-poll, test adaptation): `references/multiplex-profile-switching.md`.
- Watchdog for a two-gateway setup must check both state files and start each with its own `-p` argument; if profile switching depends on a single multiplex gateway, keep any separate profile watchdog task disabled so it cannot resurrect a stale profile and break isolation.
- **Switch a topic preset by rewriting the catch-all route and restarting only the multiplex gateway.** In `profile_switch.switch()`, when `gateway.multiplex_profiles` is true: set the `profile` of the route named `default-chat` (no `thread_id`) in the multiplex profile's `config.yaml`, write with `yaml.safe_dump` through a `.tmp` + `os.replace`, then `hermes -p <mux> gateway stop` / `gateway start --force`. Never stop the ordinary working gateway as part of this switch. Use `hermes config set telegram.require_mention false` etc. only where needed — the route is the selector.
- Derive the multiplex config path from the manager's `profile_root` (`profile_root / <mux-profile> / config.yaml`), not a module-level absolute path — otherwise unit tests with a temp profile root silently edit the live production config.
- `gateway start` returns **before** the process is ready (observed ~40 s for a multiplex restart): poll `<home>/profiles/<mux>/gateway_state.json` for `gateway_state == "running"` before returning success. Asserting on the start command's exit code alone reports success on a gateway that is still `starting`.
- **A fresh gateway `gateway_state.json` `updated_at` is stamped at startup, not refreshed every tick in every build** — do not treat an old `updated_at` as proof of a frozen process. Check the PID with `tasklist` and the platform states; inspect the log's last activity before declaring a hang.

## Diagnosing a silent group gateway: check privacy with getMe FIRST

`getMe` reports `can_read_all_group_messages`: `true` means privacy mode is **off**, so privacy cannot be the cause of missed group messages. Do not keep sending the owner to BotFather `/setprivacy` when this flag is true.

- If `can_read_all_group_messages` is false, privacy/mention gating is plausible: `hermes config get telegram.require_mention`, then BotFather `/setprivacy` → Disable and re-add the bot (Telegram requires re-add for the flag to apply).
- If it is true, look at the gateway process instead: duplicate credentials, a stale token in another profile's `.env`, a multiplex enabled in the wrong config, or a second poller holding the token. Read `gateway_state.json` platform `error_message` values — `fatal` with "token already in use by the '<profile>' profile gateway" names the actual owner.
- A reply-only ingress probe (reply to the bot's own message) proves transport regardless of privacy; do not infer privacy from a plain-text message that never produced a session.

## Running a second gateway as a separate profile

A second bot (new token, new group) needs its own gateway instance — two gateways on one token fight over getUpdates.

**If a multiplex gateway is already running, do NOT place the new bot's profile under `profiles/`.** A multiplexer hot-reconciles every live profile directory (`profiles_to_serve`) and adopts any new profile that has a bot token — it starts polling that token within ~30 s, so starting the intended standalone gateway then fails with "token already in use by the '<mux>' profile gateway". Host the independent bot in its own `HERMES_HOME` OUTSIDE `profiles/` (e.g. `%LOCALAPPDATA%\hermes-standalone-<name>`) and start it with that home. Full recipe: `references/multiplex-profile-switching.md` → "Adding an independent bot beside a running multiplexer".
- Create the profile: `hermes profile create <name> --clone` — copies config/.env/SOUL/skills, **deliberately does NOT clone messaging channels** (a copied token would make the two gateways fight). Do not pass `--clone-channels`.
- Configure the profile in isolation: strip old Telegram keys from `profiles/<name>/.env` and write the new `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USERS` + `TELEGRAM_HOME_CHANNEL=telegram:<new-group>` + `TELEGRAM_GROUP_ALLOWED_CHATS` / `TELEGRAM_GROUP_ALLOWED_USERS`; in `profiles/<name>/config.yaml` add the `telegram.allowed_chats` list (top-level) with the new group id — the channel config section is NOT cloned at all, so there is usually nothing to replace, only to add. Verify the token first with `getMe` and the bot's group membership with `getChatMember(chat_id, user_id=bot_id)` → `administrator`.
- Start it: `hermes gateway start -p <name> --force` (`--force` = separate gateway for this profile even while the default runs). Logs: `profiles/<name>/logs/gateway.log`; profile state is isolated from the default gateway's `gateway_state.json`.
- A brand-new profile HOME has no installed gateway service: `hermes gateway start` then blocks on interactive "Install it now? / Start now?" prompts. Pre-install non-interactively with `hermes -p <name> gateway install --no-start-now --start-on-login` (or `hermes gateway install ...` with that HOME exported) before the first start.
- A fully clean profile (`hermes profile create <name> --no-alias --no-skills`) has no API keys: copy only the needed provider key (e.g. `OPENROUTER_API_KEY`) programmatically from the default `.env`, set `model.default` / `model.provider` / `model.base_url` / `model.api_mode` one key per invocation, then verify with `config get model`.
- Confirm `✓ telegram connected` in the PROFILE log and that the default gateway status still shows running.

## Low-RAM Windows diagnosis when the gateway dies uncleanly

On 4 GB VMs the single gateway python process (plus any embedded background agent) easily exhausts physical memory.

- Quick RAM check:
  ```powershell
  $os=Get-CimInstance Win32_OperatingSystem; 'TotalGB: {0:N1} FreeGB: {1:N1}' -f ($os.TotalVisibleMemorySize/1MB), ($os.FreePhysicalMemory/1MB)
  ```
- Top consumers: `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 Name, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB)}}`
- Gateway exit without Windows Application Error event + exit-diag.log containing "SIGKILL / OOM / VM death" or "no exit path ran" = memory pressure.
- The background JobLock-style agent and the messaging gateway share the same process tree; a long autonomous run can evict the bot.

Pitfall: treat repeated unclean exits on a low-RAM box as a resource problem first, not a code bug. Increase VM RAM or constrain background concurrency before chasing phantom restarts.

## Bringing up the Hermes web dashboard on this box

`hermes dashboard` serves the JSON-RPC admin plus a Web UI; it is a normal management surface on the same machine as the gateway. Operational pitfalls:

- **Bind `127.0.0.1`, never `0.0.0.0`.** `--host 0.0.0.0` is refused at launch: "Refusing to bind dashboard to 0.0.0.0... but no auth providers are registered." There is no unauthenticated public-dashboard mode — local loopback is the path.
- Run it from bash as a daemon: `hermes dashboard --no-open --skip-build --host 127.0.0.1` with `terminal(background=true)`. `--skip-build` avoids an npm build on a machine without node tooling wired up.
- It exposes **two listeners**: the JSON-RPC/admin backend and the Web UI (commonly `:9119`). `hermes dashboard --status` lists the process; the Web UI root returns `200`.
- The UI rendering says **"Desktop boot failed: Desktop IPC bridge is unavailable"** and "Gateway: offline". This is cosmetic — the web frontend expects Electron's IPC bridge, which a headless dashboard does not have. It does NOT mean the backend is down. The real readiness check is the JSON-RPC endpoint: `curl http://127.0.0.1:9119/api/health` → `{"ok":true,"auth_required":false}`. Trust the health + a `200` on `/`, not the boot banner.

## Starting long-running Windows daemons (nginx, php-cgi, uvicorn, workers)

Generalizable to any always-on local service you bring up from bash on this box:
- Native Windows binaries need **native Windows paths**, never MSYS `/c/...` paths — the tool's own arg translation is disabled here. `nginx.exe -p /c/nginx/ -c conf/nginx.conf` fails with `CreateFile() "/c/nginx/conf/nginx.conf" failed`; use `C:/nginx/...` instead.
- A foreground daemon that owns the terminal never returns, so run it with `terminal(command=..., background=true)`. Do NOT wrap it in `(cmd &)` / `disown` / `setsid` or pipe it through `head` — a `(cmd &) | head` blocks forever on stdout EOF that a daemon never emits, and the Hermes terminal tool rejects nohup/disown wrappers outright.
- Start order matters for a dependency chain: bring up the reverse proxy and CGI first (nginx → php-cgi), then the app server, then the worker that depends on both.
- Verify each tier with a separate readiness pass after starting: check the listen port (`netstat -ano | grep LISTENING | grep :PORT` shows the exact owning PID) and curl the real endpoint per tier (root returning a `401` from basic-auth is healthy, not an error; an auth-free internal/API route must return `200`).

## Distinguishing the real gateway in the Windows process tree

- The desktop app owns a serve tree (Hermes.exe parent → hermes serve children). Its workers can superficially resemble gateway chains — never kill anything under the desktop parent.
- The true gateway pair has command line containing "gateway run" (or "hermes_cli.main gateway run") and its PID matches the one reported by `hermes gateway status`.
- Use:
  ```powershell
  Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match 'gateway run'} | Select ProcessId,ParentProcessId,CommandLine
  ```
- For the Scheduled Task: `schtasks /query /tn "Hermes_Gateway" /fo LIST /v` (ignore Last Run Result codes when a fresh PID is alive).

Pitfall: matching only on the word "gateway" or on PID alone will hit desktop serve workers. Always walk ParentProcessId and match the exact command line of the installed service.
