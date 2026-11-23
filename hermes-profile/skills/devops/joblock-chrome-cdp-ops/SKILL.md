---
name: joblock-chrome-cdp-ops
description: Heal Chrome :9222/playwright CDP layer JobLock parsers use.
---

# Chrome CDP + playwright ops (JobLock browser-automation box)

Use when the feed parser (`parser.ts`, markets wz/kw/is) or chat monitors (`watch-chat.ts`) fail to attach, `feed-log.jsonl` stops growing, or the box pegs CPU with no obvious consumer. These all sit on ONE shared service: the visible Chrome window at `:9222` with `--user-data-dir=C:\chrome-profile` (cookies persist on disk — a restart does NOT lose logins). Changes to this layer explain most parser symptoms; check it BEFORE blaming keeper, DB, or the exchanges.

## Golden flow: parser not writing feed-log
0. **Check the stage mode FIRST** — `reviews/data/mode.json`. Outside "search" the parsers are stopped BY DESIGN (one-stage-owns-the-window); stale parser logs with mode=chat/execute/submit mean a mode switch, not a crash. Only diagnose feed death when mode is "search".
1. Is `feed-log.jsonl` mtime advancing? Stale mtime + NO `bun parser.ts` process = parser died → revive (below). Stale mtime + process alive has TWO distinct causes; check both before restarting anything: (a) dead/wedged CDP session — `/json/version` and `connectOverCDP` fail or hang; revive the window/driver; (b) **expired marketplace session** — CDP, portal and parser are all healthy but the site silently redirects the feed to `/account/login`. Test (b) by opening the feed URL in a fresh visible tab and reading `location.href`: a login redirect with a healthy browser is the root cause, not a parser bug. Check `browser_vault_list` for a saved login; with none saved, hand the login back to the owner in the visible Chrome and stop — never type credentials. After he authenticates, confirm recovery by a fresh `feed-log.jsonl` mtime and a growing project count, not by process presence.
2. Revive: `bun update playwright` (`bunx playwright install chromium` after any major bump — the bundled browser in `~/AppData/Local/ms-playwright/` must match the driver, else `launch: Executable doesn't exist`), then start parsers.
3. Verify: BOTH `parser-<market>.log` and `feed-log.jsonl` mtimes advance within ~60 s — a live parser writes the feed in one 30 s cycle. Stale parser log after launch = process died at startup.

## Chrome autoupdate breaks playwright CDP attach (two-part root cause)
Symptom: parser dies with `Порт 9222 молчит — окно не открыто` (browser.ts:225) even though `curl http://127.0.0.1:9222/json/version` answers. Root is DOUBLE: (a) system Chrome moved to a newer major (e.g. 156) that the installed playwright driver can't talk to; (b) the long-lived window keeps a wedged CDP session — a fresh driver STILL times out against the OLD window. Fix order matters:
1. `bun update playwright` (latest on npm) + `bunx playwright install chromium`.
2. **Restart the Chrome window itself** with the same user-data-dir: kill the tree (all `chrome.exe` whose CommandLine matches `chrome-profile`), relaunch `--remote-debugging-port=9222 --user-data-dir=C:\chrome-profile --start-maximized --no-first-run --no-default-browser-check about:blank`. Logins survive in the profile dir.
3. Probe `connectOverCDP` once before starting parsers.

### Raw WS probe (driver-vs-dead-browser discriminator)
Raw CDP answering in ~1 s while playwright `connectOverCDP` hangs 30 s after `<ws connected>` = driver/version or wedged session, NOT a dead Chrome. Probe with the `ws` package (not bundled in project):
```ts
import { WebSocket } from "ws";
const ver = await fetch("http://127.0.0.1:9222/json/version").then(r=>r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl, [], { handshakeTimeout: 8000 });
ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} })));
ws.on("message", (d) => { console.log(String(d).slice(0,120)); process.exit(0); });
```

## Refresh a live feed through its own AJAX — never reload the page

A feed snapshot that stops changing is NOT a reason to `page.reload()` it on a
timer. A reload makes the owner's tab flicker, drops the CDP session, and can
take down the window; it also re-runs every startup request. Every SPA feed has
a refresh control that fires its own XHR and swaps the DOM in place — drive
that instead.

Recipe (Workzilla feed, reusable for other exchanges):
1. Register `page.waitForResponse(r => r.url().includes('/list/open'))` BEFORE
   the action; read the captured body with `r.text()`.
