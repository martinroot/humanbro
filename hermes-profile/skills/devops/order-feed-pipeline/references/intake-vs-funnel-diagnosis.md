# Diagnose stalled order flow: intake vs funnel

Use this sequence when someone reports that orders are not arriving. Locate the break between source polling, ingest, classification, readiness, and notification before changing configuration.

## 1. Prove the collector is alive

- Check the canonical portal task, the listener on `:8701`, and the current `cycle_state.json`; keep exactly one live listener and do not kill a reloader/parent merely because more than one `app.py` process exists.
- Read the newest `cycle_journal.jsonl` entries and `portal_run.log`/`portal.err.log`. Confirm recent per-source poll events, errors, and a completed search tick. A scheduled task marked Running alone does not prove the cycle thread is alive.
- Treat health files as independent monitors: inspect their modification time and compare them with the live journal and DB timestamps before relying on them.

## 2. Separate re-ingest counts from new listings

- A connector's “ingested N” often counts cards submitted for upsert, including duplicates; it is not a count of newly created orders.
- For each source compare distinct `(source, external_id)` counts and `created_at` with `updated_at`/`parser_updated_at`. Fresh parser timestamps with an unchanged ID set mean the connector is reprocessing the same cards; determine whether the source truly has no new listings or the visible page is stale.
- For browser-backed feeds, confirm the current rendered page is fresh. `Page.bringToFront` only changes focus; it does not refresh content. Use the existing tab and respect the per-source reload limit (at most once per 10 minutes).

## 3. Verify each database and the portal view

- Read status counts in `market_projects` by source and status, and verify corresponding `(source, external_id)`/`order_number` rows in `orders`; do not infer success from a connector's stdout alone.
- Read `GET /api/unified-orders?state=all` and its `kanon` counters. If one request times out, retry with a realistic deadline and check the live server log before calling the portal unavailable.
- Interpret the funnel by stage: `new` needs pass 1; `white` needs pass 2; `ready` is eligible for the ready notification. A healthy ingest does not mean an order is already ready.

## 4. Diagnose model and notification bottlenecks

- Compare DB backlog/statuses with the latest `mll_log.jsonl` and `mll2_log.jsonl`, plus loop errors in `portal_run.log`. A stale success log with a growing `white` queue points to pass 2; `new` rows point to pass 1.
- Inspect model responses for a top-level `error` before indexing `choices`: OpenRouter can return HTTP 200 with an error object such as `error.code=429`, which otherwise appears as a misleading `KeyError('choices')`. Log only model/provider, error code/type, and a bounded sanitized message; never log authorization headers or API keys.
- If logs do not expose the provider failure, a controlled probe may call the pure batch-scoring function on a synthetic card (not the DB-writing `прогон()`), using the configured model/provider. Note that it may incur usage cost. Do not silently change model, provider, fallback, or batch cadence; confirm available endpoints and cost first.
- Treat JSON decoding failures separately from provider errors. Do not mark a batch processed when the response is malformed; preserve the queue and report the parse failure.
- For ready notifications, read `TG_ORDERS_CHAT` without printing `TG_ORDERS_TOKEN`, compare it with the intended destination, and inspect the notification flag. A `notified` flag means the API call was accepted; it does not prove the user is looking at that chat. Never redirect notifications without explicit authorization.

## 5. Verify recovery

After an approved fix, confirm the next live cycle event, newly created unique IDs (not only updated rows), the status transition through pass 1/pass 2, and the configured notification result. Keep source polling read-only; do not submit marketplace offers as part of diagnosis.
