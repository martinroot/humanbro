# Review-loop operations: parser/CDP outages, feed verification, relaunch

Operations for the browser-automation contour (parsers + chat monitors + the one
visible Chrome window on :9222). Use when the feed is silent, parsers are dead,
or `connectOverCDP` stops attaching.

## CDP wedge vs. driver mismatch — diagnose before reinstalling

Symptom: `connectOverCDP` log shows `<ws connected>` then `Timeout 30000ms`, but a
raw WebSocket `Browser.getVersion` (or `Target.getTargets`) on the same port answers
instantly. That means the **CDP session in the long-lived Chrome window is wedged**,
not the driver — the window's browser-level socket accepts connections but never
answers new sessions. Reinstall nothing yet.

Confirmed working recovery (22.10 incident):

1. Prove the wedge: raw WS to `ws://127.0.0.1:9222/json/version`'s
   `webSocketDebuggerUrl` answers, playwright `connectOverCDP` times out.
2. Kill the whole chrome-profile tree (`taskkill /F` on every `chrome.exe` whose
   command line contains the `--user-data-dir` path). CDP port frees up.
3. Relaunch Chrome with the SAME `--user-data-dir` + `--remote-debugging-port=9222`
   (cookies live on disk — Workzilla / marketplace logins survive the restart).
4. Re-test `connectOverCDP` — clean window attaches immediately.

Playwright can ALSO lag system Chrome legitimately: after Chrome auto-updates,
`bun update playwright` then `bunx playwright install chromium` to pull the driver
major matching system Chrome (e.g. playwright 1.64.1 bundles Chromium 156.x ≈
system Chrome 156.x). In the 22.10 outage the driver bump alone did NOT fix
connectOverCDP — the stale window was the real blocker. Do both, in this order.

## Cold-start the three parsers sequentially

Launching wz+kw+is all at once against a cold Chrome (fresh `about:blank` in the
shared context) races `page.goto` → `net::ERR_ABORTED; frame was detached` and each
parser dies. Start them one at a time with a 30–45 s gap so tabs settle, or let the
watchdog do it (`start-parsers.bat` spawns cmd wrappers carrying `PARSER_MARKETS`).

## Parsers belong to the watchdog lifecycle — don't hand-hold from a session

A `bun parser.ts` spawned as a Hermes background process dies with that terminal
session (exits with "no job control"). The watchdog then respawns exactly 3: kills
extras, launches via `start-parsers.bat`, and counts by BOTH log freshness
(`parser-wz/kw/is.log` mtime within ~90 min) AND process count == 3.

So the reliable move when parsers are down: kill ALL `parser.ts` processes, then
take the watchdog path (or start sequentially), then verify with two independent
signals — process count == 3 AND parser log mtimes fresh. Never verify by `ps` alone.

## Feed-log growth is the intake truth — sample twice

`feed-log.jsonl` size+mtime taken 2–3 min apart, growing = pipeline alive, even if a
market feed is quiet right now. Insolvo in particular can be silent for hours while
its parser process lives — that is normal, judgment comes from parser-is.log mtime,
not from insolvo-log.jsonl. The outage signature is: feed-log mtime stale > 3 h AND
`parser.ts` processes dead.

## Portal worker daemon — it owns the auto-responses; keep it alive and unstarved

`portal/worker.py` is the process that actually delivers need-info questions to customers: every 180 s it runs `send_waiting()` (writes the question file, calls `msg.ts`). A portal that answers on :8701 does NOT mean questions go out — verify the `worker.py` process exists and watch `worker.log` for `раздал уточнений: {'sent': N, ...}`. When the worker is dead, new orders sit in needinfo with a question that was never sent.

- **Reliable detached launch on Windows:** `powershell Start-Process -WindowStyle Hidden` dies at the first `print` (`OSError: [Errno 22]` — stdout is not a console in a hidden window), and `cmd /c start` from git-bash mangles cyrillic paths. Use a tiny Python spawner with `subprocess.Popen(cmd, creationflags=0x00000008 | 0x00000200)` (DETACHED_PROCESS | NO_WINDOW) and stdout/stderr to a real file — the same pattern the watchdog's own `запустить()` uses. Two `python.exe` rows matching `worker.py` = wrapper+runtime of ONE worker, not a duplicate.
- **`nohup … &` from the agent's own terminal does NOT survive either** — the wrapper
  shell exits with the call, the child never starts: empty log, port never opens, and
  the failure reads as "the service is broken". For anything you intend to poll, verify
  or kill afterwards, start it through the terminal tool's `background=true`, which
  returns a tracked session id. Empty log + refused port is the signature of a detached
  launch that never happened — check the process and the port BEFORE debugging the
  service's own code.
