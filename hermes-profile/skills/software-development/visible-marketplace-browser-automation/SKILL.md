---
name: visible-marketplace-browser-automation
description: "Use when a user must see or authenticate Windows Chrome."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [windows, chrome, cdp, playwright, marketplace, login, browser-automation, antidetect, dolphin-anty, proxy]
---

# Visible Windows marketplace browser

Use this skill when browser automation must happen in the user's visible Windows Chrome rather than an isolated browser session. It is intended for marketplace inspection, manual login, and authenticated UI mapping before automation.

It also covers the neighbouring case where one shared Chrome profile is not enough: isolated anti-detect profiles (Dolphin Anty) and residential/mobile proxies, both of which still expose the same CDP surface the existing code attaches to.

## Reporting style for this user

He asks for work in terms, not essays, and says so plainly when reports run long. Lead with what changed and whether it is verified, then stop. Concretely:

- **Answer the question asked, at the length asked.** "What can that skill do?" gets a compact list, not a walkthrough of how it was built.
- **When he asks "why so few?", answer with the arithmetic, not with a plan.** Compare what the sources yielded against what landed in the store, per source, and say which of the two is the smaller number and why. A shortfall has two candidate causes — the filter dropped it, or the source never had it — and only counts settle it. If the filters were removed and the shortfall persists, the answer is the source's ceiling, not the filters.
- **State where the data was actually filtered, and where it was not.** "Are reviews filtered out in advance?" deserves a direct yes/no with the evidence, e.g. the number of review-type cards that landed and their share of the total.
- **Do not re-narrate the procedure you just ran.** He can see the tool calls. A summary of the process is filler.
- **Keep the bug-hunt detail, drop the narration.** A finding like "the profile's proxy pointed at the one dead port" is exactly what he wants; the sequence of greps that got there is not.
- **State corrections plainly and briefly** — "my diagnosis was wrong, it was GET not POST" — then move on. Do not append an apology paragraph.
- **Cap a status report at what changed, what is verified, what is left**, and name the decision you took on his behalf so he can overrule it.
- **Identify the backend from the environment, not from the request's vocabulary.** A word like "projects" or "Fabra" can name a component that is not the one in front of you; if the machine, ports and tables point at a different stack, that stack is the target. Confirm the target before a bulk write, because a wrong target makes the batch unremovable from the surface the owner is looking at.
- **"Started it" is not "it works".** When the ask is to run a collector, prove the data landed: read the rows back and report the actual count and names, and name the one thing that is still unproven.

## Procedure

0. Before manual UI testing, pause **every** worker that can drive the shared visible Chrome — the parser, the detail collector (e.g. `wz-detail.ts`), the chat monitor, and in-process portal threads such as `order-details`. **A pause flag or a single process kill is not a pause on this stack**: a supervising keeper respawns the parser, scheduled tasks relaunch it, and a mode switch to `execute`/`respond` does not stop the detail worker or portal threads. Verify by command line that none remain and that only the tab you need is open before starting UI work. See `references/parser-pause-resume.md` for the verified stop/start commands and `references/kwork-portfolio-upload.md` for the portfolio-load case.
1. Prefer the project's existing visible-browser holder over an isolated browser tool. For the JobLock browser-automation tree, run from `C:/Users/Administrator/browser-automation`:
   ```bash
   bun hold.ts
   ```
2. Verify the holder exposed CDP before attaching:
   ```bash
   python - <<'PY'
   import urllib.request
   with urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=10) as r:
       print(r.read().decode())
   PY
   ```
3. Navigate the already-visible window through the project's attach helper, then exit the helper process without closing the browser:
   ```bash
   bun -e 'import { attachToVisible } from "./browser.ts"; const ctx=await attachToVisible(); const p=ctx.pages()[0] ?? await ctx.newPage(); await p.goto("https://example.com/", {waitUntil:"domcontentloaded"}); console.log(p.url()); process.exit(0);'
   ```
4. If the user still cannot see the window, do not keep spawning hidden copies. Have the user close ordinary Chrome and launch a dedicated visible profile with:
   ```text
   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-profile" --start-maximized --no-first-run --no-default-browser-check
   ```
   Then verify CDP again and attach.
5. When a page redirects to login, inspect only public content and wait for the user to authenticate in the visible profile. Never guess or type credentials.
6. After authentication, map the actual DOM and actions before writing automation. Separate public feeds, offer forms, seller dashboards, and CRUD/status pages; do not infer seller capabilities from a public project page.

### Testing live-connected code safely

Follow the TDD skill for RED→GREEN, and isolate every external side effect before invoking a test:

- Before calling a cycle, worker, or callback entry point, inspect its transitive calls. Mock all feed pollers, `subprocess.run`, HTTP/ingest clients, and DB connections; exchange toggles default enabled, so stubbing only the connector under test can still launch the remaining live pollers.
- Test mode and mode transitions with temporary state files plus fake process/CDP pages. Never switch the live `mode.json`, start a scheduled launcher, or call the production search tick from a unit test.
- Keep status GETs read-only: test schema migrations and `init_db()` with a fake or disposable database, not by letting a settings-page read create tables in the live database.
- After a test that may have crossed a live boundary, inspect logs, row counts, and active processes before claiming it was isolated. Do not delete valid ingested records to hide a test-side effect; report what changed and leave legitimate data intact.

## Marketplace mapping rules