2. Click the site's own refresh control from the DOM (`a` with text `Новые`),
   via `page.evaluate` dispatching a MouseEvent. Await the captured response.
3. Parse groups (`interesting`, `other`, …) as a flat list; fields are
   `id`, `subject`, `description`, `price`, `modified`, `files`. `modified` is
   milliseconds — convert with `new Date(ms).toISOString()` before logging.
4. Fall back to DOM scraping when the capture is empty; treat a short capture
   as a miss, never as an empty feed.
5. Verify: feed log mtime advances, card count > 0, and the tab URL is
   UNCHANGED (no navigation). Keep DOM parsing as a fallback, not the primary.

Pitfall: calling `fetch()` of that same endpoint from inside `page.evaluate`
returns only a tiny counter object, not the list — the payload is bound to the
SPA's own request context. Intercept the real XHR (`waitForResponse`); do not
parse a hand-made fetch and do not escalate to reload when it looks empty.

The same no-reload rule applies AFTER a submit click, and the cost is higher.
Clicking «Согласиться» (or any accept button) and then calling
`page.reload()` to read back the result destroys the tab's in-flight state:
the confirmation cannot be read, and a successfully submitted response is
recorded as `uncertain`. Read the confirmation from the ALREADY LOADED DOM
(or from the accept XHR captured by a response listener) and leave the tab
navigation untouched. If the browser died mid-flow, the result is genuinely
unknown — record that, never retry the click.
Concretely, `bid.ts` used to reload `targetPage` inside the accept callback to check `.description-content`; that reload is what turned accepted bids into `uncertain`. Read `body`/`.description-content` from the already-loaded page and capture the accept XHR with a response listener instead.

## Launching parsers after a restart
- `cmd //c "start-parsers.bat"` from git-bash is unreliable: cmd windows open but `bun parser.ts` may never become a live process, and the error is silently lost. Launch directly, one background process per market:
  `PARSER_MARKETS=wz C:/Users/Administrator/.bun/bin/bun.exe parser.ts >> parser-wz.log 2>&1`
- Start only the enabled markets, sequentially with ~30–45 s gaps. When the owner has disabled all but Workzilla, launch **only** `PARSER_MARKETS=wz`; starting kw/is as well re-opens the foreign feed tabs he asked to remove. Simultaneous start against a fresh `about:blank` window races: `goto: net::ERR_ABORTED; maybe frame was detached?` — one parser's `closeInactiveTabs` kills a sibling's in-flight navigation.
- Prior to launching, kill leftover `bun` processes only for the target scripts, never bystander services.

## Keep-tabs whitelist must follow the enabled markets
`reviews/data/keep-tabs.json` is written by `reviews/mode.py:записать_живые()`. Derive patterns from the `биржи` booleans in `mll_settings.json` — never hardcode all six markets. A hardcoded whitelist makes the cleaner preserve Kwork/Insolvo/Fl tabs forever while only Workzilla is enabled, so the owner sees a window full of foreign feeds. After changing it, rewrite via `записать_живые(mode.Р_ПОИСК)` and restart parser processes.

