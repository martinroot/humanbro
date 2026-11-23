---
name: marketplace-intake-routing
description: "Use when forwarding marketplace jobs to APIs; verify intake."
metadata:
  hermes:
    tags: [marketplace, parser, api, ingestion, idempotency]
---

# Marketplace project intake

Use this workflow when a parser feeds marketplace projects into a management/agent platform.

## Unified interface for several enabled exchanges
When several exchanges feed one platform, the operator card, response form and
menu must be identical across them — see `references/unified-market-interface.md`
for the one-adapter rule, the top-to-bottom button order with technical controls
tucked away, the MLL-driven "build a pipeline from the skill base" option, and
the end-to-end check that catches a green menu over a dead feed.

## Procedure
1. Confirm the exclusive sink and feed boundaries. Forward project feeds only; keep seller-service listings read-only. Never dual-write one project to independent backends. Read the configured sink from the runtime config BEFORE starting a feed process, not after the first batch lands: a process started with the wrong sink writes a whole batch of projects into a backend whose rows cannot be cleaned from the platform you were asked to work in, and the cost of the mistake scales with how many listings the feed had. **An explicit owner statement about which product this is overrides the configured sink** — when the owner says the work belongs to one product and names another as a different project, run only the named one, and correct the stored sink setting so the next process inherits the correction instead of the stale value.
2. For intake-only routing, forward every newly discovered open marketplace card without local agent classification, quality scoring, price/proposal thresholds, or description-based duplicate suppression. Set request `status: "new"`, omit `agent`, and deduplicate only by stable `source + external_id`. Do not backfill historical IDs unless explicitly asked. Exclude local `source="sandbox"` fixtures before POSTing to a production sink; excluding them only from reports is too late because fixtures become durable production rows.
3. Preserve the source ID exactly. Send the observed title, description, URL, price, currency, and factual source status; never invent category, agent, or content. Exclude credentials, cookies, and unrelated personal/payment data.
4. Use the API client’s documented batch size and retry policy. Keep parser sink exclusive; marketplace bids remain separately gated by explicit per-listing approval.
5. Re-check downstream bid readiness on every sink switch. The parser’s verdict vocabulary and any bid-side filter must be drawn from the same set: a route that emits a different verdict string, or a readiness check that demands a locally created agent-backed order, silently produces zero candidates while the feeds report green. Treat a sink change as a bidding change and say so explicitly instead of leaving offers quietly disabled.
6. After POST, read back the exact `source + external_id` and verify the stored status is actually `new`. An HTTP 200 or returned order number alone does not prove the backend honored the intake contract.
7. Treat HTTP 5xx/timeouts as ambiguous commits. Query the incremental list and exact project before retrying; the server may commit before failing to serialize its response. Do not blindly repeat POSTs or invoke global status-reset operations.
8. If the record exists but agent ingestion reports no match, treat transport as successful and leave assignment/recommendation to the management UI. Track `agent_slug`, `suggested_agent_slug`, order/status, price, and exclusion metadata when the API supplies them; do not convert a recommendation into “take into work.” A card the platform cannot map to an agent is a kept card, not a failed ingest: persist it in a state that says an agent is still missing, so the project stays visible and assignable instead of disappearing.
9. Poll using the last successfully processed `updated_at`; normalize timezone-less timestamps only according to a verified server convention. Treat absent fields such as candidate category as absent—never synthesize them.
10. Patch `source_status` only when the marketplace’s actual open/closed state is observed; do not make it reflect Fabra acceptance or agent assignment.

## A repeated failure becomes a mechanism, not a remembered step

When the same trap bites twice, put the check **inside the tool that performs
the action**, so it exits before the action instead of after it. A note in a
report is a promise to remember; a gate in the tool is a guarantee. The
checks that belong there are the ones that protect something irreversible —
a publish, a submission, a spend.

## Append-only `.jsonl` files are state, not logs

In these stacks the per-feed `*.jsonl` files carry the **dedupe set** — they are read at startup to answer "have I already forwarded this listing?" Deleting them as "just logs" resets that set to empty, and the next run re-forwards every listing the history knew about. On a multi-thousand-row feed that is a duplicate storm against a platform you were told to ingest incrementally.