- For Kwork specifically, see `references/kwork-offer-form.md` for the verified field map (Trumbowyg name field, vue-select deadline, 150-character description minimum).
- For one-off Kwork portfolio uploads, see `references/kwork-portfolio-upload.md`: stop the feed parser first, read the category catalog from `/portfolio/get_popup`, and gate «Сохранить» behind an explicit per-job `save: true`.
- For freeing the visible Chrome, see `references/parser-pause-resume.md` for the supervisor-aware stop/start order, the "parser dead" case that is really a browser without a debug port, the Telegram noise-status list, and getting a fixture into the price-ordered bid queue.

- Record the exact URL, redirect behavior, visible labels, form fields, submit controls, and post-submit confirmation.
- Treat an authenticated seller-management URL as a separate surface from project discovery and offer submission.
- Re-read the page after every state-changing action; a successful click is not proof that the marketplace changed state.
- Preserve Cyrillic by sending text from UTF-8 files or page `fill()` calls, not shell command-line arguments that may be re-encoded by Git Bash.

## Writing reliable selectors

- **Never use Cyrillic identifiers inside `page.evaluate`.** The function is serialized into the page, and non-ASCII identifiers do not survive that hop, so the browser throws `ReferenceError: <name> is not defined` at runtime. Keep every identifier inside the callback ASCII, including keys of returned objects; pass Cyrillic in as a function argument instead.
- **Test visibility with `getClientRects().length > 0`, not `offsetParent !== null`.** `offsetParent` is always `null` for `position: fixed` elements, so any dropdown, popover, or floating menu reads as invisible and gets filtered out of the candidate list.
- **Drive custom comboboxes with a real `locator.click()`, not `el.click()` inside `evaluate`.** Vue-select, v-select, and similar widgets open on genuine pointer events; a synthetic `click()` appears to succeed and leaves the list closed, which then looks like an empty dropdown.
- **Rich-text fields store their value in the visible editor, not the textarea underneath.** Trumbowyg and similar editors keep a hidden `textarea[name=...]` (often `tabindex="-1"`) as a sync target; filling it leaves the field visually empty and the submission rejected. Write `innerHTML` on the sibling `contenteditable` div, dispatch `input` and `change`, then read the textarea back to confirm the value propagated.
- Check per-field, not in one combined `try`: wait for each control separately and name the one that timed out. A single shared `catch` yields an unactionable "form did not open" and no clue which control to fix.

## Confirming a submission

- Treat an owner-only Telegram «Откликнуться» click as approval for that exact source-qualified order only. Submit only when both the exchange-specific setting and global `BID_MODE` are `live`; in Test, fill the form and stop before submission. A saved or edited draft alone is never approval.
- The prepare-draft click and the send click must be separate buttons with different labels and callbacks. Never label draft generation «Откликнуться»: the owner will click it expecting a submission and report that the reply did not send while the parser kept running. Name preparation «Подготовить черновик» (`apply:`) and reserve «🚀 Откликнуться» (`respond:`) for the actual submit.
- A mode switch is not proof of an isolated browser. Before submitting, enumerate process command lines and confirm no parser, detail collector, chat monitor or demand worker is alive; if any remain, return the draft and do not send. Exclude the visible Chrome and the portal process from the kill list so the owner's logged-in session and the control plane survive, then re-check CDP and portal endpoints.
- Tauri/Electron dialogs drop background key combos. Escalate to `delivery_mode='foreground'` or use the accessibility `set_value` action on Edit fields. For large or secret-bearing input, never pass the value as a tool argument — write a UTF-8 file, load it into the clipboard from that file, or use the file-picker button and type only the path.
- A closed form is not a sent offer. Verify the exact target by reading state back from the marketplace: the project page should show an own-response marker, or the offer list should contain the ID. Screenshot and a "button is gone" heuristic both misreport success.
- If the marketplace response or read-back is ambiguous, record an uncertain result and block retries until a fresh read-back or owner decision; a second submit can create a duplicate.
- Offer lists are often SPA routes reachable only by clicking the nav item, and a direct URL may bounce to the feed. When a guessed path looks wrong (`404`, or feed content under an offers path), read the nav link's real `href` from the DOM before concluding the section is empty.
- If the owner reports that an exchange denied access or blocked the network for suspected abuse, stop polling that source and disable its scheduler gate immediately. Do not retry aggressively, rotate IPs/proxies, or move the scraper to another account/network to evade the block; resume only after access is restored or the owner explicitly directs a compliant retry. On JobLock the off-switch is the exchange toggle, not a code change: `POST /api/settings/exchanges` with the exchange key set to `false`, then confirm the next cycle tick logs the source as disabled by setting and that no new error appears. **A block page renders inside a healthy authenticated tab** — the connector reports "no cards in DOM" while the tab exists and is logged in; read the page's visible text before blaming the parser, and do not reload-loop it (that is what turns a soft block into a hard one). `scripts/probe-visible-tab.ts <url-substring>` prints URL, title, readyState, link count and the first 600 characters of visible text over raw CDP, read-only — it separates "empty feed" from "challenge/block page" in one call.
- On a project that was taken mid-run, stop rather than retry; re-read the project state and report that the listing closed.

## Governance for many persistent exchange tabs

When the owner wants all exchanges open at once and automation that "returns to the needed tab", the design is: one persistent tab per exchange (role = domain), a monitor tab for the local feed page, and governance that closes anything unaccounted.

