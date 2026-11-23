---
name: joblock-browser-automation-handoff
description: "Use when taking over JobLock browser automation, Fury profiles, Yandex review sessions, MCP scripts or parser/review pipeline. Full handoff and verified commands."
version: 1.0.0
platforms: [windows]
---

# JobLock browser automation handoff

Full operating manual: `references/HANDOFF-BROWSER-AUTOMATION.md`.
Read it before touching the parser, Fury, Yandex sessions, or the review pipeline.

Verified facts at handover (2026-11-23):
- All nine Fury profiles (`rev_yandex_2,3,4,15,16,17,18,19,20`) hold a live Yandex session and open `https://reviews.yandex.ru/` -> `/ugcpub/cabinet` with reviews.
- Fury write API is MCP: `fury-agent.exe mcp` (stdio JSON-RPC), 19 tools. HTTP `/v1` is read/start/stop only.
- Workzilla-only feed parser: `PARSER_MARKETS=wz bun parser.ts`; check `feed-log.jsonl` mtime, not just process presence.
- Credentials stay in `C:/Users/Administrator/AppData/Local/hermes-standalone-githumanbro/home/credentials/` (copied from Temp); never print values.
- Helper scripts are in `scripts/` here; `mcp_client.py` is the reusable MCP client.

Related skills: `visible-marketplace-browser-automation`, `visible-chrome-tabs`,
`joblock-chrome-cdp-ops`, `joblock-order-pipeline`, `marketplace-account-pool`,
`reviews-pipeline-ops`, `order-feed-pipeline`, `joblock-monitoring`, `hermes-agent`.
