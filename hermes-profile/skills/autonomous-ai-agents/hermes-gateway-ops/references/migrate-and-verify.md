# OpenClaw → Hermes migration

Taking over an existing OpenClaw install into Hermes: move credentials, verify without leaking, bring the gateway up, put the old workspace under version control.

## Where things live

- OpenClaw home: `~/.openclaw/`. Config is JSON, not YAML. The full user-facing config (with `channels`) is `____openclaw.json` and `openclaw.json.last-good`; `openclaw.json` is a trimmed models/secrets slice and may lack `channels`. Check the others before concluding a field is unset.
- Hermes home is `$HERMES_HOME` = `C:\Users\Administrator\AppData\Local\hermes` (NOT `~/.hermes`). Secrets go in `$HERMES_HOME/.env` (never `config.yaml`).
- Telegram mapping: OpenClaw `channels.telegram.botToken` → `TELEGRAM_BOT_TOKEN`; `channels.telegram.allowFrom` (list) → `TELEGRAM_ALLOWED_USERS` (comma-joined). `commands.ownerAllowFrom` `telegram:<id>` mirrors the owner.
- Hermes bundles `openclaw_to_hermes.py` (in `hermes-agent/optional-skills/migration/...`) — consult its variable map before hand-mapping a less-common platform.

## Steps

1. Read the source config with `execute_code` (json.load), not `cat` — the token displays as `8763281594:***` anywhere. Assert the field matches `\d+:[A-Za-z0-9_-]{30,}`.
2. In the **same** step, write `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USERS` into `$HERMES_HOME/.env`: replace any active `KEY=` line or insert after the `# TELEGRAM INTEGRATION` header; collapse duplicate keys; keep values file-to-file. Print only key counts + token sha1.
3. Verify externally: read the token back in-process and call `getMe`. `ok:true` + the same bot id/username as the old install proves both that the write landed and that it is the same bot.
4. Bring up the gateway (see the parent skill — Scheduled Task over manual background run), then confirm `✓ telegram connected` in the log.
5. If handing off the old workspace, `git add -A && git commit` an initial snapshot (`git config user.name/user.email` first), then **scan the committed blobs for secrets** before calling it clean.

## Secret-scan pitfalls

- A regex hit inside a **binary** file (`.jpg`/`.png`) is expected noise, not a leak — read the magic bytes (`FF D8 FF` for JPEG) and skip it. A scan that only flags `.jpg` is clean.
- Real tokens to grep: `sk-or-...`, `\d+:[A-Za-z0-9_-]{30,}` (telegram), `ghp_` (github), `api[_-]?key[...]= `.
- After editing `.env`, read back only the keys you touched (masked), never re-dump the file — it holds many API keys.