- **A scraper tab loses its marker the moment it navigates to the exchange** — an `about:blank?marker` placeholder survives exactly one hop. Find the persistent tab by DOMAIN (`pg.url().includes("<exchange-host>")`), bring it to front, read the DOM, and never navigate it away or reload it as cleanup.
- **Never hard-reload a live SPA feed to refresh it.** Reload makes the owner's tab flicker, drops the CDP session, re-runs every startup request, and on Workzilla leaves the feed on a stale snapshot. Refresh through the feed's own AJAX control instead: register `page.waitForResponse(r => r.url().includes('/list/open'))` BEFORE the action, click the site's refresh element from the DOM (Workzilla: `a` with text «Новые», dispatched as a `MouseEvent` via `page.evaluate`), await the captured response, and parse its groups as a flat list. A direct `fetch()` of the same URL inside `page.evaluate` returns only a tiny counter object — intercept the real XHR. Keep DOM scraping as a fallback; never escalate to reload because a capture looks empty. The same no-reload rule applies after a submit click: read «Согласиться» confirmation from the loaded DOM or the captured accept XHR; a post-submit `page.reload()` destroys the in-flight state and records a successful response as `uncertain`.
- **Clean up via pure CDP HTTP, not playwright:** `GET /json/list` to enumerate pages, `GET /json/close/<id>` to close. Whitelist by role (`tab=monitor`, one tab per exchange domain) plus the owner's exchange tabs; close strays and same-role duplicates. No bun/playwright spawn per cleanup tick.
- **When CDP is down, back off instead of spawning**: a collector that runs its scraper every 60 s against a dead port produces one failure log per minute and tab chaos on restore. After 3 consecutive connect failures, sleep 2 minutes and journal one entry.
- **A Chrome crash-restore window has a hung DevTools channel.** Signature: `curl http://127.0.0.1:9222/json/version` answers, a raw WS `Browser.getVersion` connects, but playwright times out at "<ws connected>". Kill the window (match by `--user-data-dir`), relaunch with `--remote-debugging-port=9222 --user-data-dir=<profile> --hide-crash-restore-bubble` (prevents the crash-restore cascade that reopens every lost tab), then re-attach.

## Tab lifetime under a supervising keeper

A long-lived keeper that prunes inactive tabs will close a form mid-fill, and the next `reload()` on that handle fails with `Target page, context or browser has been closed` — the tab is already gone, so retrying the same call can never work. Guard each feed's error path with a re-open of the tab, and declare the handle `let` (a `const` handle will not compile when reassigned). An empty `catch` around the re-open looks like a deliberate no-op and leaves the feed silently dead until the process restarts.

Take a tab lock before the first navigation and renew it for the whole fill. Cleanup whitelists only the monitor routes, so a localhost or sandbox board — anything not on the exchange hostnames — is always a candidate for closing.

