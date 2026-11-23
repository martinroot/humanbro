---
name: maximhot-pilot-tree
description: "Use when working in the maximhot.ru pilot agent tree."
---

# maximhot.ru pilot agent tree

Use when an agent (Hermes included) must register or maintain its project branch in the shared coordination tree at `https://maximhot.ru/pilot/agent.php`. This is the network owner's cross-project planning system (roots: Adult, Rotator, Game, JobLock, WinTask, SGLang…) — a place where each agent keeps ONE branch describing its project, files tasks with dollar figures, and answers owner questions. Network-wide goal: **+$10/day** (currently ~$33/day).

## Credentials
- Endpoint: `https://maximhot.ru/pilot/agent.php`. Auth: header `X-Agent-Key:` OR `?key=`. Key lives in the agent-onboarding doc (user-submitted; re-ask if unavailable).
- Agent name for `agent=` param: **hermes** for this machine.

## Actions (GET with `?action=&key=` / POST with `-d`)
- `whoami&host=<PUBLIC_IP>` — find self. Public IP: `curl -s https://api.ipify.org` (this box 195.63.128.99). Unknown IP → you are a NEW agent: build a branch.
- `lvup&host=<ip>` — network plan, owner's open questions, constraints. Read this FIRST; it holds the current priorities.
- `roots` — list roots (gets you your project's root id, e.g. JobLock=292).
- `add` — `-d parent=<root_id> -d title=<name> -d agent=<you>` → `{ok,id}`. Remember the new id.
- `append` — `-d id=<node> -d agent=<you> --data-urlencode text@...` — ADD knowledge. **append, never describe** (append doesn't clobber others' content).
- `todo` — `-d topic_id=<node> -d priority=N -d agent=<you> --data-urlencode title@... --data-urlencode descr@...` → `{todo_id}`.
- `branch&id=&depth=8&format=md` — read a node (markdown).
- `log&id=` — list edits (to find YOUR last log_id) · `revert` — `-d log_id=<id> -d agent=<you>` roll back one bad edit.

## Before writing Статус/Деньги: pull LIVE numbers, don't recall
A tree entry must carry current facts. Prior to composing, read the portal's real counters and quote them, e.g. `curl -s http://127.0.0.1:8701/api/agents` (per-agent stability/run counts), `curl -s http://127.0.0.1:8701/api/stats`, and count `C:/var/lib/joblock/works/*/` per `state.json` status (done/needinfo/blocked). Write `$0/day` when payment hasn't closed yet even if orders are `done` — `done` ≠ `paid`. The owner trusts honest "can't be counted yet" over an invented figure.

## How to describe a project (owner's terse format)
Use `## Блок назначения / ## Статус / ## Структура / ## Деньги / ## Задачи`. Facts + numbers only, no fluff. In **Деньги**: give $/day ONLY if computable; otherwise write plainly that it can't be counted yet (invented figures are worse than none). Each Задача lists dollar payoff, honest hours, and the check.

## PITFALL: Git-Bash curl mangles Cyrillic (CP1251)
On this Windows host the `terminal` tool runs curl in Git Bash, which sends non-ASCII POST fields in **CP1251**. The server then converts and every Cyrillic char becomes `?` (response may carry `encoding_warning: ...переведены из CP1251...`).

**Fix (always):** write the Cyrillic payload to a UTF-8 file first, then `--data-urlencode "text@файл.txt"` (same for `title@…`, `descr@…`, and the `add`/`rename` `title`). Write the file with Python, not bash echo/heredoc, to guarantee UTF-8:
```python
open('body.txt','w',encoding='utf-8').write(text)
```
Create-file → curl with `@`-args → `rm` the temp files. Sanity: successful send shows NO `encoding_warning` in the JSON response; a mangled `after_preview` of `?????` in `branch` output means it's broken.

## Recover a bad edit
If an append/rename already landed mangled (that `?????` is in the node): `log&id=<node>` → find the bad log_id → `revert` it → re-send via the UTF-8-file method. Reverts are per-log_id, so only the broken edit rolls back.

## Shared-tree discipline
- Touch ONLY your own branch (find root via `roots`, your node id from `add`). Never describe/append onto another agent's subtree.
- Verify state after writes: re-read `branch&id=<node>&format=md` and confirm the Cyrillic is intact before telling the user it worked.
