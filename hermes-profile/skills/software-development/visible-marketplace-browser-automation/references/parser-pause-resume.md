# Pausing and resuming the JobLock parser stack

Needed when the visible Chrome on `9222` must be free for manual UI work, and the parser must actually stay stopped.

Killing `bun parser.ts` is a **restart**, not a pause. Two independent supervisors put it back, and a process-level pause flag does not survive either of them. Verified order:

## Pause

1. **Disable the scheduled tasks first** — this is the layer that outlives everything else. On this box two exist and both run the same `launch_parser.bat`: `\jb_parser` and `\joblock-parser`:
   ```bash
   schtasks /change /tn "jb_parser" /disable
   schtasks /change /tn "joblock-parser" /disable
   schtasks /query /tn "jb_parser" /fo LIST | grep -i status   # expect Disabled
   ```
   The duplicate is why two `parser.ts` processes can run simultaneously. When resuming, enable **one** task, not both.
2. **Inspect the process tree before stopping a child.** Stop a keeper before its Bun workers; also stop `hold.ts`/`watch-orders.ts` only if they are active. Some search connectors are Bun children of the portal's `app.py` cycle thread, not standalone parser tasks; killing only Bun lets the next tick recreate it. Use command lines and parent PIDs to identify the actual owner.
3. **Do not trust `schtasks /End` as proof the tree stopped.** A scheduled-task wrapper can exit while its Python app and Bun descendants remain. Re-check the process tree; if the owning portal task must be stopped, terminate only its verified surviving app process tree (`taskkill /PID <app.py-pid> /T /F`), never all Chrome. Expect `:8701` to be down during that maintenance pause, while the user's visible Chrome/CDP `:9222` must remain up.
4. **Re-verify after a delay, not immediately.** Confirm no parser/app descendant or scheduled task has restarted, and verify the intended endpoints separately. After resuming the portal task, read back `:8701` and confirm the new cycle event; a task state or process exit alone is not proof.

## Resume

1. Read the intended `PARSER_SINK` from the protected environment without printing tokens. Check for `parser.pause`, an existing parser/keeper process, and the visible Chrome CDP endpoint at `http://127.0.0.1:9222/json/version` before starting.
2. Inspect each scheduled-task action before enabling it. A legacy task may hard-code a different sink from the current `.env`; never re-enable it just because its name contains `parser`, and never enable both tasks.
3. For a one-off Fabra intake run, launch exactly one `bun parser.ts` from `C:/Users/Administrator/browser-automation` with `PARSER_SINK=fabra`; Bun loads the local `.env` token. If it must run detached, use `Start-Process` with a working directory and separate private stdout/stderr logs. Do not start the omnibus keeper merely to resume intake, because it may also start monitors or workers.
4. Verify one parser process, a successful Fabra connection message, active exchange tabs on the visible Chrome, and read-back of each confirmed `source + external_id` with status `new`. A running PID or a log line alone is not proof of intake.
5. Keep per-run logs private: parser stdout includes marketplace titles and descriptions. Report aggregate counts and errors, not raw log lines.

After resuming, keep unrelated monitor/worker tasks in their prior state unless the user explicitly asks to resume them.

## "Pausing the parser" usually means the browser, not the parser

Reported as a dead parser, this is frequently a browser that lost its debug port. The parser's log says `Порт 9222 молчит — окно не открыто`, and the cause is that Chrome was relaunched **by hand** without `--remote-debugging-port`. Thirteen `chrome.exe` processes and a healthy-looking window are consistent with a completely unusable automation port.

```bash
curl -s -m 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:9222/json/version
```

- **Diagnose the port before editing parser code.** Every symptom of "parser broken" is identical whether the parser died or the browser did.
- **Launch the browser binary directly, not `bun serve.ts`.** `serve.ts` blocks on `waitForEnter`, so under a background/scheduler launch it gets closed stdin, exits at once, and closes the visible window with it — leaving exactly the state it was meant to prevent.
  ```bash
  "C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 \
    --user-data-dir=C:\chrome-profile --no-first-run --no-default-browser-check
  ```