- Classify before deleting. Plain rotation output (`*.log`, `*.out`, `*.err`) is disposable; a file a component reads back to rebuild its dedupe set is not. Purging destination records does not authorize resetting parser cursors or dedupe state when the intended next run is new-only, because that would replay already-seen listings.
- Rotating a log that a **supervisor** writes its stdout into kills the supervisor with no error surfaced, and a dead supervisor is indistinguishable from a service that refuses to start. Check the supervisor is alive after any log cleanup, and restart it explicitly.
- When asked to "remove all logs", separate the two categories, act on the disposable one, and name what you deliberately left with the reason — do not silently keep it and do not silently delete it.
- **A deliberate clean start IS a reset authorization; a routine purge is not.** When the owner asks to clear the projects and re-run the feeds into an empty base, the dedupe set must be reset too — otherwise the run imports nothing and looks like a broken sink. Say plainly that the reset re-forwards everything the history knew about. When no such instruction exists, keep the set: a purge of destination rows alone does not license replaying the whole history.

## Replacing a project dispatcher or control plane

Use a staged shadow-to-cutover workflow when consolidating existing project databases and business loops under a new dispatcher:

1. Inventory every authoritative database, status owner, writer, consumer, supervisor, and external-action boundary; collect row counts, raw status counts, freshness, and stable keys with read-only queries before changing a service.
2. Keep the old system authoritative while building the new app and data store separately. Import with source-qualified idempotency keys, preserve raw statuses/history, and verify counts by source, record type, and status. Do not copy browser sessions, passwords, proxy credentials, or account secrets; never reset feed dedupe state for an ordinary migration.
3. Call a read-only import a **shadow snapshot**, not a completed integration: data visibility alone does not transfer transition ownership. Map every old transition and action to a dispatcher-owned stage before scheduling work. Keep one acceptance row per contour with its source of truth, autonomous writers, dispatcher stage, side-effect gate, exact read-back test and rollback path. A thin adapter that invokes a legacy runner while it still chooses transitions is not a transfer; do not mark cutover complete while any contour is only snapshotted or shadowed.
4. Prevent dual schedulers from claiming the same order. Rehearse each contour on isolated fixtures, preserve approval gates for bids/messages/publication/spend, and define rollback before pausing old writers or enabling the new scheduler.
5. Verify each vertical slice with a failing focused test, its passing rerun, then the full suite and an isolated end-to-end rehearsal. Do not report cutover, launch, or full integration as complete until the actual new process and downstream read-back verify it.
6. When the owner wants to operate from a log page, treat it as a monitor until its execution API is verified. Build a minimal isolated console: select one source-qualified order and one named stage, create a unique DEBUG run, advance only that run once per click, and display the ordered dispatcher event chain. Begin with read-only stages; gate each message, bid, publication and submission separately. Never substitute a whole legacy phase/queue cycle for a one-step action.

## A LOCAL portal as the sink
When the sink is a local portal that owns its own project table (rows in a local database instead of a remote platform API), see `references/local-portal-project-table.md` for the table layout and idempotency keys, the two-table write contract (a card must land in BOTH the work table and the project table or one of them is silently empty), the project-table UI the owner asks for, splitting one feed process per exchange, the clean-start teardown recipe, and how to verify the portal from OUTSIDE. `scripts/rehearse_cycle.py` is a runnable full-cycle rehearsal (publish → publish-check → parse → queue → respond → work → deliver → verify by re-reading → report); `scripts/agent_coverage.py` reports the share of stored cards that got a live agent and groups the misses by reason.