- **A failed order must leave the claim query.** If `claim_next`'s SQL includes `failed` in `IN (...)`, the oldest failed order is claimed every poll and starves the entire queue behind it — the symptom is the same order number repeated in worker.log every poll. Keep the SQL and the RETRY tuple in lockstep (RETRY = new/queued/running; failed resumes only by a manual status reset to queued after the cause is fixed), and write `orders.status='failed'` at every failure site AND in the early-return path — state.json alone is not enough or the row stays claimable forever. After any change, confirm the next poll picks a DIFFERENT order, not the same one.
- **Auto-response proof pattern:** one log line `раздал уточнений: {'sent': 1, 'skipped': N}` plus the order's `state.json` (`clarify_sent=true`, `clarify_sent_at`) is the read-back evidence that a question actually went out — report those, not "I started the worker".
- **Route the send by exchange; one channel script per marketplace.** `msg.ts` is Workzilla-ONLY (it builds `client.work-zilla.com/freelancer/<id>`); feeding it an Insolvo or Kwork id "sends" into a Workzilla URL with a foreign number. `send_waiting()` must pick the channel by `orders.source` (workzilla→msg.ts, kwork→kwork-msg.ts, insolvo→no script yet), and **skip entirely when no channel exists** — otherwise a question is recorded as sent that never reached the customer. Mark the skip (`clarify_skipped_no_channel`) so the counter does not inflate.
- **`clarify_sent` is earned, not assumed.** Only set it when the send subprocess returns 0; an exception-free `run()` that returns a nonzero code means the message did NOT go out. On failure, log `send-failed` with rc+stderr and leave `clarify_sent` false so the next round retries. When legacy code has already stamped false `sent` on orders (bytes that were never delivered), flip them to `clarify_false_sent=true` and drop `clarify_sent` before drawing any "answered" count.
- **`msg.ts` and `kwork-msg.ts` must set `tab-guard.json` before opening their tab** (same lock `bid-sender.ts` sets) and reset it in a `finally`. Without the lock the shared-Chrome inactive-tab sweep closes the just-opened chat page and `fill`/`goto` dies with `Target page, context or browser has been closed` — symptom is mass `send-failed` where each log carries that phrase.

## One monitor for ALL orders, not one per order

The shared Chrome on :9222 serves the parsers and the chat monitors. One monitor
process per order means N concurrent `connectOverCDP` sessions on one port; the
port stops answering (`/json/version` and `/json/list` come back empty while
`chrome.exe` still runs), and every monitor then dies with
`goto: Timeout 45000ms exceeded` on `client.work-zilla.com`. The symptom looks
like "the site is slow" and the effect is that **no client reply is read at all** —
bids convert into silence.

The working shape: **one** `watch-chat.ts` process takes a comma-separated id
list (`bun watch-chat.ts 22396505,22396126,22397814,22397840 --minutes 300`),
opens ONE connection and ONE tab, and polls the orders in turn — 8 s apart,
one full round every 30 s. The watchdog collects the ids from `flow`
(`state IN ('bid','assigned','working','moderation','submitted')` — the
CANONICAL vocabulary, see `references/order-status-registry.md`), kills every
existing monitor, and starts that single process.

**The monitor's id list is fixed at launch, so a new order is polled by
nobody until the monitor is restarted.** A monitor that is alive, whose logs
are fresh, and which holds a stale list looks perfectly healthy while the
newest order's chat is never read. The supervisor must compare the id list
in the running command line against the CURRENT set of orders awaiting a
reply and restart the monitor when they differ — and the set must be
computed with the same canonical states the rest of the tree uses.

