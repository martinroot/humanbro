# Hermes profile snapshot — githumanbro

Snapshot of the Hermes profile `C:\Users\Administrator\AppData\Local\hermes-standalone-githumanbro`
transferred on 2026-11-23 and published to this repository's `main` branch.

## Contents

| Path | What it is |
|---|---|
| `skills/` | 98 `SKILL.md` files (46 active + 52 in `.archive/`), with all `references/`, `scripts/` and templates |
| `skills/devops/joblock-browser-automation-handoff/` | Full browser-automation handoff: `references/HANDOFF-BROWSER-AUTOMATION.md`, 30 helper scripts (MCP client, session/review checks, login flows, proxy binding, parser) |
| `memories/MEMORY.md`, `memories/USER.md` | Durable memory and user profile |
| `config.yaml` | Profile config (no secrets; secrets live in `.env`) |
| `TRANSFER-MANIFEST.md` | Original transfer report |
| `CHECKSUMS.sha256` | SHA-256 of every file in this snapshot |

## Verification at publish time

- 98 `SKILL.md` files in the target profile; **0** of the 97 source skills missing; the extra one is the profile's own `development/git-repository-workflows`.
- All 98 SKILL.md files have valid `name:` and `description:` frontmatter.
- `HERMES_HOME=<profile> hermes skills list --source local` → **38 local skills enabled**. The 52 archived skills are intentionally not registered.
- All files scanned against the 7 credential files: no credential values are present in this snapshot.

## Deliberately excluded (do not commit)

- `home/credentials/` — 7 files with account logins/passwords, answers and proxy data.
- `.env`, `auth.json`, `*.db*`, `sessions/`, `state/`, caches, logs, gateway files, `backups/`.
- Skill runtime state: `.usage.json*`, `.curator_*`, `.bundled_manifest`, `.curator_backups/*.tar.gz`, `.hub/index-cache/`, `*.lock`, `*.jsonl`.

## Restore

```bash
cp -r hermes-profile/skills/.  "$HERMES_HOME/skills/"
cp -r hermes-profile/memories/. "$HERMES_HOME/memories/"
cp hermes-profile/config.yaml   "$HERMES_HOME/config.yaml"   # review/merge first
```

Credentials must be restored separately from their secure source; they are not in git.
Skills are prompt-cached: a new session (or gateway restart) is needed for changes to register.
Verify integrity with `sha256sum -c CHECKSUMS.sha256` from this directory.