## Choosing which orders to act on
A feed of orders is not a work list. Deciding which orders are eligible, which are out of scope, and how an eligible order travels to its end state without disappearing is its own layer — see `references/order-triage-and-pipeline.md`. It covers the out-of-scope gate (reviews for a competitor, negative-review orders, referral fraud, engagement farming, account sales, moderation circumvention) and why the gate runs **before** platform recognition; the order-text parsing traps (a price read as a count, a numbered list read as a count, a star rating read as a count, the platform name read before the generic phrase, short city forms matching inside ordinary words); how a **client brief can constrain WHEN** the work happens, not only whether — an activity-then-route-then-wait-then-publish order with a stated interval between two postings, parsed into fields and checked before the irreversible step; how a general-purpose classifier and this business's own gate can disagree, and the split of authority that resolves it — the business gate owns scope, the general classifier still owns genuine access demands (login, password, the client's account, a phone), so neither a blanket override nor a blanket refusal is correct; why one parser serves both the gate and the account picker; the state list in which an order never disappears and «no account available» is a state rather than a failure; why a missing card link or review text blocks **publication** but not the **response**; dry-run by default; and writing the gate's verdict into the field the existing bid queue already filters on, so the filtering happens inside the mechanism that is already there. This gate is **bid-side**: intake still forwards every card, and the decision to respond to one is made downstream of intake, where the client's own rules and the pool's capabilities are known. It also covers the case where the shared queue's own price floor and ordering hide the whole cheap tier of this business — the symptom is a full feed and an empty work list — and the answer is a separate collector with the business's own filters, not a change to the shared queue.
When the owner asks why few projects arrived, do not answer "the filters cut them" — prove which stage lost them, in this order:
1. **Reconcile first.** Count unique `source + external_id` in the parser's own dedupe logs and compare with rows per source in the destination. Equal counts mean nothing was filtered at intake; the loss is downstream.
2. **Agent-assignment coverage.** A card that reached the DB without an agent is a *matched-but-unassigned* card, not a missing card. Report coverage as a share of stored cards and group the misses by reason.
3. **Feed slice.** A feed can hand out one screen of cards with no pagination; the count on the exchange is not the count on the page.
Only after those three checks may you attribute a gap to intake filters.

**A keyword→agent table must contain only agents that can actually take the work.** Pointing a marker at a draft/non-live agent silently yields "no agent" for every card of that theme — the whole class disappears into a "needs assignment" state while the feed looks healthy. Keep the table in sync with the live agent list, and give non-Russian feeds their own markers in that language.

**A control that looks like "load more" may be an advertisement.** Read the control's `href`/target before clicking: a referral-program link navigates the tab off the feed, and the parser then reads an empty page and reports zero cards. After any navigation triggered by a click, re-assert that the tab is still on the feed route.

## Browser-driven actions against exchange forms
When the workflow extends from intake to acting on the exchange (submitting an offer, filling a bid form), see `references/exchange-form-filling.md` for the fill mechanics and failure triage. Two rules apply here: a form field write that is swallowed by `.catch()` is a failed submission, not a partial one — report it; and when a run ends with an unexplained failure, say which of the causes was ruled out and which remains open instead of implying the path works.

## Recurring checks that drive the pipeline themselves
When a scheduled check pulls from the queue and reports back, see `references/self-healing-verification-loops.md`. The governing rule: a check that writes the very state it reads is a finite fixture, and the dangerous outcome is not an error but a **green report that no longer verifies anything**. Track what the run consumed and put it back in the same run, treat an empty queue as a harness failure rather than a clean bill of health, and report the fixture size so a number that only descends is visible. Verification that destroys its own inputs is a silent outage, and it is worse than a crash because nothing pages anyone.

## Rehearsing the cycle on a local exchange
When the loop must be exercised repeatedly while it is still changing, stand up a localhost exchange rather than spending reputation on a live board — see `references/local-rehearsal-sandbox.md`. It covers which failure modes a sandbox must reproduce to be worth its cost (listings that close mid-run, clients who answer later, delivery that is not the end), why the double must render the state it accepts, and how to assert per-brief outcomes. Two rules belong to the workflow itself: a capped, price-ordered queue read silently hides the cheapest work, so confirm the read's ordering and cap before concluding a listing is missing; and a step whose read-back disagrees with the step that caused it means one of the two is lying — establish which before editing either.

## Hand-driven dispatch to a management platform