- **Keep the user's window alive and use theirs.** When they open the browser themselves, confirm the port instead of spawning a second copy; two instances on one profile profile-lock and leave the second without CDP.
- A profile that already exists but shows no `--user-data-dir` in its command line is the wrong profile — the automation code expects its own persisted session directory.

## Telegram noise filtering in the parser

The status poller emits one Telegram line per changed project. Server-assigned stages arrive for every card in bulk, so keep an explicit noise list and suppress anything without an agent or recommendation attached:

```ts
const ШУМНЫЕ_СТАТУСЫ = ["new", "analyze", "deferred", "awaiting_customer", "received"];
const шум = ШУМНЫЕ_СТАТУСЫ.includes(newOrderStatus) && !информативно;
```

- **`awaiting_customer` is the one that floods.** It fires for every project the moment we bid, so omitting it buries the real news under 7-8 identical lines a minute.
- **Extend the list, never mute the channel.** `parser.ts` supports a `--тихо` flag that silences *everything*, including sales increases, moderation warnings and Fabra link loss. Widening the noise list is the surgical fix.
- **Expect the next flood from a sibling status.** Adding `received` next to `awaiting_customer` is the same class of message; fix the class while you are in there.

## Switching the collector to the LOCAL portal and starting from an empty base

When the target is the local portal (own project table in the local DB) rather than a remote platform, the sink must be switched BEFORE the process starts — a run started with the old sink writes the whole batch into a backend whose rows cannot be removed from the portal.

- Read the sink out of the protected env file and change it there; the process reads the file at startup.
- A "clean base" restart needs three things, not one: the destination rows cleared, the collector's dedupe set reset (per-feed `*.jsonl` — archive it, it is state, not a log), and the local feed filters that drop cards. A collector that filters by price/verdict/proposal count locally will look healthy and import nothing.
- Backing up and clearing in place beats a file dump: `CREATE TABLE bak_<t> LIKE <t>` + `INSERT ... SELECT` + `DELETE`, so the rollback is one statement. Clear the tables that reference each other in one pass.
- Proof of intake is a read-back of rows and their source, plus the count of names the owner asked to see. A live PID is not proof.

## Getting a fixture into the bid queue

A test card that exists in the sandbox and in `market_projects` can still never reach the bid endpoint, because the queue orders by `price DESC` and caps the result set. A cheap fixture lands in the tail and is invisible even with the maximum `limit`.

- **Confirm the card is in the queue by reading the endpoint, not by the ingest response.** Ingest returning `ok` only proves the row exists.
- **When a fixture is absent, run the queue's own `SELECT` by hand** with the same predicates (`status IN (...)`, `price >= floor`, `LOCATE('"verdict": "yes"', analysis_json)`, `NOT EXISTS` in `fabra_bids`) and see which predicate drops it. Each one is a plausible silent reject.
- **Raise the fixture's price to clear the top of the ordering** when it is a throwaway sandbox card, rather than widening the endpoint or editing the filter for a test.
- Upload fixtures through the parser ingest endpoint with the real parser token, so `source+external_id` idempotency applies and a re-upload updates price instead of inserting a duplicate row.

## Pitfalls

- **Never close the visible Chrome (`9222`) to "pause the parser".** It is the user's own window and holds their marketplace logins; recovering costs a manual re-login per site. The parser and the browser are separable — say that rather than killing a login session.
- **Stopping the keeper does not stop what it started.** php-cgi, nginx, the portal and the worker were launched earlier and keep running on their own. Check their ports instead of assuming they died with the supervisor.
- The real cost of a stopped keeper is the loss of its tab pruning in the visible Chrome, so tabs accumulate until closed by hand — report that instead of letting it be discovered later.
- A Hermes cron that only hits a sandbox HTTP endpoint does not start the parser, but read the script before assuming; anything that invokes `launch_parser.bat` re-enables the whole loop. When asked to remove one, list jobs first and delete by the returned `job_id` — never guess an ID, and note the action verb is `remove`, not `delete`.
- Report exactly what stayed running. A "parser paused" claim that omits the still-live web stack reads as a broader outage than intended.