## Manual window work: stop the parser and narrow the tab allow-list
When the owner will watch and guide a manual browser operation (e.g. uploading
portfolio through a marketplace form), stop search first — confirm no
`parser.ts`/`watch-chat.ts` processes remain, not just that the mode changed —
then set `reviews/data/keep-tabs.json` patterns to ONLY the working tab.
Mode defaults for non-search stages still carry feed patterns (`kwork.ru/projects`,
`client.work-zilla.com/freelancer`), so the cleaner keeps reopening feeds over
the form the owner is watching. Rewrite the allow-list after the mode switch,
not before — switching rewrites it from mode defaults. A mode gate is still not
enough: the portal's `order-details` thread can spawn `bun wz-detail.ts
<market> <id> <url>` children that keep switching tabs with no parser process
alive. Enumerate every `bun.exe` by full command line (parser, watch-chat,
wz-detail) and stop the portal process itself for the duration of a watched
manual flow; confirm zero such processes before telling the owner the window
is quiet.

Disabling an exchange in the settings does not stop its **already stored rows**
from being enriched: the portal's detail cycle keeps selecting them and opens
detail tabs for markets that no longer parse. Move those rows out of the active
statuses (`new`/`white`/`ready`) before a watched manual flow, and re-check the
tab list after a few cycles. Also re-read the market flags after any mode
switch — a switch can rewrite configuration defaults and silently re-enable a
market that was turned off.

## Reappearing foreign tabs = stale parser processes holding CDP
When Kwork/Insolvo tabs come back right after cleanup, enumerate `bun.exe` by FULL command line and CDP owners (`netstat -ano | grep ':9222' | grep ESTABLISHED`). Old `bun parser.ts` wrappers with no `PARSER_MARKETS=` still hold sessions and reopen their feeds even while the current parser is WZ-only. Kill those exact PIDs; leave the current parser and `watch-chat` alone. Verify by re-listing tabs 25–30 s later — one immediate pass proves nothing.

**Check the launcher script, not just the processes.** A `start-parsers.bat` that hardcodes one `cmd /c set PARSER_MARKETS=<market> && bun parser.ts` per exchange keeps spawning every market on each launch, so disabling a market in settings and killing its live process is followed by the foreign feed tabs returning. Remove the disabled markets' launch lines from the launcher itself, then verify no `cmd /c set PARSER_MARKETS=<disabled>` wrapper remains. The market flags and the launcher are two independent enablement layers.

## Stale watch-chat monitors peg CPU (one core each)
`watch-chat.ts <order> --minutes 300` hold a CDP session; if Chrome restarts underneath them they spin on the dead session and do NOT exit at the limit — ~83–100 % CPU per process. 4 monitors = 4 saturated cores with the rest of the box idle. After ANY Chrome restart, kill lingering `bun watch-chat` before relaunching anything; neither keeper nor cron cleans them.

A monitor can also hang **without pegging CPU**: `connectOverCDP` against the shared Chrome blocks when several processes attach at once, and the default 30 s timeout turns it into `Timeout 30000ms exceeded` — the process survives but stops writing. Give every `connectOverCDP` an explicit timeout (60 s), and judge liveness by the log advancing (it prints every ~30 s), not by the process existing. Full cleanup procedure and the anti-detect-profile half of this: `references/cleanup-after-work.md`.

## One CDP connection, one monitor process, many orders
Per-order monitor processes each hold their own CDP session to the same
window, and the sessions accumulate: the port stops answering entirely
(`/json/version` and `/json/list` both empty) while Chrome is still alive
with dozens of processes, and every monitor then dies on
`goto: Timeout … exceeded` — the whole order-answering loop goes blind at
once. The fix is structural, not a bigger timeout: **one monitor process
that takes a comma-separated list of order ids and polls them round-robin
over a single connection and a single tab**. Attach once, `ctx.newPage()`
once, `goto` each order in turn, and write each order's lines to its own
per-order log so the delivery job still reads them.

Diagnose the three port states separately before restarting anything:
- `/json/version` answers and `connectOverCDP` attaches → healthy.
- `/json/version` answers but `connectOverCDP` times out after `<ws connected>` → driver/browser version skew or a wedged session, not a saturated port.
- `/json/version` is **empty** while Chrome runs → the port is saturated by concurrent CDP clients; kill the extra clients, do not reinstall the driver.

## A silent :9222 after a relaunch may still be STARTING — wait, don't kill again
Right after kill+relaunch, `/json/version` on 127.0.0.1 can stay silent for
15–45 s even though the log already printed `DevTools listening` — the socket
binds before the HTTP handler serves. Rule: probe in a loop (every ~8 s, up to
~45 s) BEFORE killing again. Premature kill/restart cycles are what CREATE the
next failure:
- The dying tree leaves a child that keeps the LISTENING socket on 127.0.0.1
  without serving it (curl connects, no HTTP reply, empty body).
- The newcomer logs `bind() returned an error: Only one usage of each socket
  address` and binds only `[::1]:9222` — which every client configured for
  `http://127.0.0.1:9222` (browser.ts, connectOverCDP, msg.ts) never reaches.
Diagnose ownership: `netstat -ano | grep ':9222 .*LISTENING'` → PID →
`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` (check CreationDate
+ command line to tell YOUR new instance from the stale one), kill the stale PID
with PowerShell `Stop-Process -Id <pid> -Force` (MSYS eats `taskkill //PID`,
single-dash `taskkill -F -PID` also flaky from git-bash), relaunch exactly ONE
instance, then probe in a loop until it answers 200 before starting monitors,
msg.ts or parsers against it.