Some platforms create the work item themselves on a score threshold, and park everything below it. When the parser-side dispatch endpoint exists, it is the **fallback for what the automatic tier skipped**, not the primary path — say so, so nobody wires the backlog into a loop expecting steady state.

- **A 2xx dispatch does not mean a work item was created.** Branch on the body: a returned item number means created; an explicit `already` flag means one existed; `ok: false` with a `need_agent` marker means no agent was assigned and the caller must name one. A bare `ok: true` with no item number is not success — do not infer `already` from a missing number.
- Treat the two rejection codes as different jobs, not as generic failures: `409` is a stop-filter and must never be retried, `400` naming an unknown agent means the recommended slug is not in the catalog and an explicit one is required. Only 5xx and transport errors are worth repeating.
- **An agent missing from the catalog breaks dispatch, not just the catalog listing.** When a recommended slug belongs to an agent that the catalog filters out, dispatch fails on the very projects that need a hand. Fix the catalog exposure first; do not substitute a plausible-looking slug you cannot see, because the work item binds to whichever agent you named.
- Keep hand-driven dispatch at one identifier per invocation. A parked backlog is large, and a batch runner turns it into unattended work — the same auto-action the owner gates by explicit approval.
- A dispatch that returns HTTP 200 with a redirect away from the form is unconfirmed, not sent; see `references/exchange-form-filling.md`.
- **A queue that reports "sent" consumes the listing forever.** Where the bid queue hides already-acted listings via a `UNIQUE(source, external_id)` bid row plus `NOT EXISTS`, *any* recorded report — including one written by a test-mode run whose form never actually left the browser — removes the listing from the queue permanently. Confirm real delivery before reporting, and expect to purge the queue table between end-to-end test runs; re-running a queue against its own test output otherwise looks like the pipeline is stuck.
- Replaying a send is safe only if the report endpoint is idempotent (upsert on the same unique key). Verify that before using retries to explore the chain.

## Running the work on a board across specialist profiles
When orders are executed by named profiles on a durable board rather than one agent, see `references/kanban-multi-profile-execution.md`. It covers creating worker profiles (description is the routing surface; clone config, never messaging channels), the dispatch cycle, why review cannot be requested from a finished task, and the acceptance rule that matters most: **every review criterion must be phrased so that a specific failure makes it false** — a file that exists, is the right format and the right size passes even when it is byte-identical to the input. The second profile is the point, not overhead.

## Porting a remote queue onto a local stack

When the queue lives on another host and a local copy is needed to exercise the cycle end to end:

- **Align table collations across the two tables you join on.** Tables dumped from MySQL 8 carry `utf8mb4_0900_ai_ci`; a table created by an older MariaDB gets a different default, and a comparison across them fails at runtime with "Illegal mix of collations" while the schema itself looks fine. Convert both to one collation before writing any query.
- **Register routes in a function, not module-level decorators, when the module is imported by the app it extends.** A module mounted at the end of the main app file evaluates its decorators before the app object exists, so they fail with `NameError` on the first import. Export an `install(app, db, now)` that assigns dependencies and attaches the routes, and call it from the host app.
- Keep the guard token check strict — compare the header to a configured token and fail when the token is unset, so a missing secret cannot read as a passing check.

## Reporting
### The business loop outranks the repair
The owner's income comes from orders being answered and work being published, so a
session that drifts into a long cleanup-and-debugging detour while orders sit
waiting for a reply has already lost the day. Order the work by revenue
proximity: **read the client's answer and respond first**, then take new
eligible orders, then repair the machinery, then clean up. When a repair is
needed to make the loop work at all, make the smallest repair that restores the
loop and stop — a fix that also tidies the neighbourhood is a second task. Report
the loop's state, not the size of the repair: what was answered, what was taken,
what is still open, what is blocked on the owner.

