# Transfer manifest — browser automation → hermes-standalone-githumanbro

Date: 2026-11-23. Target HERMES_HOME: `C:/Users/Administrator/AppData/Local/hermes-standalone-githumanbro`.

## What was transferred
- All 97 SKILL.md files from `C:/Users/Administrator/AppData/Local/hermes/skills` merged into `<target>/skills` (target now has 98; its pre-existing `development/git-repository-workflows` was preserved; skills backup in `backups/skills_before_transfer_20261123_214041`).
- New skill `devops/joblock-browser-automation-handoff` in both profiles; `SKILL.md` trigger + `references/HANDOFF-BROWSER-AUTOMATION.md`.
- Helper scripts (32 Python files from `Temp/fury-install`, plus `fury-login-all.sh`, `yandex-login.ts`, `yandex-whoami.ts`, `dolphin.ts`, `dolphin-to-fury.ts`, `asocks*.ts`, `parser.ts`, `browser.ts`, `watch-chat.ts`, `wz-detail.ts`, `bid.ts`, `reviews/registry.py`, `reviews/mode.py`) copied into `<target>/skills/devops/joblock-browser-automation-handoff/scripts/`. Paths inside are preserved as flat filenames.
- `MEMORY.md` and `USER.md` copied into `<target>/memories/`.
- Protected credential/proxy files copied to `<target>/home/credentials/` (7 files). Values are NOT in this manifest or in any skill text.

## Verification performed
- `find <target>/skills -name SKILL.md` → 98 files.
- `HERMES_HOME=<target> hermes skills list --source local` → 38 local skills enabled (source shows 37; same CLI filtering behaviour), including `joblock-browser-automation-handoff`, `visible-marketplace-browser-automation`, `joblock-chrome-cdp-ops`, `marketplace-account-pool`, `joblock-order-pipeline`.
- Target session registry `sessions/sessions.json` still maps `agent:main:telegram:dm:353169388` → `20261123_205119_189a4698` (unchanged).
- No secret values were printed during transfer; skills were scanned beforehand and contained only placeholder examples.