## Chrome 157+: CDP-порт молчит, если --user-data-dir не передан ЯВНО
Со свежих Chrome `--remote-debugging-port` игнорируется, если профиль не задан явным аргументом: окно запускается, процессы живы, `DevToolsActivePort` не создаётся, `netstat` молчит — а политика DevToolsRemoteDebuggingAllowed это НЕ чинит. Правило: всегда передавай `--user-data-dir` явно даже для дефолтного профиля (`--user-data-dir=C:\Users\<user>\AppData\Local\Google\Chrome\User Data` сохраняет все сессии/логины), и только после этого проверяй netstat на 9222. Проверка: CommandLine основного chrome.exe (не `--type=*`) должен содержать флаг.

## Chrome started from a terminal dies with its wrapper — launch it DETACHED
A Chrome launched as a background terminal process becomes a CHILD of that
shell's wrapper; when the wrapper exits (its completion notice arrives with
exit 0), Chrome is taken down with it and :9222 stops listening. The contour
then appears to "lose Chrome" after every launcher session ends — each death
looks like an unrelated crash. Launch the shared window detached so no session
end can reach it:
`powershell -ExecutionPolicy Bypass -Command "Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\chrome-profile','--no-first-run','--no-default-browser-check','about:blank'"`
Logins live on disk in the profile dir, so detachment loses nothing. If a start
hangs after earlier force-kills, clear stale `C:\chrome-profile\Singleton*`
lock files first.

## Visible-to-the-owner means INTERACTIVE session: agent-spawned Chrome lands in session 0
The agent's process tree lives in the services session (session 0); a Chrome
launched directly from it opens with no visible window on the owner's desktop
(user session 2) — «я не вижу хром». Fix: a Scheduled Task with `/IT`
(interactive) + ONLOGON trigger runs in the OWNER's session. The standing
task is `Chrome-CDP` with the exact owner-approved command line
(`--remote-debugging-port=9222 --user-data-dir=C:\chrome-profile --start-maximized
--no-first-run --no-default-browser-check`); same mechanism covers the
post-reboot autostart (nginx/jobsy/portal tasks exist alongside). Revive a dead
window with `schtasks /Run /TN "Chrome-CDP"`, then probe `/json/version` with
PowerShell `Invoke-WebRequest` (git-bash curl can read empty) before attaching.
Verify the session:
session: `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'").SessionId`
must equal the explorer.exe session, not 0. After relaunch, re-open the standing
monitoring tab (browser-automation/open-monitor-tab.ts) — restore-last-session
brings the exchange tabs back but not the monitor.

## page.evaluate does NOT capture module-scope closures — pass data as ARGUMENTS
`page.evaluate(async fn => ...)` serializes only the function body; variables
from the surrounding script scope (`данные`, config constants) are NOT
available inside — the code silently runs against `undefined` or a stale
value, and the catch swallows it. Rule: pass everything the evaluate needs as
the second argument (`page.evaluate(fn, данные.map(...))`) and MERGE the
returned map back outside the evaluate (`for (const з of данные) з.x = out[з.id]`),
never enrich objects from inside the browser context. The bug shows up as
«обогащение отработало, описания не выросли».

## bun serve.ts is the in-house window keeper — and it needs a PTY in background
`browser.ts` itself points at it (`Порт 9222 молчит — окно не открыто. Запустите: bun serve.ts`),
it attaches, opens the window and keeps it alive, printing `Окно открыто, порт
9222 слушает. Enter — закрыть окно…`. It is INTERACTIVE: it reads stdin, so a
background launch WITHOUT a PTY (`terminal(background=true)` alone) hands it an
immediate EOF — the process treats it as the close command and exits right
after printing that it opened the window. Symptom: the launch log says the port
listens, yet `/json/version` refuses connections a minute later and every probe
cycle reports dead-alive flapping (measured 4 of 10 probes). Rule: start serve.ts
with `pty=true, background=true`; verify `stability = 6/6 probes over 12 s`
before attaching monitors or msg senders to it. A raw `chrome.exe … about:blank`
start without the keeper gives no such guarantee — prefer serve.ts.

