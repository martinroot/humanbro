# Offline execution of marketplace automation plan cards

Use this when a user supplies a multi-step marketplace/agent plan and authorizes a bounded local implementation task. Keep the task card, not the entire roadmap, as the unit of work.

## 1. Establish scope and read the right evidence

1. Read the workspace checkpoint (`PROGRESS.md`) and the previous task's evidence first.
2. Read the plan's executor instructions and only the requested card from `TASKS.json`; do not scan every card unless a dependency requires it.
3. Locate plan and source/handoff archives. Validate member paths before extraction and unpack each into a separate isolated directory.
4. Begin with `START_HERE.md`, manifests, dependency/package metadata, and a static import map. Do not read full history logs merely to reconstruct project counts when a saved manifest or snapshot contains them.
5. Record actual worktree paths and whether they are Git repositories. If there is no suitable repository, work in a dedicated copy; never write into original source or database folders.

## 2. Inspect before importing or running

- Search for the exact imports referenced by the task and distinguish files missing from the selective handoff from files missing in the actual checkout.
- Statically inspect top-level code for config reads, HTTP/fetch calls, browser launches, polling loops, background threads, subprocesses, and scheduled-task wrappers.
- Never import a production entrypoint until its module-level behavior is understood. Do not run parsers, bid/delivery scripts, browser automation, autostart installers, or services during offline setup.
- Treat `.env` values and hard-coded config literals as credentials. Keep them out of fixtures, tests, reports, and handoff bundles. If a credential is present in a provided package, do not use it; report it as exposed and recommend rotation without repeating the value.

## 3. Build the offline seam

- Extract pure decisions from side-effectful entrypoints into a small module with dependency-injected ports.
- Use in-memory fake queue, browser/page, exchange, and message adapters. Give them explicit `offline_safe` markers and `memory://` endpoints; fail closed for unknown adapters/endpoints.
- Use synthetic fixtures for a normal case, missing inputs, unsupported work, and rejected/live-mode configuration. Never use customer history or production data when fixtures suffice.
- Make fake submit/delivery methods either unavailable or hard-failing. A test harness must not be capable of accidentally sending a live offer or delivery.

## 4. Prove import and runtime isolation

Before importing the modules under test, install fail-fast sentinels for socket creation/connect, HTTP/URL open, fetch, subprocess/browser launch, thread starts, async task creation, sleep/poll loops, and production-config file reads. Assert zero sentinel calls and no background threads after imports. Put a hard timeout around the test command so a busy top-level loop cannot hang indefinitely.

Test the fake flow as well as the imports: a valid fixture can prepare a local draft, but must not submit; incomplete materials must stop before browser/exchange work; unsupported tasks and non-memory endpoints must fail closed.

## 5. Run and checkpoint one card

- Prefer the installed standard library and existing lockfile; do not install dependencies automatically for an offline test contour.
- Document one reproducible local test command. Record its exact output and exit code, input/workspace paths, artifact paths, changed files, blockers, and residual integration risk in `evidence/<card>/report.md` and `PROGRESS.md`.
- When the task requires database integrity, hash the original snapshot before and after the smoke test and compare the manifests. Hashing is a state-integrity check; do not turn it into an excuse to parse full logs.
- Keep `TASKS.json` immutable. Mark only the requested card complete after its acceptance checks pass; leave the next card pending and stop.
- State offline-harness success separately from production readiness. A fake-adapter test proves only the seam that was exercised; it does not certify live browser, API, parser, or delivery entrypoints.