**Better: don't pass the list at all — re-derive it from the registry INSIDE the
loop, every round.** The supervisor's restart-on-difference check only closes
the gap between watchdog ticks; a monitor that reads the order set itself
(`bun:sqlite` on the same registry, canonical states) closes it permanently,
because a new order is picked up on the next round without anybody restarting
anything. The watchdog then only has to keep ONE monitor alive, not manage its
argument list.

**A round must be BOUNDED, or the orders at the end are never read.** Polling
N orders sequentially with a per-order pause gives a round of N × (load + pause);
at 46 orders that is a 12–25 minute round, so each order is polled once every
twenty minutes and half of them look like «чат не отрисовался» or «ждём
ответа». Bound the round (a per-round cap on orders, and priority ordering so
the orders that are actually in work are polled first), and re-derive the set
each round. The symptom of an unbounded round is a monitor that looks busy while
the newest order's reply waits twenty minutes for its turn.

Give the monitor a **liveness signal of its own**: it appends a status line
(`ждём ответа... (id) …`) to the per-order log `logs-watch-chat-<id>-live.txt`
on every poll, and the watchdog treats a log that went quiet for
`МОНИТОР_ЗАВИСШЕЙ_МИН` (12 min) as a hung monitor. A monitor that holds no
connection and no log update cannot be distinguished from a live one by
process count alone.

The monitor must write the per-order logs ITSELF, not rely on stdout
redirection: a redirect to one shared file loses the per-id split, and the
delivery cron reads `logs-watch-chat-*-live.txt` to find the answers.

**Append to the log — and check that the write mode really appends.**
`Bun.write` with `{flag: "a"}` does NOT append: it **truncates and rewrites**
the file, so the log keeps only its last line. The symptom is quiet and
severe — the monitor looks healthy (process alive, log mtime fresh) while
every client reply that was already read is **gone from disk**, and the
stage that parses the log to find answers finds nothing and waits forever.
Two writes in a row prove it: the file ends up holding only the second one.
Use `appendFileSync` from `node:fs`, and after any change to the writer
confirm the file GROWS across two polls instead of staying at one line.

Keep a second copy of the replies where the per-order writer cannot clobber
them (the monitor's shared log, or a separate file written by a different
mechanism) — a log that a single write can truncate is not a source of
truth, and recovering a lost block is manual.

## Флаг «спросили» нужно ЗАБИРАТЬ ДО отправки, а не ставить после

Проверка «`asked` уже 1 → не спрашиваем», сделанная ДО отправки, и запись
`asked=1` ПОСЛЕ отправки — это гонка: два прохода цикла читают `asked=0` и
оба отправляют. Клиент получает один и тот же вопрос дважды.

Правильный порядок — **атомарно захватить флаг до отправки**:

```
cur = con.execute(
    "update flow set asked=1, updated_at=? where number=? and coalesce(asked,0)=0", ...)
if cur.rowcount != 1:
    return "вопрос уже отправлен (замок не достался)"
```

`rowcount == 1` означает «именно я захватил». Если отправка НЕ удалась —
замок отпускается (`asked=0`), иначе вопрос потеряется навсегда и заказ
зависнет без причины.

Тот же приём годится для любого «это уже сделано» — не только для вопроса,
но и для отправки скрина: проверка «уже отправляли» должна быть записью с
условием, а не чтением с последующей записью.

## Один файл — ОДНО вложение: журнал приложений

Сообщение клиенту и форма сдачи — это **два разных канала доставки одного и того же файла**. Клиент видит скрин дважды, если он ушёл и в чат сообщением, и вложением в модалку «Отправить на проверку» (а Workzilla ещё и дублирует поле «итог» из модалки в чат отдельным сообщением). Журнал **текстов** от этого не спасает: тексты там разные («вот скрин» и «скрин приложен»), а файл — один и тот же.

Поэтому нужен **второй журнал — по файлам**: таблица `file_log(target, file, where_, ts)`, где `where_` — канал (`chat` / `submit`).

- **Отправитель сообщения** (`dedup_send`) после успешной отправки помечает: `mark(target, file, "chat")`.
- **Сдача** (`wz-check.ts`) перед `setInputFiles` спрашивает журнал: `was(target, file)` — и если файл уже уходил, **не прикладывает его повторно** и пишет в лог, что пропустил.