## A tool failing `Target page … has been closed` on a LIVE port is a tab-level kill, not a dead browser
`task_status.ts` (or any reader) dying with `Target page, context or browser
has been closed` / `newPage: …` while `/json/version` answers = SOMEONE CLOSED
THE TAB mid-work: the stage cleaner or the mode-switch tab purge runs on every
`mode.py` switch. When the contour flips modes every few seconds (unfiltered
phase loop picking orders of the wrong phase), the cleaner kills each freshly
opened tool tab before it finishes its read — statuses come back `unknown`, the
orders never move, and the phase loop flips faster. Fix the CAUSE upstream (phase
filter in `pipeline_cycle`: take only orders of the current phase) instead of
raising timeouts; a reader attached to a tab that dies at 1–9 s cannot be saved
by a bigger timeout.

## An empty curl to :9222 is NOT proof Chrome is down — cross-check before killing
MSYS curl can return an EMPTY body for `http://127.0.0.1:9222/json/version`
(and even for the `localhost` spelling) while the same endpoint answers HTTP
200 to PowerShell `Invoke-WebRequest ... -UseBasicParsing` and Playwright
attaches over ws:// without complaint — every contour client (browser.ts,
msg.ts, monitors) talks ws:// or netstat, never this curl path, so the window
is fully operational while your probe reads dead. Acting on that empty
response produces kill/restart cycles against a HEALTHY window, which is
exactly what creates the port-conflict states above. Rule: before any kill,
take TWO independent signals — `netstat -ano | grep ':9222 .*LISTENING'`
names the owner PID (check CreationDate against your launch time), and
PowerShell must get HTTP 200. The watchdog itself probes via netstat, so a
silent curl is never a reason to restart anything.

A monitor that is polling many orders must still print a heartbeat into
**each** order's log on every cycle — that log's freshness is the only
per-order liveness signal the supervisor has, and a monitor whose single
combined log stays fresh tells you nothing about the order that stopped
answering.

## Editing a script does NOT change a running process — the old code stays in memory

A long-lived worker (`bun parser.ts`, `bun watch-chat.ts`) keeps the code it was
STARTED with. Patching the file changes nothing for it. Symptom: the owner sees
the old behaviour repeated after a fix was landed and verified by reading the
file — dozens of tabs on a URL that the patched code no longer opens. The
mechanism is mundane: the module was loaded once, at process start.

Rule: **any change to a running worker's behaviour requires restarting that
worker**, and the restart must be verified by the OBSERVED behaviour (no tabs on
the old URL, fresh log lines), not by the diff. Restart the workers FIRST, then
change the code, or change the code and restart in the same pass — never leave a
patched file serving an unpatched process.

## Kill by TARGET, never by process name — collateral kills the shared Chrome

`taskkill /IM bun.exe` (or any name-wide kill) takes down processes that merely
share the runtime: the visible Chrome on :9222 is often a CHILD of a
`bun`/`cmd` wrapper launched from a script, so a name-wide kill leaves
`chrome.exe` count at 0 and the CDP port refusing connections. The order-answer
loop then goes silent — no parser, no monitor, no client replies read — and the
owner sees «мы не отвечаем на заказы» with every service reported healthy a
minute earlier.

Rule: **kill the specific PIDs you started, resolved by command line**, and
never by image name. If a name-wide kill is unavoidable, relaunch the shared
Chrome yourself in the same pass and verify `http://127.0.0.1:9222/json/version`
answers before declaring the contour alive again.

## The tab cleaner must not REOPEN a fixed URL set — that is the flicker

A cleaner whose job is to close inactive tabs, but which also (re)opens a
hardcoded list of feed/board URLs on every pass, produces a window that opens and
closes the same pages forever. The owner sees a Chrome that «постоянно моргает»
while the tab count stays low, so the count is not the diagnostic — the FLICKER
is.

Rule: **the cleaner only closes; what must be open is owned by the stage that
needs it.** Keep the set of live tabs in a per-mode allow-list file (which tab
belongs to which stage), have the cleaner read it, and have the opener consult
the CURRENT stage instead of a constant list. A mode switch then becomes: read
the target stage's allow-list → close everything not in it → open what is
missing. Duplicated URLs are dropped separately, keeping the newest copy.

## One stage at a time: stop everything that is not the current stage

Work on a shared window breaks when two stages run at once (the feed tabs and
the chat tabs, the feed and the publisher). Symptom: the owner's screen jumps
while nothing is finished, and the newest order's reply is still unread.

