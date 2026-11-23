# Self-healing verification loops and safe state deletion

Applies when a scheduled check drives the pipeline itself (a recurring smoke
test, a watchdog that pulls from a queue and reports back), or when asked to
clear logs. Both share one failure mode: **the harness quietly stops checking
while reporting success.**

## The consuming-fixture trap

A queue whose rows are written by the very check that reads it is a finite
fixture. A check that pulls a record and files a report marks that record
handled — typically a row under a `UNIQUE(source, external_id)` key plus a
`NOT EXISTS` filter in the read. Consequences:

- The listing leaves the queue **permanently**, on the first run, even in a mode
  where the form never actually left the browser.
- Repeated runs drain the fixture. Once empty, the check has nothing to verify,
  and an empty result reads as "healthy".
- This is the worst failure shape available: not an error, a **silent success
  that no longer exercises anything**.

Rules:

1. **Give the check its own accounting.** Record what it took, then put it back
   in the same run: delete its own row, restore the record's status. Roll back
   exactly what this run took, nothing else.
2. **Assert the fixture is non-empty, and treat empty as a failure.** A check
   that cannot find work to do is a broken harness, not a clean bill of health.
3. **Report the fixture size in the output.** A number that only ever goes down
   is the tell.
4. If the queue must be consumed for real, purge it between runs deliberately —
   never let the check consume it as a side effect of verification.

## Differencing the report against the previous run

A scheduled check should emit a deterministic snapshot of *state*, not of time —
no timestamps, no run counters in the compared portion — and compare it to the
previous run. Unchanged output means there is nothing to do; the agent step can
be skipped entirely. Include the harness verdict (changed / unchanged) in the
output so a reader can tell "nothing happened" from "nothing was checked".

## Duplicate listeners masquerade as code bugs

Before concluding that a local harness is buggy, count what is actually bound to
its port:

```bash
netstat -ano | grep ":<port>" | grep LISTENING
```

More than one row means restarts left overlapping processes — the OS lets a new
instance bind while an old one lingers, and `TerminateProcess`/`SIGTERM` on
Windows does not always reap it. Requests then land on one instance while a
different one answers, which surfaces as connection resets and empty responses
against handlers that pass when called directly. The tell is the combination:
the function works in isolation, the root route works, and only some routes
fail. Kill every listener, start exactly one, and re-check.

Diagnose in that order — call the handler directly, then count listeners, then
read the trace. Editing code on the strength of an empty response alone sends you
looking for a bug that is not there.

## Triage a supervisor that will not come back

When nothing restarts after a change, the supervisor is the first suspect, not
the service. Confirm the supervisor's own process is alive before concluding the
service refuses to start, and restart it explicitly. Verify recovery by polling
the actual endpoint, not by the absence of an error message — and expect to see
stale tracebacks from the killed process arrive late, describing a port state
that has since been fixed.

## Read a section, not the first block

Scoped containers repeat across a page, and the first match is frequently a
status badge rather than the content. Anchor on the section heading and take its
next sibling, not the first match of a generic container class. A field that
reads as a fragment is a selector bug, and it stays invisible unless the step
asserts on content it expects.

When a self-healing loop is expected to bring a service back, the supervisor
must be verified independently of the service it supervises. A supervisor that
died earlier looks exactly like a service that will not start.

Corollary: a supervisor whose stdout is a **file the operator may delete** can be
killed by log cleanup without any error surfacing. If you clear logs, check that
the supervisor process is still alive afterward, and restart it explicitly.

## One process owns a browser session

A CDP/remote-debugging port is a single-owner resource. A manually launched
window and an automated holder both pointing at one port produce tab
contention: cleanup routines close tabs the other owner needs, and errors appear
as "page/context/browser has been closed" on routes that were working.

- Pick one owner. If the owner is automated, a human-launched window is a
  conflict to close, not a co-owner to accommodate.
- Diagnose by counting real browser targets (pages vs frames/service workers)
  rather than by the error text: one page plus `about:blank` means the tabs
  were cleaned away, not that selectors drifted.
- If the operator launches a window by hand to watch the work, say which of the
  two you need before they do — the recovery is a restart, but only if the
  ownership question is settled first.

## Error paths must restore the resource they lost

A recovery block that catches the failure and then does nothing is worse than no
recovery: it converts a transient fault into a permanent outage for that feed,
and the health record shows the original error forever.

- In the catch branch, **re-create the handle** and reassign it. A resource
  declared with `const` that later needs reassignment will not even compile
  after you add the recovery — change the binding to `let` in the same edit.
- Apply the same shape to every feed in the loop, not just the one that was
  reported broken. A sibling feed with an empty catch is a second outage waiting
  for its first trigger.

## Memory on a small host

Long-lived third-party widgets inside pages (payment iframes, analytics beacons)
persist for the whole life of the window and cost memory continuously, while
being useless to feed reading. Route-level blocking of specific hosts is the
cheap win; keep the blocklist narrow and never extend it to images or fonts,
because a listing may carry preview images that are part of the task.

Cap renderer count and per-tab heap at launch. Then **measure before and after**
and report the numbers — a configuration change to a memory ceiling is
unverified until the footprint actually moved. Recalculate the ceilings when
the host's RAM changes rather than inheriting the old values.

## Scheduling the check

- A recurring check runs in a **fresh session with no chat context**: its prompt
  must carry every path, credential location, constraint, and reporting rule
  from scratch. Referencing "as discussed" yields a session that cannot act.
- Scripts run by a scheduler are resolved from the scheduler's own scripts
  directory; keep a copy at the canonical project path and copy it in, so the
  file has one source of truth but is reachable where it is executed.
- The check's exit code should mean "problems found", not "ran successfully" —
  a monitoring loop that returns 0 on a detected failure cannot be composed
  around.
- Give the loop the *repair* it is allowed to perform, and the actions it is not:
  which services it may restart, and which externally-visible actions (outbound
  offers, customer messages, irreversible state) it may never take unattended.
  Default the second list to the strictest setting.
- **Scope autonomy by target, not by task.** Owners routinely ask for full
  autonomy and, in the same breath, for work to be done "at any cost". These
  pull opposite ways once the loop can act outside its own host, so resolve it
  explicitly rather than picking one clause: a loop may be fully autonomous over
  a local sandbox, over service repair, over backlog triage, and over repairs it
  can revert — while a live exchange account stays behind an explicit
  per-identifier approval, because an offer there is a commitment made under the
  owner's name and one malformed send is not undoable. Offer to lift that rail
  for a named set of identifiers rather than arguing for it.
- State the boundary in the loop's own prompt, not only in the conversation that
  set it up: a scheduled run starts from a fresh session with no memory of the
  agreement, so a rail that lives only in chat is not a rail.