Проверка журнала обязана стоять **в обоих** каналах. Иначе защита работает только в одну сторону, и ровно тот случай, который жалует владелец («опять 2 раза отправил скрин»), остаётся открытым.

**Проверка по файлу не зависит от совпадения текстов.** Два сообщения об одном скрине почти всегда РАЗНЫЕ («вот скрин» и «скрин приложен»), поэтому проверка «тот же файл + похожий текст» их пропускает. Правило: **файл уже уходил к этому заказу — значит второй раз не прикладываем, независимо от формулировки.** Считать надо по факту отправки файла, а не по смыслу сообщения.

**Каждый отправитель обязан идти через `dedup_send`, а не звать мессенджер напрямую.** Скрипт публикации, вызывающий `wz-msg.ts` сам, обходит журнал текстов И журнал файлов — и воспроизводит ровно тот дубль, который журнал был создан устранить. Все пути отправки (ручной, конвейер, восстановление) идут через одну функцию.

**Счётчик отправок в чате — это сообщения, а не ссылки.** Одно сообщение с тремя ссылками (thumb / download / storage) — это ОДИН файл. Дубль определяется по числу наших сообщений с этим текстом и по журналу, а не по числу ссылок в выдаче.


Симптом, который вводит в заблуждение: в чате после отправки видно **одно** сообщение с тремя ссылками на файл (thumb / download / storage) — это зеркала ОДНОГО файла, а не три вложения. Считать вложения по числу ссылок нельзя; считать по сообщениям с нашим текстом — можно.

## Таблица шагов имеет уникальный ключ `(target, step, ts)` — пишем `insert or replace`

Повторная отметка того же шага в ту же секунду падает с `UNIQUE constraint failed: steps.target, steps.step, steps.ts` — и ход завершается **после** успешной публикации, но до фиксации статуса: отзыв жив, а заказ в реестре выглядит нетронутым. Все записи шага идут через `insert or replace into steps` — и в конвейере публикации, и в guardrails, и в ручных прогонах: оба места писали `insert into` и оба падали.

## Перед починкой сломанного скрипта — проверить СИНТАКСИС, а не поведение

Правка в TypeScript-скрипте может оставить лишнюю скобку: файл не запускается вообще (`error: Unexpected end of file`), и падение выглядит как «скрипт не работает на этой карточке», хотя дело в правке. Проверка `ast.parse` / `bun` на файле занимает секунду и отделяет «сломал сам» от «не работает у клиента».

Тот же класс ошибок — незакрытая скобка после вставки блока: `if (!этоПрофиль) { ... }` вокруг кода, который и так был внутри `if`, даёт «unmatched ')'» в строке, far от места правки.


## A client reply with no reaction is an alert, and it needs a source of time

