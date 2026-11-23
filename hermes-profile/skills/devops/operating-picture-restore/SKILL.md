---
name: operating-picture-restore
description: "Use when resuming work from a written CONTEXT/handoff file."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [context, handoff, verification, restore, cron, gateway, registry]
---

# Restoring the operating picture from a written handoff

Use when the owner hands over a written context file (CONTEXT-*.md, a runbook, a
"what did we do" note) and asks to pick the work up. The file is a **claim
sheet**, not evidence. Every line in it was true when it was written; some of it
has since expired, and the interesting work is in the difference.

## Procedure

1. **Read the whole handoff first, then touch nothing.** The file states what
   was done, what was left, and the constraints the owner set. Constraints
   survive longer than status lines — honour them even when the status says the
   step is done.
2. **Turn every claim into a probe.** Split the file into claim classes and
   pick the live source of truth for each:

   | Claim class | Live source of truth |
   |---|---|
   | "the process/service is running" | port + owning PID (`netstat -ano`), or the process start time |
   | "the scheduled job delivers to X" | the cron job config plus the last execution's delivery outcome |
   | "the bot answers in chat Y" | the gateway's own config, and its start time vs the config's mtime |
   | "account/order X exists in state Y" | the registry DB — query it, never the file |
   | "the money is at X / balance Y" | the vendor's own API or the local ledger |
   | "the pool has N identities ready" | each identity's own artifact on disk |

3. **Query, don't infer.** Use one query per claim and keep the raw result.
   A claim confirmed by two independent sources (config + execution log) is
   stronger than one confirmed by a config alone.
4. **Fix what the probes broke, in place.** A helper script that crashes is
   part of the drift — fix it and re-run, so the next handover's numbers come
   from a working tool.
5. **Report in three blocks**: what is confirmed live, what diverged (and what
   you changed), what is still open with the next concrete step. Lead with what
   is true now, not with the history of the file.

## Pitfalls

- **A status line in the handoff is not evidence.** "3 accounts have live
  sessions" is a claim; the session artifact on disk is the evidence. Treat
  every count in the file as unverified until a probe returns it.
- **The documented helper CLI may itself be broken.** A handoff that says
  "run `<tool> report` to see the state" can name a command that raises
  `NameError` — often a latin/cyrillic identifier mismatch in a file whose
  functions are named in one script. Run the tool before trusting its output;
  a crashed command means the file's numbers were produced by an older
  version of that code.
- **Remote dashboards lag or under-report.** A cloud "profiles" list can show
  "never run" for a profile whose local data dir holds a full session, and a
  cookie-export endpoint can answer 200 with zero domains for a logged-in
  profile. Local artifacts on disk are nearer the truth than a remote summary.
- **Restart semantics differ per config surface.** Some settings are read at
  process start, others are read per trigger. Confirming one does not confirm
  the other; check which surface the setting belongs to before declaring it
  live.
- **The stale file is not only stale in status.** Check whether the paths,
  table names and command names it quotes still exist — a renamed table or a
  moved directory is drift too, and it silently turns every query into a
  wrong answer.
- **"Nothing to report" from a monitor script is a result, not a failure.** An
  empty output from a watchdog/deadline script means no alerts are due.
  Read it as a pass; do not re-run it hunting for output.
- **A standing rule given mid-session belongs in the handoff file.** When the
  owner states a rule (a report format, a one-task-at-a-time workflow), write
  it into the context file as its own section, not only into your notes — the
  handoff is what the next session reads first, and a rule that lives only in
  the agent's memory dies with the session. Keep the file's structure: a
  short section near the top, so it is read before the status snapshot that
  goes stale.

## Where the depth lives

- `references/verification-probes.md` — the concrete probe for each claim class
  on this Windows box: ports, cron job config and execution outcomes, gateway
  config vs gateway start time, SQLite registry queries, antidetect profile
  artifacts.
