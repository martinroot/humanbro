---
name: incident-escalation-telemetry
description: Use when wiring status reports and failure escalation.
---

# Incident escalation + status telemetry (automation contour)

Wire and maintain the three pieces that keep a cron-driven contour autonomous: (1) exceptions from scripts become deduped engineering cards in the project's task API, (2) a periodic status snapshot reaches the owner's DM, (3) an LLM-free diagnostics daemon watches the services. Owner's standing rule: the contour runs solo; only genuine incidents reach a human or an agent. Wiring details (contracts, paths, commands): `references/escalation-and-telemetry.md`.

## Always-on rules
- **Escalate the exception, not the noise.** Known-transient types (missing optional file, key/index misses) are swallowed locally; repeats of the same component+type inside a cooldown are dropped; critical classes (timeout / network / database / runtime) escalate at top priority, the rest one tier lower. Without this gate a flapping check floods the board and the limiter (3 open cards per source) starves real incidents.
- **One fault → one card.** A content marker (`[EX:<sha1>]` of component|type|message) in the note + a local state file + a GET-scan of open cards before any POST. A failed GET never triggers a POST — blind repost is exactly the duplicate-card failure this prevents.
- **Bind the incident to the concrete unit of work** — when one order is in focus, the card carries its number; an incident on a generic pile is invisible to whoever works the order.
- **Escalation must not mask failure.** The failing process still exits non-zero after reporting, so the scheduler's own failure alert fires too; the hook wraps the reporting call, never the exit path.
- **Markers are read-only.** Editing or deleting a marker note (or wiping the state dir) destroys the dedup protection; a delivery-uncertain POST is verified by listing, never retried blindly, and only an explicit confirmed-absent confirmation re-arms it.
- **For one-way events with no read-back (chat/DM posts), write the dedup key only after the API confirms delivery.** Recording intent before the send turns one failed HTTP call into permanent silence for that event; the local event log must be evidence of delivery, not of intent.
- **Status cadence without an LLM:** a no_agent cron script posts one compact snapshot (mode/focus, counters, port liveness, heartbeat, recent run statuses, last escalation) to a dedicated DM target every N minutes. stdout is delivered verbatim and empty stdout sends nothing — so the script stays quiet by printing nothing, never by raising.
- **Secrets live in env, never in config or URL.** A second escalation channel activates only when its key variable exists; a missing key logs a refusal locally and must not be retried or surfaced to chat.
- **Prove any change E2E:** the module's own test suite plus one simulated exception (card created with marker + binding → identical repeat suppressed → distinct fault gets its own card → test cards cleaned up).

## Procedure
1. **Escalation module** — one Python module in the scripts dir exposing `on_exception(component, exc_type, text, where)` (gate → marker → project-API card, plus the keyed second channel) and `install_hook(component)` (a `sys.excepthook` forwarder).
2. **Hook every cron script** — insert the two-line install right after the `__future__`/first imports of each scheduled script, `compile()`-checking each edited file first.
3. **Status cron** — create a no_agent job with the status script, fixed cadence, `deliver: telegram:<owner-dm-id>`; verify the first snapshot arrives in the DM.
4. **Diagnostics daemon** — install the LLM-free probe module (single instance per state file) with the platform scheduler's own task; it owns only its own task and never touches other jobs/processes.
5. **Prove it E2E** — simulate one exception end to end, then delete the test cards so the board shows only real incidents.

## Pitfalls
- **Mixed naive/tz-aware timestamps break comparisons** — rows written by different layers mix naive `datetime.now()` values with `+03:00` ISO strings; normalize at parse (`astimezone().replace(tzinfo=None)`) before subtracting, or a watchdog dies with a TypeError on its first real pass.
- **Generating Python that mixes Cyrillic identifiers with comprehension keywords mangles `in` → `в`** — keep loop/comprehension keywords and target names Latin, and assemble file-insertion templates from real line breaks (or `chr(10)`); a doubled `\n` writes literal backslash-n text into the target. Always `compile(source, path, 'exec')` BEFORE writing a string-assembled file — that guard is what stops a half-mangled patch from landing in a working script.
- **A status script that raises sends an error alert instead of a snapshot** — treat exceptions as bugs in the script, not as a reporting channel; keep output empty-when-healthy.
- **Two channels, one truth** — the project API and an external tracker must not both be fed blindly; the keyed channel activates only when configured, and each card is deduped per channel by its marker.