Delivering «client wrote» to the owner is separate from knowing WE acted on it. The chat-alert cron (`reviews_chat_alerts.py`) just forwards new replies; it does not check whether the reply was answered. A second mechanism (`reviews_noreply_alerts.py`, `--minutes <N>` default 30) escalates a reply that is older than the threshold with no reaction: wrote back to the chat (the monitor's «наших» count grew after the reply) or the order moved in the registry (`flow.updated_at` after the reply, or state closed/verified/skipped). De-dupe by order id in a state file so it alerts once, not every cron tick; empty stdout = silent (cron in no_agent mode), and it must NEVER count `waiting-account`/`preparing` as a reaction.

The mail for that alert is that the reply monitor must record WHEN it saw the reply. The raw reply block (`ОТВЕТ ЗАКАЗЧИКА (id):`) has no timestamp, so an escalation job cannot compute age from the log alone — **prefix every reply block with `[HH:MM:SS]` when it is written** and keep «наших:N чужих:M» status lines so the reaction check can compare counts before/after. Without the timestamp in the log the two known-format strings — «монитор не хранит время» and «алерт не может посчитать возраст» — are the same unresolved problem.

## The dedup key must be built the same way on read and on write

A monitor that re-reads its own log on start-up must derive the key
IDENTICALLY in both directions, or every already-delivered reply is printed
again and the delivery cron re-sends it to the owner in a loop. The trap: the
log line carries a timestamp («14:12 <text>») that the freshly-read message
also carries, but the write path may strip it while the read path keeps it —
then the two keys never match. Strip the bullet AND the leading timestamp on
both paths, and key on the text alone.

## A monitor writes its own read-facts into the registry

The monitor is the only component that knows whether a chat was actually
READ. Write that fact where the status report can see it: the timestamp of the
last SUCCESSFUL read and the text of the last read ERROR, per order. Without
it, «we did not get an answer» and «we could not read the chat» are the same
word in every report, and a broken monitor looks exactly like a client who has
gone quiet. The status line the monitor appends to the per-order log must say
which of the two happened — «чат не отрисовался» is a read failure, not an
absence of messages.

## A hung browser tab must not kill the worker

`page.goto` without an explicit timeout waits forever
in a start-up path kills the whole process: one market's tab failing to open
took the parser down, and the market then went silent while the watchdog still
read its log as "fresh". Rules that hold:

- every `page.goto` gets an explicit `timeout`;
- a tab that fails to open is caught at the call site (`.catch(() => null)`) and
  retried on the next round instead of aborting start-up;
- a null tab is re-created inside the round loop, not only at start-up;
- a liveness check must require BOTH a live process and a fresh log — a log
  stays fresh for a few minutes after its process dies, so log freshness alone
  reports a dead worker as alive.

## Autonomous bid intake — the loop that must run without an agent

The owner asks for the order-intake contour to run on its own and to react
fast. That means a scheduled loop, not a hand-driven sequence.

**Intake path.** The portal's own bid queue is NOT the intake path for review
orders: it applies a price floor and orders candidates by price descending, so
low-priced review orders (the owner's floor is 100 ₽ per review) never surface
there — the queue is effectively Kwork-only. Query the market projects directly
and rank candidates by **price per review**, not per order.

**Selection rules that keep the loop safe:**
- our business only — reviews on a card, on the platform the pool actually
  serves (reject other platforms' review boards, ad networks, key farms, calls);
- the pool cannot satisfy "phone" or "male/female account" — such orders are
  rejected before bidding, not after;
- count the requested reviews from the order text, but a price is not a count
  ("100 ₽ per review" is a price; "2 reviews" is a count);
- a level above the pool's confirmed one («от 5 уровня знаток») is a rejection
  decided before the bid — the bid is a commitment, and the account cannot
  pass the check;
- skip anything already answered — by the exchange's own id, not by title.

**A refusal list that grows while the feed fills up is a filter bug, not a
quiet market.** The loop looked healthy — it fired on schedule and every run
produced a clean "refused" line for each candidate — while the raw feed held
dozens of live review orders the picker never surfaced. Two filter defects
caused it, and both are the same shape: a rule written against a phrase
instead of against the meaning.

- A NEGATIVE rule fired on the client's own brief vocabulary. The brief
  «Оставить отзыв на Яндекс Картах **Техническое задание:** …» was refused as
  "not our business" because the exclusion regex listed the technical-task
  wording as another business's marker. A client's brief for OUR service will
  contain our service's vocabulary — exclude on the BUSINESS (call handling,
  ad networks, key farms, another platform's review board), never on the
  formatting of the brief.
- A POSITIVE rule demanded a marker the brief does not have to contain.
  «На Яндекс.Картах», «Оставить на Яндекс карте» carry no
  «карточка/организация» word, yet they ARE card orders. Treat the platform
  name plus the action as the marker; a literal word in the title is not
  required.

The diagnostic is cheap and must be run before touching the market: for every
refusal, print the fragment that matched, and diff the refused set against the
raw feed for the same window. A live order in the feed that the picker never
lists is a filter defect, and the fix is in the regex, not in the bid loop.

**A bid is a commitment.** Send one at a time with a pause between them: the
exchange reads the first few applications, and a burst of them from one IP
looks automated. Two bids per run with a short pause is enough for a 5-minute
cadence.

**The loop's own bookkeeping:**
- a ledger of bids already sent, keyed by the exchange's id — otherwise the
  loop re-bids an order that already has a live application;
- on success, register the order as awaiting a reply, or the chat monitor
  never picks it up;
- on failure, distinguish: the exchange says the order is no longer available →
  close it; our own gate refused (not our business, needs a phone, unprofitable)
  → leave it alive, it is worth another look later;
- **a missing bid field is not proof the client closed the task** — «поле
  отклика нет» also fires when the client picked an executor, and that
  executor may be us; read the task's stage before closing it, or an assigned
  order is closed while the client waits;
- write the reply text to a file rather than passing it as an argument —
  Windows argument encoding mangles cyrillic.

**Read-back of a bid is the API response, not the page.** The accept endpoint's
result code is the only reliable "sent" marker; the button text is present
whether or not the bid went out. If the reply field is simply absent from the
page, the order is no longer available — say that plainly instead of timing
out on the field.

**Supervision:** the loop, the tab cleanup and the chat monitor are separate
scheduled jobs, each with its own script and a single owner. A loop that
silently stops is worse than one that never ran — make every step report
through a log, and make the supervisor compare the monitor's id list against
the current set of orders rather than trusting that it is still relevant.

## The auto-question to the client is part of the bid, not a follow-up

The client needs two things to let the work proceed: **which card** and **the
review text**. Both usually arrive only after the bid is accepted, so the
loop must ask for them automatically right after the accept — otherwise the
order sits in «awaiting reply» with nobody having ever asked anything, and
the client's silence looks like a refusal.

Ask **once, completely, in one message**: every missing field in that message.
A message that asks only for the link leaves the text to a second round trip
and doubles the time to publish.

The ask must be idempotent per order. If the order row was created outside
the normal registration path it may have no question field at all, and the
auto-ask silently does nothing — check the field is populated, and if it is
missing, fill it rather than skipping the order.

**Verify the send, don't infer it.** The send script prints a success line;
read it. And keep the question in the order's own row (plus a `asked` flag)
so a re-run does not re-ask.

## A proxy that stops answering is a dead port, not a broken profile

A profile that refuses to launch with the cabinet's `E_PROXY_CHECK_ERROR` /
`initConnectionError` is usually the **proxy port**, not the account: the
cabinet calls the provider to validate the tunnel before launching. Test the
ports directly (a plain request through the port's own host/port) — several
can be dead at once while the profiles and accounts are perfectly fine.

Fix by rotating the egress of the dead ports (`GET /v2/proxy/refresh/{id}` in
the provider API — see `references/proxy-vendor-api.md`), then re-test the
same ports and confirm each returns an external IP before retrying the
profile. The check is per port, not per profile: a portfolio-wide "profiles
don't start" is usually a handful of dead ports, and buying new accounts
because of that wastes the purchase.

## Watchdog limits (applied 22.10 after CPU-100% incident)

`reviews_watchdog.py` (cron, every 10 min) enforces: max 3 parser processes,
hard-kill any `watch-chat.ts` older than 6 h (`--minutes 300` is not honored when
CDP is dead — the monitor spins in a reconnect loop at ~90% CPU/core), **one
live monitor for all orders** (older shapes allowed 4, which is what starved
the shared CDP port), max 3 open Dolphin profiles. Constants:
МОНИТОР_ЗАВИСШЕЙ_МИН=12, МОНИТОР_МАКС_МИН=360, ПРОФИЛЕЙ_ДОЛФИН_МАКС=3. Test
watch the age-kill by temporarily setting МОНИТОР_МАКС_МИН tiny (e.g. 0.05) and
watch it kill+respawn — do not wait 6 h.

## A profile that is already running is not a failure — recover its port

The anti-detect cabinet answers `409 PROFILE_ALREADY_RUNNING` when the profile
is up, and the start call then returns no automation port. Code that reads
"no port" as "profile did not start" reports a healthy profile as broken and
skips the whole order. Recover the port instead: read the last
`profile_started` event for that account from the registry's event log, then
confirm the CDP endpoint answers (`GET /json/version` on that port) before
using it — a stale port from a since-restarted profile looks alive in the log
and is not.

## A script that suddenly stops parsing: look at the operator glyph

A contour script died with `SyntaxError: invalid syntax` on a line that
looked perfectly valid, and the file was byte-identical everywhere else. The
cause was a **Cyrillic `в` typed where `in` belongs** — a Russian-language
codebase with Cyrillic identifiers makes the two indistinguishable at a
glance, and the tokenizer accepts the line (it is a NAME token) while the
grammar parser rejects it.

Two diagnostics that found it fast, in this order:
- `tokenize` the file and look at the token stream: the line showed
  `NAME 'в'` sitting where an operator belongs. The token names tell you the
  glyph is an identifier, not a keyword.
- bisect by bracket depth: a scanner that tracks `()[]{}` depth line by line
  locates the first line where depth stops returning to zero, which is the
  statement that never closed.

Then grep the whole project for the same substitution — one occurrence is a
typo, several are a habit, and the ones inside string literals are invisible
to a naive grep.

**A cron that owns a script dies with that script, silently.** The job keeps
firing on schedule and its output is an error nobody reads, so the contour
looks alive while the work it drives stopped days earlier. After any syntax
fix, run the script ONCE by hand and read its output before trusting the
schedule again — and treat "the cron ran" and "the work happened" as two
different facts.

## A Cyrillic stage silently never matches in a JS regex

`\b` in JavaScript is an ASCII word boundary. `/\bУдалено\b/` does **not**
match the Cyrillic word «Удалено», so a status check built on it reports a
deleted task as live and the gate lets the work start. The same holds for any
Cyrillic token («В очереди», «В работе»).

Match the plain substring without `\b`. And in `page.evaluate`, avoid the
name `chat` — it collides with a built-in on the page and throws
`ReferenceError: chat is not defined`, which kills the whole read.

## The contour is one cycle, not one job per stage

Splitting the contour across several scheduled jobs (a bid job, a publish
job, a chat-alert job) means two of them can act on the SAME order in the
same window: a second bid on an order already bid, a second publish attempt
on a card already reviewed. It also leaves a stage nobody owns, so a job
waits forever for a predecessor that moved on.

One scheduled pass owns the order, in a fixed order:
**заказ → статус → сообщения → исполнение строго по ТЗ → закрытие**
— take live orders, bid, ask the client, read the task's stage, read the
messages, execute the brief's steps, submit, close. The only separate jobs
are the ones that REPORT (chat alerts to the owner, deadline digests,
watchdog counters) — reporting never acts on an order.

When several jobs must be consolidated, remove the old ones in the same pass
that adds the new one; a leftover old job is a second owner. A duplicate
cycle is visible as two cron entries pointing at the same work.

Throughput lives in the one cycle: how many orders it takes per run, and the
pause between bids («на большинство заказов мы пока просто не успеваем» is
answered by cadence and per-run volume there, not by more parallel jobs).

## A cycle that dies at a fixed wall-clock time is a TIMEOUT, not a slow step

The cycle «обрывается через девять минут» every single run — same wall-clock
time, every time. A rate-limited market would vary; a timeout does not. The
cause is arithmetic, not speed: reading one task's stage from the exchange
costs ~7 s, so a pass over 47 orders is ~340 s of pure waiting, and the pass
never reaches its own work.

Two rules, and the second is the one that actually fixes it:

1. **Cache the expensive read.** The exchange stage changes rarely; re-reading
   it for every order on every pass is pure waste. Cache it with a short TTL
   and record WHEN it was read and WHAT the read error was, so a stale value
   is distinguishable from a fresh one.
2. **Read it only where the answer changes a decision.** The stage matters for
   orders we are about to act on (publish, submit, bid). For a hundred orders
   that only need «is anybody waiting on us», the answer comes from the
   registry and the chat, not from a fresh browser round-trip.

The generalisable form: **when a pass has a fixed duration, count the work it
does per unit and multiply by the set size.** If the product exceeds the
budget, the fix is to shrink the set or the per-item cost — never to raise the
timeout and call it stability.

## The order loop and the order set: one cycle, but ONE order per execution stage

A cycle that both scans every order and executes them serially mixes two very
different costs — a cheap scan and an expensive execution (farm, publish,
screenshot, submit, several browser round-trips each). The scan must be
bounded and cheap; the execution must be ONE order at a time, chosen by
priority (overdue first), because executing several in one pass multiplies the
window-switching and the tab churn.

So the shape is: scan → pick the single most urgent actionable order → execute
it fully (including the screenshot of OUR OWN review and the confirmed
submission) → next pass. An order that is not executable (missing data, not
ours, removed) is left alone with its blocker recorded; it is not executed
half-way and it does not consume the pass.

