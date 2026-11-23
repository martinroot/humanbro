---
name: wintask-task-protocol
description: "Use when WINTASK assigns a task; enforce TASK|N| protocol."
---

# WINTASK task protocol

Use when the WINTASK Telegram group assigns a numbered task («Задача <N> — …», or «По назначению N, run=<hex>…»). The owner (Martin / ds_cyber) audits every reply against this protocol — a wrong status line means the tracker does not apply the mark.

## Standing rules (apply to EVERY assignment)
- **One task at a time.** Work ONLY the current assignment; the next task is issued by the owner. Never start follow-up work, never touch other branches.
- **Status lines, verbatim:** open with `TASK|<N>|ACTIVE` (or `…|ACTIVE|run=<hex>` when a run id was given), close the LAST message with exactly `TASK|<N>|DONE` (or `REPORT` / `BLOCKED` / `PAUSED`), one final line. Keep the run id suffix identical on every status line of that run.
- **Use the tracker's number N only.** Never substitute internal numbering (17.1, 17.3…): the tracker matches N against the active task.
- **REPORT ≠ DONE.** REPORT is progress and does not close the task; the owner will keep asking for facts. BLOCKED means the attempt is stopped — state the reason and stop. DONE means ready for criteria review INCLUDING cleanup (released profiles/processes/monitors).
- **Facts only in the report:** paths, numbers, logs, timestamps; no invented counters — if the metric is uncountable, say so. For diagnostic assignments change NOTHING (no restart, no config edits): gather facts, report.
- If an owner instruction conflicts with the active task, the active task wins unless the instruction explicitly supersedes it.

## Report shape (owner's preference)
Labeled fact lines (or bullets, no tables), each with real path/number: what was done, where (file/route), and verification output. Close with the DONE/REPORT/BLOCKED line. Mirror the customer's language register when replying through bid flows; be direct here.

## Usage-cost reporting (tracker asks)
When a task requires sending call usage to the tracker: `python C:/Users/Administrator/AppData/Local/hermes/scripts/tracker_usage.py --minutes N` reads `agent.log` (`API call #N: model=… in=… out=… total=… latency=…s cache=…`), prices per model come from the hermes venv `usage_pricing.py` (deepseek-flash in $0.15/M, out $0.60/M, cache-read $0.003/M); models marked `:free` cost $0 — always zero them, never fall back to a priced model.

## Входящие задачи → портал
Входящая задача из чата WINTASK (`TASK|N|текст`) становится состоянием портала, а не живёт в чате: `POST http://localhost:8701/api/wintask` с телом `{"текст":"TASK|N|..."}` (кириллица — UTF-8 файл + `--data-binary @file`). Портал валидирует протокол (400 на мусор) и создаёт задачу в MySQL `tasks` (note `WINTASK|N|...`); дальнейшие стадии ведёт портал.

## Exception → tracker task (the auto-pipeline hook)
When a scheduled pipeline step dies, the fix is a task for the tracker's fixer agent (MLL), not a chat message — the owner's standing instruction: on exception, post the task, and the fixer patches the pipeline precisely; the contour otherwise runs solo.

- `POST http://5.144.179.170:8080/api/task_queue.php` with header `X-Ingest-Key` (key comes from `X_INGEST_KEY` — env or `browser-automation/.env`) and body `{"project_ref":"WINTASK","title":…,"prio":2,"source":"agent-selfcheck","note":…,"dry_run":false}`. Docs: `http://5.144.179.170:8080/api/task_queue_doc.php`.
- **`title` is ONE line in the operator's format: `ID <component> | Исключение <type> | Ошибка: <message>`** — the fixer receives `title` verbatim with nothing else, so the component id, the exception type and the error text must all live inside that line; no protocol lines and no ids are appended by the tracker.
- Ready-made module `scripts/task_queue.py`: `post(title, …)`, `on_exception(component, type, text)`, `install_hook(component)` (a `sys.excepthook` wrapper). `install_hook` is already installed at the top of every `reviews_*.py` cron wrapper, and the main wrappers additionally call `on_exception` inside their `except` blocks — do not re-wire it per script.
- **A refused post never stops the contour and never pages the owner**: a missing key, `401 bad ingest key` or `429` is printed to the script's stdout only, the script keeps its normal exit code, and chat stays silent.
- Tracker limits: duplicates are skipped (`dup:true` — fire and forget), max **3 open tasks per `source` per direction** (else HTTP 429); a 429 means wait for an open task to close, not retry louder. The endpoint validates the key even for `dry_run:true`, which is the way to test a payload without creating anything.
- **POST тела с кириллицей из git-bash: писать UTF-8 ФАЙЛ и слать `--data-binary @<file>`, не `-d '{…}'` inline** — иначе curl кодирует CP1251 и сервер падает `UnicodeDecodeError: 'utf-8' … byte 0x97`, отвечая «internal error» без намёка на причину. Тот же механизм у любого JSON-роута этого контура (включая порталный `/api/log/task`, каналы «трекер»/«портал»).
