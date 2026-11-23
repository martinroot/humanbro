---
name: visible-chrome-tabs
description: Use when scraping or automating the visible Chrome via CDP.
---

# Visible-Chrome tab governance (CDP scraping)

Use when scripts attach to the operator's visible Chrome (playwright `connectOverCDP`) to scrape feeds or run a monitoring loop. Goal: the operator sees a calm browser — fixed tabs, no flashing, no tab inflation.

## Tab model
- ONE tab per role: a monitoring page tab, and one working tab per exchange/site. Find tabs by DOMAIN of their current URL, never by a URL marker you inserted — after the page navigates to the target site the marker is gone and the next run opens a duplicate.
- Never reset a working tab with `goto` (blank page, search URL, etc.) between ticks: SPA/AJAX state is lost and the operator watches the page flash. `bringToFront()` the tab you are polling so the operator sees which exchange is being read.
- Full `page.reload()` at most once per 10 minutes per tab, gated by a stamp file (Date.now() vs last stamp) — sites with AJAX don't need reloads, and clicking SPA nav links (e.g. the client app's own tab links) updates the feed without reload. Guard the reload in try/except: a hung renderer must not crash the tick.
- Cleanup runs centrally, not in each script: list tabs over plain CDP HTTP (`GET /json/list`, `GET /json/close/<id>` via urllib — no playwright needed), close tabs outside the allowlist (monitoring tab, one tab per exchange domain, operator's own site tabs) and duplicate roles (only one tab per role). Run cleanup every ~5 polling ticks and log what was closed.

## When Chrome/CDP is down
- Distinguish three failure layers before concluding the port is dead: HTTP up but `connectOverCDP` times out at the websocket handshake = Chrome's DevTools is hung (kill all chrome.exe, relaunch with `--hide-crash-restore-bubble` and the fixed profile; a crashed-restore launch cascades tabs) — versus port not listening = Chrome closed — versus HTTP 200 and connect OK = the scraper's own bug.
- When the polling loop depends on Chrome, count consecutive failures and back off (e.g. 3 fails → sleep 120 s) instead of spawning a scraper process every tick: a down browser otherwise produces tab/error spam exactly at tick frequency.
- Reopening after a crash: launch fresh with `--remote-debugging-port=9222 --user-data-dir=<fixed profile> --hide-crash-restore-bubble` and immediately recreate the fixed tabs (monitoring + exchange roots) — do not let session-restore reopen stale tabs.

## Scripts that talk to these tabs
- Read the DOM from the live page (`page.evaluate`) instead of re-navigating; click the site's own AJAX refresh controls when present, and remove any click that crashes the tab (a SPA link click can kill the renderer — if a tick dies with 'Target page has been closed', suspect the click first).
- Multiple bun/python helpers sharing the same tabs is fine, but each attach/disconnect cycle is visible; keep tick helpers minimal and sequential (one exchange per tick) so the operator can follow what is happening.