Rule: **a stage owns the window.** Each stage (search / talk / execute /
submit) declares which processes run and which tabs stay open, and entering a
stage STOPS the other stages' processes and closes their tabs. The controller
is a single function that owns the whole switch (processes + tabs), so no stage
can start something another stage owns. Bids belong to the search stage only;
publishing and submitting belong to the execute/submit stages, where the feed
and the monitor are stopped.

## A dead feed tab must not kill the whole parser
Opening the market tab at startup without `try/catch` and without a `goto` timeout means one `ERR_ABORTED`/navigation timeout tears down the entire process, and that market stays silent until a manual restart. Always: `goto(..., { timeout: 45_000 })`, `.catch(() => null)` on the startup tab, and re-open the tab inside the main loop when it is null.

## A poller handed a dead Page handle must recreate it and return the new one
A long-lived loop that polls a page PASSED INTO a function (not one it owns) fails forever when the tab dies mid-life: every `evaluate` throws `Target page, context or browser has been closed`; a `catch` that logs and returns leaves the caller's handle pointing at the dead page, so the next cycle throws again — the error repeats on every poll while the loop still looks alive (it is writing to its log). Fix: inside the catch, open a fresh tab for the URL and RETURN it; the caller must assign the return value back into its variable (`kw = await проверитьМоиКворки(kw) ?? kw`) so the next cycle uses the live handle. This is the mid-life twin of the startup-tab reopen rule. A poller that returns nothing can never repair itself.

## Reply-latency alerts need a timestamped marker in the monitor log
A monitor that only prints `ОТВЕТ ЗАКАЗЧИКА (id)` gives the delivery job the text but leaves NO record of WHEN it was seen — so nothing can later answer "customer replied 40 min ago and nobody reacted". Stamp the discovery moment on its own log line (`[HH:MM:SS] ОТВЕТ ЗАКАЗЧИКА (id)`) BEFORE the text block, and keep the text block format unchanged (delivery and publication parsers split on `ОТВЕТ ЗАКАЗЧИКА (id):`). Reaction is then judged by what came after: our `наших:N` counter grew, or the order moved in the flow registry (updated_at ≥ marker). Alert with a state-file dedup (one alert per order) so a 5-min cron does not ping every cycle.

## An async poll list without `await` makes the monitor blind and watchdog kill it
`watch-chat.ts` reads its order list from an `async function списокЗаказов()`. Calling it inside the `for(;;)` loop WITHOUT `await` (`const список = списокЗаказов();`) returns a Promise — never an array — so `ids` is always empty and the monitor spins printing `в реестре нет активных заказов — ждём` forever, never opening tabs and never writing per-id logs. Watchdog then sees all per-id logs stale → declares the monitor hung → kills and respawns it → the new one has the same bug → kill/respawn every 10 min while the box looks "managed". The moment mode switches back to search the parsers come up, but the chat monitors never do — replies go unread for hours. Rule: any long-lived loop consuming a list from an async function must `await` the call; after a fix, verify per-id logs RENEW (the `Наших:N` line appears) and the monitor survives one full watchdog cycle before declaring victory. Watchdog liveness = per-id log freshness, so a monitor that never writes per-id logs is indistinguishable from dead.

## SHAPE mismatch in a list builder blinds the monitor like a missing await

Second cause of the «в реестре нет активных заказов — ждём» symptom besides
the missing `await`: one branch of the list builder returns items in a
DIFFERENT shape than the caller reads (the chat-filter branch gave raw SQL
rows `{target, state}` while the common branch maps to `{id, state}`; the
caller does `map(x => x.id).filter(Boolean)` → every element undefined → ids
empty). The monitor is blind **in chat mode only**: per-id logs freeze
exactly while the contour works on replies, the chronology-based
«unanswered» check then lies off the frozen lines, and the chat phase spins
without progress while the queue is full. Rule: every return path of a list
builder emits ONE canonical item shape; after touching any branch, run the
monitor once and confirm the per-id log RENEWS for the filtered order — an
empty branch and a working branch must never differ in shape.

## When the file contradicts the running process, instrument the PROCESS

