# Marketplace detail enrichment cache

Use this workflow when a feed card is abbreviated but scoring or the operator needs the full project brief.

## Procedure

1. **Keep the source parser thin.** Read the feed in its authenticated, already-visible marketplace context, preserve the stable source ID and canonical project URL, and use the exchange-specific detail route/selector only after a live DOM probe confirms it. Never infer a buyer profile from the seller header, names, or unrelated page links.
2. **Choose cache key and freshness before fetching.** Key by the marketplace's stable project ID (the source is implicit in a per-exchange cache filename, otherwise include it in the key). Select only missing or expired IDs with a bounded per-tick cap. Reuse the existing per-exchange timestamp guard so a feed reload occurs at most once per ten minutes.
3. **Fetch each selected detail once per batch, sequentially.** Check `response.ok`, require the expected non-empty full-description node, and collect attachments only from the already-verified detail HTML. Keep only description text and verified attachment metadata/paths in the cache; do not persist whole raw HTML pages.
4. **Persist successful entries and failures differently.** Cache successful detail text and attachments with `fetched_at` and a TTL. On a failed response or missing detail node, record a per-ID `retry_after` backoff; this prevents one inaccessible project at the head of the feed from consuming the entire per-tick budget forever. Write the cache to a temporary file and rename it into place so an interrupted tick does not corrupt the prior snapshot.
5. **Do not mislabel a summary as a full brief.** When the evaluator requires full text, emit only orders whose cache entry is non-empty and fresh. Let the bounded batch advance through the feed over successive ticks; do not re-fetch the same fresh IDs, and do not send card excerpts to Pass 1/Pass 2 as if they were complete.
6. **Verify the mechanism before live use.** Unit-test reload timing, fresh/stale selection, per-tick cap (including zero), fresh-cache substitution, and failure backoff; run the relevant `bun test` file and build the connector. Then run one controlled poll against the user's visible authenticated tab, capture only counts/field presence, and read back the exact ingested source-qualified row before claiming a marketplace source is live. Never create synthetic production projects to test the API.

- **A feed-side `fetch` of a detail URL can return a client-rendered shell.** A SPA exchange may answer the direct detail URL with ~6 KB of template whose `<title>` ends in `_stub` and which contains no order data. Treat a suspiciously small HTML response (and a title matching `_stub`/`loading`) as "not enriched": open the detail in a tab, wait for the real description node, and serialize `document.documentElement.outerHTML` from the rendered DOM instead of `fetch`-ing the URL. Log the HTML length and the attachment count when debugging so "0 files" is distinguishable from "never looked".
- **Double-escaped regex is a silent feature kill.** `/^\\d{4,}$/` is not "digits" — it matches a literal backslash followed by `d`. A guard written that way never fires, so the code beneath it (attachment collection, enrichment, filtering) never runs and logs nothing. Verify regex guards in a REPL (`bun -e 'console.log(/^\\d{4,}$/.test("22540726"))'`) before debugging the code under them, and add a unit test that asserts the guard accepts a real ID.
- **Element selectors that match an empty placeholder cause premature DOM capture.** A broad `[class*='attachment' i]` can match the "attach file" control before real attachments load; narrow the wait to the order-description container and add a short settle delay so network-loaded images/files are present before serialization.
- **Track attachment dedupe by path, not full URL.** The same file commonly arrives both as a link and as a preview thumbnail (`?size=200`); keying on the full href saves two copies. Compare `pathname` without query.

## Helper contract

`marketplace-detail-cache.ts` provides `shouldReloadFeed`, `pendingDetailIds`, `readCachedDetail`, and `recordDetailFailure`. Keep cache TTL, per-tick cap, and retry delay explicit in each connector; test the choices against that exchange's feed volume and normal cycle cadence. `readCachedDetail` is a presentation helper, not proof that an entry is fresh—check that the cache entry has a non-empty description and is within TTL before including the order.

## Pitfalls

- **Check HTTP status before parsing HTML.** Login redirects and error pages can still return parseable markup; without the status and expected-node checks, the cache can permanently record a login/error page as a valid brief.
- **Apply backoff per project, not per feed.** One repeated detail failure must not starve later IDs; a global pause hides healthy projects behind the broken one.
- **Advance by uncached IDs, not `slice(0, N)` of the feed.** A fixed first-page slice refetches the same projects each tick and never reaches later cards.
- **Keep HTML and customer PII out of the detail cache.** Store only the normalized fields needed downstream; smaller, lower-sensitivity cache files are easier to protect and invalidate.
- **Treat unit tests and a successful bundle as code verification only.** Selector correctness, authentication and actual ingest require a controlled visible-browser poll and exact-row readback.
