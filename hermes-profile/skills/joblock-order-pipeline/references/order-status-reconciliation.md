# Order status backlog reconciliation

Use this when the portal appears to have a large `new` queue or the feed and execution list disagree.

## Procedure

1. Read the portal projection first: GET `/api/unified-orders?state=all`; group returned rows by `kanon`. This is the view the user sees, not necessarily the raw MySQL status.
2. Read the two MySQL status distributions separately: `orders.status` and `market_projects.status`. Then join `orders.number` to `market_projects.order_number` using binary comparison (`BINARY o.number = BINARY mp.order_number`) to avoid MariaDB collation conflicts. Count mismatched pairs by both statuses and source.
3. Measure the actual pass-1 queue from `market_projects`: rows with `status='new'` and no `mll` verdict in `analysis_json`. `orders.status='new'` alone is not proof of unprocessed MLL work; pass 1 selects `market_projects` rows.
4. If linked marketplace rows are `dublicate` while orders remain `new`, use the idempotent duplicate-sync helper in `mll_filter.py`. It must only change linked `orders.status` values in `new`, `white`, or `black` to `dublicate`; preserve ready, running, done, failed, and needinfo records.
5. Keep display semantics explicit: render `dublicate` as Duplicate/Closed, and `needinfo` as Waiting—not New. Do not hide duplicates in the all-state view; provide a distinct filter/label.
6. Read counts back from both tables and GET `/api/unified-orders?state=all` again. Confirm the stale `new`/duplicate mismatch is zero and inspect any remaining canonical `new` rows before claiming the queue is empty.
7. After Python page or worker code changes, restart only `\JobLock-Portal` using the verified task wrapper; confirm a new listener PID, HTTP 200, and that the rendered `/orders?state=all` page includes the expected status labels.

## Guardrails

- Never bulk-mark every new order complete to clear the page; only reconcile rows whose linked `market_projects` record proves they are duplicates.
- A transient MLL provider/API error is a processing error, not a duplicate or a reason to alter order status. Check the MLL log and retry through the normal loop.
- Keep DB credentials out of commands, logs, and this procedure; load connection settings through the portal's `app.DB` configuration.