Static reading can prove «this returns 22 rows» while the live process prints
«нет активных заказов» in the same minute — the file cannot settle it
(stuck in-memory state, a branch taken only at runtime). Rule: temporary
`console.log` INSIDE the suspect function → restart the worker → read the
probe in the worker's OWN log file (stdout redirect, e.g.
`[diag] rows=22 режим=chat нужные=[…]` — which may prove both halves fine
while the caller still prints empty) → remove the probes and restart on the
clean build. A re-derived standalone script proves nothing about the
process's state; only the instrumented run shows what the process actually
computed.

## A watchdog that trusts log freshness declares a dead parser alive
The check `len(живые_логи) != 3` passes for a market whose parser died a minute ago — the log it left is still fresh, so the watchdog reports the market healthy while it is silent. Require **both** signals: `len(парсеры) != 3 or len(живые_логи) != 3`. The same rule applies to any self-healing watchdog: a fresh log is not proof of a live process.

## "How many are running and why" — answer with the role of each
The owner asks this about a mixed set of processes. Enumerate them by role, not by count: one `parser.ts` per market, one `watch-chat.ts` per order awaiting a reply, one Dolphin profile per account under work, plus the standing services (portal, shared Chrome) that are **not** to be touched. Then state what was stopped and what stays. A bare number is not an answer.

## Keeper may be absent — verify, don't assume
Keeper respawns a dead parser only if a keeper process actually runs and only when the process is MISSING (`processes.includes("parser.ts")`); it does not notice a live-but-deaf parser. Check for a keeper process first; if absent, revive parsers manually per above. The same rule applies to any self-healing watchdog: **a fresh log is not proof of a live process** — a process that died a minute ago leaves a fresh log, so require the process AND the fresh log together before declaring a market healthy.

## Process kills on this box
`taskkill -F -PID <n>` (single dash) in git-bash — `//F //PID` parses as an invalid option. For whole-window kills, drive `Get-CimInstance Win32_Process` filters with a `.ps1` file written via write_file (inline PowerShell `if/else` in a `-Command` string breaks on parsing); `tasklist` round-trips through git-bash grep can come back empty — use PowerShell for authoritative process counts.

## A background status poller that reads a tab per record IS the flicker
A second flicker mechanism, distinct from the cleaner-reopen cycle above: a
collector (status reader, chat monitor) that opens one work tab per record every
cycle brings each tab to the foreground, so the owner sees tabs
«непрерывно открываются и закрываются» while nothing reopens a fixed URL set.
Rule: a background poller runs on a MINUTES-scale interval (not seconds),
returns focus to the pinned tab after every cycle
(`GET http://127.0.0.1:9222/json/activate/<id>`), and prefers a cached/API read
over a per-record tab read whenever a cache exists. Flicker is judged on the
owner's screen, not on the tab count — a low count with constant foreground
switching is still flicker.

## Never close the last tab — Chrome exits with it
Tab cleanup that closes the FINAL tab takes the whole CDP contour down with it:
`/json/version` refuses connections, `chrome.exe` count is 0, and every reader
goes blind while services reported healthy a minute earlier. Keep one pinned tab
(the portal) that every cleaner exempts, and after a death restore in order:
Chrome with its profile flags → the pinned tab → pollers/collectors (the order is load-bearing: at a dead port every tab-open `/json/new` fails silently inside a broad `except`, so a safety-tab opener placed BEFORE the Chrome start yields a window with zero tabs after the start — probe `/json/version` first, only then open tabs, and make the safety tab the portal, not `about:blank`), verifying
`/json/version` and `/json/list` answer before declaring the contour alive.
A tab-count check of "0" after cleanup means BROKEN, not clean.

## Never close a CDP-connected browser — close only the page
`connectOverCDP()` hands back a Playwright `Browser` whose `close()` sends
`Browser.close` to the TARGET: the whole profile/window quits, not just the
connection. Symptom: the owner reports the Dolphin profile «мгновенно
закрывается» after every probe script — each script "works", yet nothing
stays open for the next step. Ending a script with `browser.close()` is
therefore forbidden; end with `page.close()` at most, and profile
start/stop belongs to Dolphin (`GET .../browser_profiles/<id>/start|stop`),
never to Playwright.
Companion on a slow (3G) link: a page opened a second ago is not loaded —
wait for the load and read state before acting, and do not close a page
you still need. Closing too early is what turns reads into empty results.