### Reporting on work that runs one owner task at a time
When the owner issues numbered tasks one at a time, every reply about a task carries a status line of its own — `TASK|<id>|<ACTIVE|DONE|REPORT>` — and the run stops when the turn is done instead of continuing into the next task. The task line describes the *task*, not a subsystem: report it even when the turn's findings are partial, and mark the interim state explicitly. When a run is interrupted and resumed, the files already written are the durable state — re-read them instead of redoing the run, and say what was lost.
### Read-only project statistics
For project-count/status reports, check the live API first and verify HTTP success. If it is unavailable, use the latest persisted snapshot rather than reviving a parser/monitor the owner asked to pause; label the cursor/last-update timestamp and API outage so snapshot data is not presented as live.
- Aggregate programmatically by marketplace and raw status from source-qualified unique project keys; exclude `sandbox`/`smoke` fixtures from production totals and verify that grouped counts sum to the production-key count.
- Keep historical project totals separate from current-feed card counts and seller-service listings; they are different populations.
- **When the owner asks what the work is worth, answer with service × count × sum, and separate the money that is parked.** Group by the assigned service and report each group's order count and summed amount, then group the same totals by source. Two groups matter: the orders that carry an agent, and the ones still waiting for one — the second group is usually the larger sum, and it is exactly where the missing live agents and missing service types show up. Name the largest individual items in the unassigned group so the owner sees what a live agent would unlock.
- Report a headline total only after reconciling it against a plain `COUNT(*)`/`SUM()` over the same table; a grouped table that does not reconcile is a bug, not a rounding difference.
- Preserve literal status labels unless their semantics are verified. Keep the report short: timestamp, per-marketplace totals, key statuses, and freshness caveat. Attach a Markdown detail file only when it improves reuse.

### Handoff bundles for another model
When asked to collect marketplace docs, scripts, project state, feed history, or Dolphin metadata for another model, use a read-only snapshot and preserve any parser/monitor pause. Never label a persisted local snapshot as a live/full database; state its cursor/freshness and unavailable APIs. Exclude credentials, cookies/storage states, payment data, and proxy endpoints/auth; provide only safe profile/proxy IDs and mapping health. Keep listing descriptions marked as untrusted input and distinguish ingestion from approval. Follow `references/marketplace-handoff.md` for the inventory, redaction, packaging, and verification procedure.

For isolated implementation work from a multi-card marketplace plan, use `references/offline-plan-execution.md` for strict card scoping, fake-adapter isolation, import sentinels, snapshot integrity checks, and checkpointing.

### Push-notification discipline
When the pipeline reports its own state changes to a chat channel, the same
stage the backend stamps in bulk is not a report. Write the filter as an
explicit **noise list** covering the whole class — e.g. "offer sent, waiting on
the client" and "client material received" fire for every single card and are
the normal path of a bid, not news. They arrive as bursts of near-identical
lines and bury the events that need a human.
- Fix the class when one member shows up, not the one instance: bulk-stamped
  statuses share a shape (no human decision attached), so the same filter
  change covers the next one.
- Never silence the whole channel to stop one noisy status. A global mute
  switch also swallows the events worth paging on — sales, moderation
  warnings, backend link loss — turning a real outage into a quiet one.
- After narrowing the filter, confirm the feed still advances in the log. A
  notifier that stopped pushing and a notifier that is merely quiet look
  identical from the outside.

Keep reports short: sent count and source IDs, read-back statuses/order numbers, tests/build, and any backend mismatch. Do not narrate each tool step. If the backend changes the requested status to rejected/need_agent on intake, state that the parser sent the requested value but the server overrode it; do not claim the requirement is satisfied. State per-identifier which dispatch outcome actually occurred (created / already / stop-filtered / no agent) rather than a single dispatched count, and name any response field the documentation does not describe.

**Never conclude a platform lacks a feature from the code you can see.** Absence from a config directory, a database, or a tool-search result is evidence about the code, not about the product — a feature may be documented, ship in a sibling package, or live under a name you did not search for. Before telling the owner "it has no X" or proposing to build your own, read the product's own documentation and run its CLI help. This is not pedantry: a shipped board, scheduler, and profile system that a code-level search reports as absent will be rebuilt from scratch by mistake.

When a scheduled check is involved, report what it measured rather than what it intends, and state plainly when something was not verified. Never dress an untested sequence of attempts up as a working method: if the loop could not get a stage green, say which stage and that it remains open.