- **A shared browser must never be left with ZERO tabs — it shuts itself down.** Closing the last tab ends the browser, and with it every script attached: the feeds, the chat monitor, the publisher. Symptom: the window is gone and everything reports timeouts, with no error pointing at the cause. Rule: before the last real tab is closed, open a blank guard tab (`about:blank`) and close the rest. The opposite shortcut — "just don't close the last one" — leaves a stale tab behind for the whole session.
- **Verify the guard helper actually opens a tab — a stubbed helper makes the rule a no-op.** The zero-tab guard is only as good as the function it calls: a helper that once opened the dashboard can be reduced to `return False` while the guard keeps calling it, so the invariant silently stops holding and the mode switch closes every tab. Cover the invariant with a test on a fake CDP (tabs list / close / open / alive) asserting the browser survives, and assert the required tab exists after the switch.
- **A mode/switch that needs a specific tab must FAIL LOUDLY when that tab cannot be opened.** Reporting success with zero or wrong tabs leaves the operator with a dead window and a lost job; raise with the target ID and let the caller roll the unit back to a safe state instead of continuing.
- **Tabs the collectors do not open themselves must be restored by whoever closed them.** An authenticated feed tab (a seller backoffice reached by login) is closed by any mode that prunes to one tab, and the connector reads it in place — it never re-opens it, so the feed dies silently while the browser and the scheduler gate look healthy. The mode that needs the feed restores it, idempotently (skip if a tab with that URL already exists).
- **A read-only script must REUSE the tab it needs, not create one per call.** For feeds, attach to the existing domain tab and do not create, navigate, or hard-reload a page on every search tick. For detail enrichment, compute uncached IDs first; if none are pending, create no detail tab. If needed, open at most one temporary detail tab, reuse it sequentially, and close it in `finally` — creating a blank detail tab before checking the cache still causes visible tab flicker each tick. When a tab must stay open for a long job (the client's task page), do not rework its helper to "not close" — look it up by URL among open pages and use it; only open a temporary one when none exists.
- **Opening a tab over CDP needs `PUT`, not `GET`.** `GET /json/new?<url>` answers `405`, so the script silently opens nothing and the next step reports a missing page. Method `PUT`, empty body.
- **Marketplace-domain allowlisting is not duplicate cleanup.** A cleaner that preserves every URL on an allowed exchange host will leave repeated feed tabs forever, because each duplicate looks active. Group canonical feed routes by exchange and keep the freshest feed tab; preserve the monitor, distinct order-detail pages needed by the current mode, and held tabs. Close older feed duplicates through CDP HTTP, not a blanket browser restart.
- **Derive the tab allow-list from the enabled exchanges, never a hardcoded list of every market.** The cleaner and the opener both read the live-tab pattern file; if it names feeds for disabled exchanges, those tabs are protected from cleanup and stay on the owner's screen. On a settings change, rewrite the patterns from the active-market flags.

Measure the real cost before blaming OOM: on a 4 GB Windows box a headed Chrome runs ~24 processes and ~1.5 GB with only a handful of tabs, because payment-widget iframes persist on every marketplace page. Block those frames and cap the renderer process count rather than waiting for the OOM, and prefer feeding tabs off over chasing crashes by hand.

## Read the vendor's own documentation before reverse-engineering

**When a third-party API or app returns an unexpected status, read its published spec and help center BEFORE probing internals.** This is the single rule that most saves time on any external integration.

The failure pattern is specific and expensive: a documented endpoint returned `404`, and instead of checking the method, the endpoint was declared missing, the account's plan tier blamed, and then a long stretch spent grepping application logs, decrypting `config.json` via DPAPI, and rummaging through Electron `leveldb` and `blob_storage` — all to reverse-engineer a session token that one documented `login-with-token` request issues for free. A later hop in the vendor docs revealed the real cause: the call was a `GET` with a required query parameter, not the `POST` that had been guessed.

- **When the user supplies a doc link or file, read the actual request line for each call** — method, path, required query params — before issuing anything. Do not infer the verb from what "should" work.
- **If the docs site is a JS app the fetch tools cannot read, go straight for the machine-readable spec.** Web extraction of a single-page docs shell returns an empty or near-empty body; the substance sits in the OpenAPI document the page links (a raw `openapi.yaml`/`.json` served from the same CDN, or a downloadable file the user already put in Downloads). Read `info.description` and the per-operation `requestBody`/`summary` there, and grep the paths for the call in hand. A local spec also settles method-vs-path disputes the rendered site hides.
- **Treat a 404 as "wrong method or wrong path", never as "feature absent" or "plan does not allow it".** Asserting an entitlement from a 404 invents a blocker and sends the user hunting for a paywall that does not exist. Re-check verb and query string before naming any limit.
- **Never crack open app internals (config files, keychains, leveldb, caches, WebSocket handshake tokens) for a credential the vendor documents a login endpoint for.** That is a last resort for genuinely undocumented behaviour and usually hides a simpler documented path.
- **Verify installation and liveness before reporting either.** Checking install paths and running processes while a desktop app is mid-restart yields a false "not installed"; re-check before stating a fact the user can trivially contradict.
- **Own a misdiagnosis plainly when corrected.** This user reads the difference between a verified finding and a guess; conceding a wrong claim costs less than defending it.
- **If the user tells you the approach is wrong, stop the current line immediately** and return to the documentation rather than continuing to dig.

## Isolated anti-detect profiles (Dolphin Anty)

When one shared Chrome profile cannot carry several marketplaces, run one anti-detect profile per exchange. The point of the vendor is that profiles expose the same CDP surface the existing automation already uses, so isolation is added without rewriting the browser layer.

- Start a profile through the vendor's **local** API (only alive while the desktop app runs, same machine, default port 3001) and list/inspect through the **cloud** API with the panel JWT. Route `/v1.0/*` to local, everything else to cloud.
- **`proxy` sent at profile creation is silently dropped — bind it with a separate `PATCH` and read the field back.** A profile created with a proxy in the POST body comes back with `proxyId: 0`, and it then exits on the host IP. Bind after creation (`PATCH /browser_profiles/<id>` with `{"proxy": {"id": <cabinet proxy id>}}`) and re-read the profile list to confirm the field is non-zero. **The PATCH field is the object `proxy`, not the integer `proxyId`** — a body of `{"proxyId": <id>}` answers `200` with the whole profile and changes nothing, which is how a whole proxy pool ends up unused while every check passes. Do not add `statusId` to the same PATCH: it answers `403` and voids the whole request, proxy included. Treating a `proxyId` in the create payload as applied is how a whole proxy pool ends up unused while every check passes.
- **Give every profile its own User-Agent, and derive the related fields from that one string.** A shared UA across profiles is the most obvious tell of a pool. Set `useragent: {mode: "manual", value: "<full UA>"}` at profile creation, and parse the rest out of the same line: the Chrome build for `uaFullVersion`, the `Windows NT 11.0` part for `platformVersion`, and the `ru-RU`/`en-US` token for `locale: {mode: "manual", value: "..."}`. The UA string, the OS version and the locale disagreeing with each other is a mismatch the platform can see; one source string cannot disagree with itself.
- **A single-profile `GET` can fail while the list works.** `GET /browser_profiles/<id>` may answer `500` while `GET /browser_profiles` returns the same profile with its fields. Read bindings from the list endpoint, not from a per-id fetch.
- Authenticate the local API first via the documented token login, then start with the automation flag — without it the profile launches with no DevTools endpoint.
- Attach exactly as with the shared profile: `chromium.connectOverCDP("http://127.0.0.1:<port>")`. The port changes every start, so read it from the start response instead of caching it.
- **A profile with `proxyId` set can still exit on the host's own IP.** A proxy reference in the profile object proves binding, not applied traffic. Load an IP-echo page in the started profile and read the reported country/ISP/proxy line before trusting any geolocation claim.
- **`E_PROXY_CHECK_ERROR` on start means the bound proxy entry is dead, not that the profile is broken.** Read the profile's `proxyId`, fetch that proxy record, and compare its host/port against your own verified-working proxy list. When they differ, `PATCH` the proxy record to a port you have probed yourself:
  ```bash
  curl -X PATCH https://<vendor-api>/proxy/<proxyId> \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"type":"http","host":"<ip>","port":9999,"login":"<user>","password":"<pass>"}'
  ```
  **`type` is required in the body** — omitting it returns `422` with `fields:[{"field":"type"}]`, which reads like a validation problem rather than a missing field.
- **Confirm the proxy applied by the ISP/ASN string changing, not only by the IP.** Read the IP-echo page inside the started profile and compare the reported ISP against the host's own ISP; an unchanged ISP means the tunnel is not in the path even if the IP differs.
- **An anti-detect profile can pass a bot check that the shared profile cannot.** Load the same URL in both and compare: search engines that serve a challenge page to the ordinary Chrome will often render normally in the anti-detect profile. That difference is the whole justification for the vendor, so verify it on a real target before spending effort elsewhere.
- Cookies and localStorage are separate surfaces and either may hold a marketplace session; check the vendor's import/export endpoints for both when migrating a logged-in session into a profile.

See `references/dolphin-anty-api.md` for verified endpoint/method/auth details, and `references/residential-proxy-verify.md` for the proxy-side verification method.

## Teaching a Hermes profile to drive a browser

When the capability is worth repeating (a profile that must start a browser, fill a form, and report back), do not run it once by hand and move on — give a dedicated Hermes profile a skill and hand it work through Kanban, then let it run the next one unattended.

- **Create a separate profile for the capability, not a generalist.** `hermes profile create <name> --clone` copies config, `.env` and skills but deliberately leaves messaging channels behind, so the new profile cannot collide with the running gateway over one bot token. Verify that separation (no bot token in its `.env`) instead of assuming the clone was clean. Reusing a domain executor profile for unrelated infra work is how a retouch worker ends up restarting browsers.
- **Put the vendor specifics in a SKILL.md whose `description` is the trigger**, and put only verified facts in it — actual method, actual path, actual flags, plus a short "known traps" section naming the wrong turn (wrong verb, required query param, mandatory flag). A skill is loaded when the description matches the task, so the description decides whether it ever fires.
- **The proof that it learned is a board task it completes by itself.** Create the task, assign the profile, and `hermes kanban dispatch`; the run log and the summary field are the evidence. A hand-run curl is not a demonstration of anything.
- **Do not feed a profile through `hermes --cli` with stdin redirected from a file.** On Windows the TUI needs a real console buffer and the run dies with `NoConsoleScreenBufferError`; wrapped in a `.bat` it gets worse — it opens an interactive prompt, reads nothing, produces zero sessions, and exits `0` on the *next* manual close, which reads as a late success that never happened. Kanban does the same thing correctly, with its own workspace per task, and a heartbeat plus an explicit status.
- **Never hand-run the first instance to "see if it works".** When the owner asks for a capability to be taught to an agent, the hand-run is the thing being removed: it proves the vendor works, not that the agent works, and it burns the time the training was meant to save. Write the skill and dispatch the task instead; read the run log for what the agent did.
- **Recognise the moment for the stop-and-teach route, not just at the start.** If a run is already blocked on budget and the remainder is a single mechanical step, do not take over the whole job yourself — split it and dispatch the remainder, as above. Hand-finishing a blocked task teaches the profile nothing and leaves the same wall in place for the next one.
- Verify the result by reading what changed in the world (a returned CDP port, a browser version string), not by the task simply turning `done`.
- **An agent's own report is a claim, not evidence.** A run can describe a
  delivery in confident detail — endpoint used, field names, confirmation flags
  read back — while the artifact never landed. Re-read the world yourself before
  repeating any of it to the user, and when a check comes back empty say so
  plainly instead of reporting the agent's account.

### Split any multi-stage job before dispatching it

A Kanban worker has a fixed iteration budget (40 by default). A task that bundles
browser launch, navigation, several page interactions, a screenshot and a delivery
will exhaust it and be auto-blocked after two attempts — and the tail of the run
gets spent on diagnosing side-quests (a cookie dialog, a checkbox) instead of the
deliverable.

- **Split at the seams: setup → action → delivery.** Three tasks, each with a
  artifact the next one consumes. Re-dispatching the remainder as a short
  delivery-only task finishes in a fraction of the time the monolith burned.
- **A run that hits the budget often got the hard part right anyway.** Read the
  task workspace before declaring failure: a result file, a screenshot or a
  captured page dump sitting there means the objective was met and only the tail
  was missing. The blocked status is then a routing problem, not a capability one.
- **Keep the split tasks in the workspace chain, not in your own head.** The
  workspace of the failed task holds the artifacts the next task needs; point at
  that path in the new task body rather than re-deriving the work.

## Browser jobs that select a target by position

A recurring job shape is "open a search engine, find a query, visit the Nth
result, browse it, deliver a screenshot". Two things break it, and both fail
silently.

- **Selecting by ordinal position needs the results list, not the page.** "The
  4th site" means the 4th *organic* result, counted from one. Sponsored blocks
  sit in different containers and appear first in naive `a[href^=http]` scrapes, so
  a positional selector silently lands on an ad. Read the organic-result
  container specifically, and verify the landed domain is the expected vertical
  before browsing.
- **Do not type the query into a search homepage and press Enter.** Homepage
  search boxes are autocomplete-driven: a synthesised `Enter` key event can
  update the suggestion list and leave the page on the homepage, which reads as
  "the search did nothing". Navigate straight to the results URL with the query
  URL-encoded; that is both more reliable and one step shorter.
- **A bot challenge is a profile-selection signal, not a task failure.** Test the
  target in the anti-detect profile and the shared profile back to back before
  working around it; the same URL that serves a challenge to one can render
  normally in the other. A challenge that clears on a retry in the *same* profile
  is intermittent and will come back — do not treat passing once as fixed.
- **Verify a screenshot by its bytes and by looking at it.** A full-page capture
  is megabytes; a blank or pre-navigation frame is small. Check size, then read
  the image to confirm it shows the domain you were asked to visit.

## Proxies: verify the tunnel, not the port

A proxy whose TCP port accepts connections is not a working proxy, and a vendor status field is not proof of traffic. Authenticated HTTP proxies fail in a characteristic way: an unauthenticated `CONNECT` returns `407 Proxy Authentication Required`, which looks like a service outage but is only the auth check.

- **Probe the real tunnel and read back the egress IP.** A dead proxy, a wrong password, and a country mismatch otherwise all present as identical silence.
- **On Windows the bundled `curl` may not send proxy credentials on `CONNECT` with `-x`/`--proxy`,** so a working proxy reads as dead. Build the tunnel directly: plain socket to the proxy → `CONNECT host:443` with a `Proxy-Authorization: Basic` header → wait for `200 Connection Established` → wrap *that same socket* in TLS and issue the request. `200` proves the tunnel; a wrong password returns `407` at once, separating auth failure from an unreachable service.
- **That order is mandatory:** TCP to proxy, `CONNECT`, read the response header, only then TLS-wrap. TLS-wrapping up front talks to the proxy server instead of the site.
- **Test more than one country before blaming a region.** When a Russian pool looked dead, a German proxy from the same vendor worked; the country was never the variable.
- **Refresh and re-create do not revive a port that never worked,** and a vendor search endpoint may return hundreds of proxy strings that all resolve to the same unresponsive address pool — count distinct addresses, not result rows.
- Keep vendor keys in a gitignored env file beside the client script, never in source. This user pastes keys into chat, where they are already exposed; say so and recommend rotation once the integration is live.

### Put the hard constraint in the task body, not just the skill

A skill is loaded and then reasoned around; a constraint written into the dispatched task body is obeyed. When a previous run burned its whole budget on a side-quest, name the forbidden move explicitly in the next dispatch —

> If you meet a bot check / CAPTCHA / checkbox: do NOT try to solve it, do NOT write bypass scripts. Stop, screenshot what is actually open, deliver that plus an honest description of where you stopped.

— and reframe the deliverable so the honest partial result is a pass rather than a failure. That single paragraph took a run from budget-exhausted to `done` on the second attempt.

- **Ask what the work will look like before promising visibility.** Feed log parsing and DOM clicking are different pipelines: a parser that reads cached logs opens one monitor tab per exchange and never a tab per card, so "watch it work" cannot be satisfied by tab count. Confirm which pipeline is in play, or make the tab-keep count env-tunable, before showing someone a window that looks idle.
- **A working browser process is not a working debug port.** When the user launches Chrome by hand it starts without `--remote-debugging-port`, and automation that looked fine minutes ago now fails with a port timeout. Verify `http://127.0.0.1:9222/json/version`, not `tasklist chrome.exe`.
- **A `connectOverCDP` timeout is not always a dead window — distinguish a truly absent port from a playwright/Chrome version mismatch with two probes.** Chrome auto-updates out from under a pinned playwright driver: `curl .../json/version` responds AND a raw WebSocket `Browser.getVersion` on `webSocketDebuggerUrl` answers instantly, yet playwright's `chromium.connectOverCDP('http://127.0.0.1:9222')` times out at *"<ws connected>"* and only then throws. That signature means the driver and Chrome disagree, not that Chrome is down. Diagnose before touching the window: when HTTP CDP and a raw WS command both work but playwright stalls, bump the playwright driver to match the installed Chrome (or pin Chrome), then reconnect. Restarting Chrome will not fix a version mismatch.
- **Bumping the playwright package is only half the update — also fetch its bundled browser.** `bun update playwright` changes the driver, but `connectOverCDP` still stalls until `bunx playwright install chromium` pulls the matching bundled browser revision into `~/AppData/Local/ms-playwright`. Do both, then re-probe.
- **If the driver now matches Chrome and raw WS still answers but playwright still times out, the residual cause is a wedged long-lived window, not the version.** After the mismatch is ruled out, restart that Chrome window into the SAME profile (`--user-data-dir=<profile>`; cookies, logins and marketplace sessions live on disk and survive), then re-connect — the recovery is the restart, not another driver change. Match the kill to the profile: kill only processes whose command line carries that `--user-data-dir` (a full `taskkill /IM chrome.exe` would take down every profile), and note that child `chrome.exe` processes can survive the main window's kill, so re-check the port is actually free before relaunching.
- **Do not autostart the visible window with a helper that waits on stdin.** `bun serve.ts` blocks on `waitForEnter`, exits immediately under a scheduler or background launch, and takes the window down with it. Launch the browser binary directly with `--remote-debugging-port=9222 --user-data-dir=<profile>`.

## Tab churn: a cleanup threshold below the mode's needs loops forever

Symptom the owner reports as "6 empty tabs open, something closes them, and it repeats — as if the index is lost": a cleanup routine (`closeInactiveTabs(keep)`) trims the window to `keep`, but the active mode needs MORE tabs than `keep` (6 exchange feeds + monitor + guard + open order tabs). Every connector tick re-runs cleanup, trims below need, then the "restore missing tabs" branch reopens them — an endless open/close loop with blinking `about:blank`.

- **Never let a cleanup threshold go below what the current mode requires.** Compute the threshold from the mode's live-tab patterns (`keep-tabs.json`) plus a small margin, and skip cleanup entirely when `pages.length <= threshold` — a no-op cleanup is cheaper than a churn loop. Implemented as `browser-automation/tab-budget.ts` (`порогУборки`, `нужнаУборка`), used by `closeInactiveTabs` in `browser.ts`.
- **Reuse a blank tab instead of `newPage()` per tick** — each `newPage()` adds one more `about:blank`, which the next cleanup closes, which the next tick reopens.
- **Freeze activation, not just closure.** Connectors calling `bringToFront()` on every tick steal focus from the tab the owner opened. Gate activation behind a hold file (`reviews/data/hold-tabs.json`, helper `tab-activate.ts`/`tab-hold.ts`): while it exists, connectors read the DOM in the background and never call `bringToFront()`. Mode `respond` writes the hold; any other mode clears it.
- **A corrupt hold file must fail open** (activation allowed), otherwise one bad write makes every feed silently foreground-less forever.

## A response tab must not blink: hold it open N seconds

The owner reports the response page opening and instantly closing as the system switches back to search. Two independent causes, both must be fixed:

1. **The worker exits immediately after the result.** `bid.ts` finished, `withResponsePage` released the tab, and the cleanup closed it. Fix: sleep `holdSeconds(process.env.RESPONSE_HOLD_SECONDS)` (default 10, clamp 1–120) inside the page handler before the final screenshot, and mark the order as recently answered.
2. **The search mode switch reaps it.** `closeInactiveTabs` treats `/freelancer/<id>` tabs as garbage. Fix: skip any tab whose ID is in `reviews/data/recent-response.json` (`response-hold.ts`: `markRecent` / `isRecent`, 600 s TTL).

- **A zero/blank hold value must fall back to the default, not to zero** — `holdSeconds(0) === 10`. Zero is exactly what produces the instant close the owner complains about.
- **Do the same pause on the Python side** before switching back to search (`tg_bot._вернуть_поиск_после_отклика`, `RESPONSE_HOLD_SECONDS`), otherwise the tab is closed the moment the last DB write lands.
- **A corrupt hold/recent file must fail open** (hold the tab), never fail closed — a bad file must not resume tab churn.
- **Never send a success screenshot for a failed/rejected response.** Only the `accepted` branch sends `sendPhoto` plus the thread link.

## Profi.ru is IP-sensitive: it shows a VPN wall, not an empty feed

When `profi-demand.ts` reports `no order cards in authenticated Profi feed DOM`, read the DOM before blaming selectors: the tab is authorised (title «Заказы») but the body says «Кажется, включён VPN» — the exchange blocks the egress IP. Reloading does not help. Pause the exchange in `/settings` (`profi_ru: false`) rather than retrying or rotating IPs.

## Keeping a local service stack up across sessions

A URL that worked an hour ago and now refuses to open is usually a **dead
process, not a firewall or a bind problem**. Services launched from an agent
background shell die with that shell, and the user meets it as "не открывается".
Before editing bind addresses or firewall rules, check liveness and ports.

Ship one idempotent starter that gates every service on its own port, and use it
instead of hand-starting processes:

```bat
netstat -ano | findstr ":8701" | findstr LISTENING >nul
if errorlevel 1 (start "JobLock Portal" /MIN cmd /c "... python app.py") else (echo already up)
```

The port probe makes it safe to re-run and safe to wire to a scheduled task at
logon. A stack also comes back **partially** — bring every port up, then re-test
each one, and do not report after fixing only the first failure.

- **A correct firewall rule proves nothing while nothing is bound.** Verify both
  layers: the rule and the socket.
- After changing a bind, verify from the machine's own **external** address; that
  is the only check matching what the user sees.

## Editing a running service's code safely

- **Never blanket-replace `obj["key"]` with `obj.get("key", "")` across a file.**
  The regex also rewrites assignments — `o["status"] = "taken"` becomes
  `o.get("status", "") = "taken"`, a `SyntaxError` that kills the whole process
  and presents as "the service won't start". Scope it to read contexts, then
  run `python -m py_compile` before restarting anything.
- **Renders must tolerate programmatically created records.** A field assumed
  present in every row (`price`, `budget`) raises `KeyError` on the first record
  that came from an API fixture rather than the seeder, taking the whole page
  down with it. Use `.get()` in templates.
- Launching such a starter from a tool call can appear to hang because `start`
  does not return; verify by port, not by waiting for output.

## Pitfalls

- **Never end a CDP-attached script with `browser.close()` — over `connectOverCDP` it closes the BROWSER, not the session.** The Playwright call is forwarded to the attached browser, so a helper script that "cleans up" with `await browser.close()` shuts the user's window / antidetect profile down the instant it exits — the owner sees the profile dying the moment a script touches it. End the script with `process.exit(0)` (or just return) and leave the window and its tabs alone.
- **This machine reaches the internet over 3G — a request that returned is not a page that loaded.** Give loads real time (several seconds of explicit wait before reading or shooting), and do NOT close pages or profiles a job still needs: closing mid-load is behind most "the element / review / screenshot wasn't there" bugs, and the owner says it plainly — an opened page stays open while the work needs it.
- Close all normal Chrome instances before using the dedicated profile, because an existing Chrome process can absorb the command-line flags and leave port `9222` unavailable.
- Do not tell the user that a page is visible merely because CDP responds; verify the page URL through the attached visible context and distinguish the user's desktop session from an agent-only browser session.
- Do not claim an authenticated seller interface was studied when the URL redirected to `/login`; the login boundary must be resolved in the user's visible profile first.

## One long-lived process per feed, not one process for all feeds

When a collector loops several exchanges (workzilla/kwork/insolvo) in a single process, one dead feed takes the others down with it, and a shared Chrome window makes the processes fight over tabs. Split into one process per exchange with a feed selector, and let the selector gate TAB OPENING as well as polling — otherwise every process opens every feed.

- The selector must be an **ASCII** env var name. bash rejects a non-ASCII variable name in the `VAR=value cmd` position with "command not found", which reads as "the collector failed to start" while the code is fine.
- **Check the launcher's exit status, not just the log.** A feed selector that was rejected by the shell still leaves the previous run's log file in place, so the log shows a healthy process that is not running. Count live processes by command line after launching, and treat "log file exists" as evidence of nothing.
- **When several feed parsers share one visible Chrome, one CDP blip kills them all and keeper does not always resurrect them.** Probe intake by the feed log's mtime, not by process presence: a parser can be alive-but-frozen, so `ls -la <feed-log>.jsonl` — if the mtime stopped advancing for hours while portal/chrome/proxy all look healthy, the intake loop is down even though nothing else reports it. Restart the parsers and re-check that the feed log's mtime advances again.
- **A frozen feed with a live parser and healthy CDP is usually an EXPIRED MARKETPLACE SESSION, not a parser bug.** Open the feed URL in a fresh visible tab and read `location.href`: a redirect to `/account/login?ReturnUrl=/...` while CDP/portal/processes are all green is the diagnosis. Call `browser_vault_list` first; if no login is saved, hand authentication back to the owner in the visible Chrome and stop — never type or guess credentials, and do not restart the parser as a cure. Confirm recovery only by a fresh feed-log mtime and growing DB count after he logs in.
- Give each process its own log file, and verify per process which feed it reports as healthy.
- When you add such a switch to a codebase that already names its own identifiers in Cyrillic, keep the new switch ASCII and leave the surrounding style alone.

### How much a feed actually yields

A feed's card count is set by the site's own pagination and caps, and reading only the first screen makes a healthy collector look broken. Probe the feed's own controls before concluding the feed is small.

- **Pagination controls may not be links.** On a Vue-rendered feed the page numbers are `div` elements with a pagination class and no `href`; a selector for `a` finds nothing and the feed looks single-page. Read the control container's markup, then click the item whose text is the page number (fall back to the next-arrow element).
- **A "more" button is not always pagination.** On one feed the `See more` control sits in a referral-program banner and links to a different section; clicking it navigates the tab away from the feed, and the next poll returns zero cards and looks like a dead feed. Before clicking a more/load control, read its `href` and its container — if it points off-feed, it is not pagination, and the feed's real limit is the first page.
- **Some feeds cap tasks per page and require rejecting unwanted ones** to see further. That is a user-visible action on the exchange, not a read: ask before performing it, and never automate rejections unasked.
- Report the feed's real ceiling (cards visible, pages available) next to the number captured, so "we only got N" is distinguishable from "the feed only has N".

## Publishing a local dashboard to the user's browser

When the user asks to watch local state from their own machine, binding to `127.0.0.1` is the obstacle — and it is often deliberate. Change the bind to `0.0.0.0`, add a firewall rule for that port, then **verify from the machine's own external address**, not `localhost`. Confirm the route returns `200` and that it actually renders the expected numbers; a page that answers `200` while showing zeros has still failed.

- **State the exposure plainly when you open it.** A local portal that lists orders and client materials becomes internet-reachable, usually with no auth, and its DB password often sits in cleartext in the source. Say that in the same breath as the URL and offer to close it again on request.
- **Prefer giving them a richer read-only view over a raw API dump:** a page with a stage breakdown and a sortable table answers "how is it going" better than JSON does. Keep it self-refreshing and have it count live from the DB with no cache, so the numbers cannot drift from the truth.
- **But a stage breakdown is a choice, not a default — for a list of items the owner wants the list, not a funnel.** When the request is "show me the projects/orders", the expected shape is a plain table: the item's title as the clickable row header, the click opening the item's details, and a status control next to it. Funnel bars, source/tasks summary cards and other analytics blocks read as noise and get rejected. Ask which of the two the view is for, or default to the table when the request names a list of items.
- **A page that renders `200` with zeros is still broken.** Assert on extracted numbers, not on the status code. Two failure modes produce a healthy-looking page: a `DictCursor` that returns dicts where tuple-unpacking is expected yields header names as data (`{'status': 'COUNT(*)'}`) and silently wrong totals, and a `datetime` column sliced as if it were a string raises on the first real row. Pass the cursor class explicitly (`conn.cursor(pymysql.cursors.Cursor)`) and coerce dates through `str()` before slicing.
- When you hand over a number, check that the stages are actually a funnel before labelling one. If the data has only flat statuses and no transition history, that is a distribution — call it a distribution.
- Count live from the DB with no cache, and keep each order in exactly one stage so the stages sum to the total; a cached or overlapping breakdown drifts from the truth and makes the page untrustworthy.