## Owner diag flow (facts-only tasks)
The owner may post a task "collect facts" with a `diag_script.php?token=...` URL (e.g. host `5.144.179.170:8080`). Download with curl, run with the hermes venv python (`C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`), paste the output WHOLE, answer their per-fact questions, and make NO fixes in that task. `Г7 ДИСК` may come back empty on this box (python disk API returns nothing) — report it as-is, not as a failure. Count open Dolphin profiles by distinct `user-data-dir` under `.../dolphin_anty/browser_profiles/<id>/data_dir` — one dir per profile, several processes each; the profile count is NOT the `anty.exe` process count.

## browser-use one-off scripts cannot reach a specific tab
The `browser_exec` (browser-use) CLI attaches to its OWN tab (usually `about:blank`) — it cannot address an arbitrary existing tab by URL, and its runtime lacks playwright. For any page-specific diagnosis or DOM read on the shared Chrome, write a one-off bun+playwright script in browser-automation that finds the tab via `b.contexts()[0].pages()` by URL and connect with an explicit timeout. `urllib.request` against `:9222/json/new` PUT works for opening tabs without stealing focus.

## Report format
Task messages carry a report line, separate line at the end: `TASK|<id>|ACTIVE|REPORT|DONE`. One task at a time; the next task comes from the owner. Facts-only tasks get `TASK|<id>|REPORT` even mid-fix — stop fixing the moment a facts-only task arrives.

When the owner asks "how many of these are running and why", answer with the **process list and the role of each** (parser per market, monitor per order, profile per account), then say what was stopped and what stays. Clean up what the task no longer needs, and leave the mechanism (script + cron) behind so the cleanup does not depend on the agent remembering it.

## A monitor that is alive may be polling the wrong orders
A live monitor with a stale id list looks healthy — fresh per-order logs, running process — while the newest order is polled by nobody, so the customer's reply is never read. The supervisor compares the id list in the running command line against the current set of orders awaiting a reply and restarts the monitor when they differ.

## Tabs leak per call, ports saturate per session
An unclosed `ctx.newPage()` in a helper that runs on a schedule leaks one tab per call; dozens of tabs and Chrome processes eat the memory, and the CDP port stops answering — the same blackout as too many concurrent clients, but with no concurrent-client evidence to find it by. Count tabs, not connections. A guard file that makes the whole cleaner return early (rather than exempting one tab) means the cleanup never runs while that lock is fresh — and a lock refreshed by a recurring job means it never runs at all.

## A busy-tab flag set before navigation does not survive it
`withAttachedPage` marks its fresh tab busy with `page.evaluate(() => window.__hermesBusy = true)` — but the first `page.goto()` inside the callback replaces the document and wipes the flag. The tab cleaners then see a free, aging tab and close it mid-work → `Target page, context or browser has been closed` at the call site (browser.ts around `return await fn(page, ctx)`). Fix: set the flag with `page.addInitScript(...)` — it runs on EVERY new document in that tab, so it survives navigation. Second hole: cleaners that exempt tabs only by age (`timeOrigin < 60 s`) still kill a long-running operation — check `__hermesBusy` explicitly in the tab-closing loop, not just freshness.

## Cleaning up after finished work
Profiles, chat monitors, one-off scripts **and browser tabs** outlive their task. The owner's standing expectation: after the work is done, whatever is no longer needed gets stopped, and the reason it was still running is fixed rather than restarted. Tabs count as a resource with their own ceiling: an unclosed tab per call leaks until Chrome eats the memory and the CDP port goes dark, and a guard that cancels the whole cleanup (instead of exempting one tab) means the cleanup never runs at all. Procedure, state-based detection rules and the anti-detect-profile specifics: `references/cleanup-after-work.md`.

## Stage modes: one active stage owns the window
The owner runs the contour as explicit stages — search / talk / execute / submit —
where **every other stage stops**: its processes die and its tabs close, and only
the current stage's tabs stay. A mode switch is therefore one function that
changes BOTH the process set and the tab set, the live-tab list lives in a file
the cleaner and the opener both read, and the cleaner never reopens a fixed URL
set (that reopen cycle is the visible flickering). The mode table, the automatic
transitions and the post-switch verification are in `references/stage-mode-controller.md`.

## Kwork portfolio upload
One-off publish flow for the owner's portfolio (filechooser-only uploads, clear-dialog reset, `workNum` success check): `references/kwork-portfolio-upload.md`.
