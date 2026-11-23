---
name: dispatcher-operator-ui
description: Use when building dispatcher-backed operator UIs.
---

# Dispatcher-backed operator interfaces

Build operator consoles that browse real source records and launch selected workflow steps through one durable dispatcher.

## Always-on rules
- Preserve an existing production route when the request names a versioned replacement route; implement and verify the new route separately before proposing cutover.
- The dispatcher is the sole writer and execution owner. The UI creates a run scoped to one selected record and stage; creating a run must not execute it.
- Make the global system log the default tab, independent of selected order. Show one unfiltered chronological table with time, phase, order, skill, tool, and description. Keep per-record inspection and selective tests in a separate DEBUG tab; never make the system log depend on a selected order.
- Default isolated/selective test runs to DEBUG. Require a separate explicit action for exactly one stage; never auto-advance or batch selected orders. A production action may request a concrete order only when it inherently targets one; keep it separate from global log browsing and behind its explicit gate.
- For this user's JobLock portal, keep the primary system log dispatcher-only: read Control v3 events (including `_system`) and never merge the legacy `/api/log/live` feed or review-registry history into that table. Keep the per-order selector in the separate DEBUG/phase view; show any explicitly requested legacy inspection as a separate, clearly named view.
- Put the event chain in the dispatcher trace, not a parallel ad-hoc log. Persist allowlisted metadata only; redact chat bodies, credentials, and unrestricted payload text.
- Keep external side effects behind dedicated gates with idempotency and timeout reconciliation. A read that opens a marketplace chat may mark it seen; disclose that before enabling it.
- Render records, errors, and traces as text, not HTML. Treat all source content as untrusted.
- Gate destructive operator controls with an **exact typed confirmation** plus a browser `confirm`, and take a backup whose path is returned in the response before the first DELETE. Scope a "reset from scratch" to the funnel being restarted: preserve reference/foundation tables (skill catalogs, tags, profile templates) and verify post-reset row counts instead of trusting the DELETE call.
- When a reset clears live intake data, require the producer (parser/collector) to be stopped first — a running feed refills the cleared tables immediately and makes the control look broken.
- Do not call a page deployed or usable until the supervised service has restarted and the exact route plus its real-data API have been read back successfully. If only files or tests passed, report that distinction plainly.

## Embedding scripts and links in server-rendered pages (FastAPI + nginx prefix)

- **Do not put page JS inside a Python f-string.** JS template literals (`${...}`), `#` in object literals, and braces collide with f-string parsing and fail as `unterminated string literal`/`expression cannot include '#'` at import time. Keep JS in a plain module-level constant or a separate `.js` file read at render time, and split the f-string around it (`...f-string tail\n""" + JS_CONST + "\n</body>"`).
- **When inserting a section into a concatenated HTML string, verify nothing was swallowed.** An insertion between two string literals can silently drop a line — check for the form's submit button, closing `</form>`, and `<style>` wrappers in the RENDERED page, not just the source.
- **Bare CSS constants are not style tags.** A shared nav/CSS constant (e.g. NAV_CSS) is raw CSS; embedding it outside `<style>...</style>` prints the stylesheet as page text. Wrap it.
- **Make internal links prefix-aware, and verify through the public URL.** Behind nginx (`/portal/` → upstream `/`), links built as `/orders` and fetches to `/api/...` miss the proxy and read as broken. Send `proxy_set_header X-Forwarded-Prefix /portal;` upstream, derive `base = request.headers.get("x-forwarded-prefix") or ""`, prefix every absolute link and JS fetch with it, and verify the rendered `href`s from the PUBLIC address (they must carry `/portal/`).
- **Fake Request scopes need every key downstream code touches.** A hand-built `scope={"query_string": b""}` without `"headers": []` dies with `KeyError: 'headers'` the first time anything reads headers.
- **If a page handler is shadowed, the rendered page lies about your changes.** `app.py: import orders_page` + `orders_page(request)` calls the MODULE, not the handler function — the old unpatched route still answers and edits appear to do nothing. Call `module.handler(request)` explicitly.
- **Never build JS click handlers by replacing the first occurrence of a shared marker string** — a line like `setTimeout(refresh, 60000)` appears both inside the function and at top level; replacing the first occurrence nests the handler inside the refresh function, so it registers only after the first tick and re-registers every tick. Insert at an unambiguous anchor or rewrite the block.

## Procedure
1. Confirm the requested route and scope. Inspect the current route, dispatcher APIs, source snapshot schema, actual group/kind values, current mode/pause, and service supervisor before editing.
2. Make the global new-contour system log the primary/default tab and independent of order selection. Read only Control v3 events; render exactly time, phase, order, skill, tool, description. Keep selected-record browsing and selective checks in a separate DEBUG tab. Poll the event API continuously and include dispatcher failure/exception events as sanitized visible rows.
3. Define a stage catalog per record contour. Expose only adapters that are implemented and tested; show unsupported modes as unavailable rather than implying they run.
4. Add each stage to the dispatcher scenario allowlist and adapter registry. Create a fresh DEBUG run with a versioned scenario and selected record key; advance it only through an explicit one-step command.
5. Display run status and its ordered dispatcher trace. Each separate run gets its own run ID and event chain; revalidate the selected record and safety gates when the step executes.
6. Test with temporary databases and stub executors before using real records. Verify scenario validation, adapter redaction, one-step isolation, API payloads, trace display, and UI script syntax.
7. Restart only the portal process using its established supervisor; verify `/log_v2`, `/api/log/system`, and `/api/log/system/state` against the running service. If dispatcher-loop code changed, separately restart the dispatcher supervisor only after confirming there are no active LIVE runs, then verify a fresh scheduler heartbeat. Use temporary DEBUG fixtures for execution tests.
8. Report what changed, what the live route returned, which tests ran, and which stages remain unimplemented. Never use a live marketplace action as a UI smoke test.

For the JobLock Control v3 and Windows portal workflow, see `references/joblock-control-portal.md`.
