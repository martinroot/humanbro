# token-usage-footer — package review

Third-party Hermes plugin that appends one machine-readable accounting line to
every messaging reply and writes one JSON object per turn to `usage.jsonl`.
Added to this repo on 2026-11-23 from the two archives supplied by the owner.

## Contents

- `README.md` — author's package documentation.
- `INSTRUKCIYA.md` — short operator instruction (identical to the one inside the source archive).
- `plugin/` — `plugin.yaml` + `token_usage_footer.py` (installed as `__init__.py`).
- `scripts/` — `install.sh`, `configure.py`, `parse_usage.py`.
- `archives/` — the two original tarballs, byte-for-byte as received.

## What the code actually does

- `post_api_request` hook accumulates usage buckets per `(session_id, turn_id)`:
  input/output/cache-read/cache-write/reasoning tokens, provider call count,
  call duration, model and provider.
- `transform_llm_output` hook appends `⚙️ IN=…|OUT=…|…|SESS=…|TURN=…|` to the
  FINAL reply of messaging turns only. CLI, TUI, ACP, desktop, API-server and
  subagent platforms are skipped unless `HERMES_TOKEN_USAGE_FOOTER_ALL=1`.
- Writes `usage.jsonl` next to the installed plugin (`mode 0600`). `parse_usage.py`
  converts it to JSON/CSV/SQL/totals. Estimated USD uses Hermes' own
  `agent.usage_pricing`; no external pricing API is called.
- No network requests, subprocesses, credential reads or secrets in the source
  (grep for curl/wget/socket/requests/urllib/api_key/password found nothing).

## Verified

- `plugin/token_usage_footer.py` and the installed archive's `__init__.py`
  have the same SHA-256: `81702beeacb99e6f217a58363c49e071e88008465a42174e7d55e16ec2c88a84`.
- `plugin.yaml` is byte-identical in both archives:
  `c967dfa756539a90384fbf0d94613f4a859d7819157ecd89f4042ce0b551db3b`.
- The supplied `INSTRUKCIYA.md` matches the archive copy exactly.

## Before installing — read this

- `install.sh` **sets `gateway.allow_all_users: true` by default**, which grants
  every sender on every platform access to the gateway, including group chats.
  If that is not the intent, install with `--no-open-all`. The script also sets
  `display.runtime_footer.enabled: false` (use `--no-footer` to keep the native
  footer) and backs up `config.yaml` with a timestamp before editing it.
- The installer is Linux/systemd-specific: `/home/<user>/.hermes`,
  `systemctl --user -M <user>@ restart hermes-gateway.service`. It was NOT run
  on this Windows machine; nothing here was installed or activated.
- It must be run from outside the gateway (root SSH). From inside a gateway
  turn, Hermes blocks self-restart; the agent can only send `/restart` in chat.
- Plugin code is read at gateway start: after any edit, restart the service or
  send `/restart` in chat.

## Install / verify (on the target Linux host)

```bash
sudo /opt/hermes-usage-footer/scripts/install.sh --user main
grep "stamped turn" /home/main/.hermes/logs/agent.log | tail -1
tail -1 /home/main/.hermes/plugins/token-usage-footer/usage.jsonl
```

The footer is appended after the model turn, so it cannot enter the prompt or
invalidate prompt caching. `USD` is an estimate, not billing.

## Diagnosis 2026-11-26: "footer not showing"

The re-sent `token-usage-footer-installed.tar.gz` is byte-identical to the first
one (SHA-256 `81702bee…` / `c967dfa7…`) — the archive was not the problem.

The plugin was healthy in the two places it had actually been installed:

- Linux host `server-szpf` (94.183.186.98), `/home/main/.hermes`: doctor OK with
  2 hooks, `stamped turn` in `agent.log` (36 entries, last 10:51), `usage.jsonl`
  written at 10:51, gateway service active.
- Windows profile `AppData/Local/hermes`: 165 stamped turns, `usage.jsonl`
  appended at 13:58.

The chat that complained runs under a THIRD profile —
`AppData/Local/hermes-standalone-githumanbro` — where `plugins.enabled: []` and
no `plugins/token-usage-footer` directory existed. No plugin, no footer.

Fix applied in that active profile: copied `__init__.py` + `plugin.yaml` into
`plugins/token-usage-footer/`, ran `hermes plugins doctor` (OK, 0 tools / 2 hooks),
enabled with `hermes plugins enable token-usage-footer --no-allow-tool-override`,
and proved it with
`HERMES_TOKEN_USAGE_FOOTER_ALL=1 hermes -z "Ответь одним словом: ок"` — the
`⚙️ IN=14008|OUT=31|…` line appeared and a fresh `usage.jsonl` row was written.

A gateway that was already running still needs `/restart` in chat before its own
future replies carry the footer; the agent must not restart it from a shell
inside the gateway process.
