# Switching preset profiles under a multiplex gateway

Recipe for the case where one Telegram group must run different prepared Hermes profiles by topic, while a second group keeps an ordinary single-profile gateway.

## Topology

- Ordinary gateway: default profile, its own bot token/group, `multiplex_profiles: false`. Never stop it during a preset switch.
- Multiplex gateway: a named profile (`slug` in this install), its own bot token/group, `gateway.multiplex_profiles: true` and `gateway.profile_routes`.
- Exactly one profile owns each bot token. Inventory every profile `.env` by token id or fingerprint (never print the value); disable duplicates or the multiplexer refuses to start with "both configure telegram with the same credential".

## Routes

```yaml
gateway:
  multiplex_profiles: true
  profile_routes:
    - {name: pdf-764,  platform: telegram, chat_id: "<group>", thread_id: "764", profile: pdf-edit-pro}
    - {name: video-641, platform: telegram, chat_id: "<group>", thread_id: "641", profile: video-shorts}
    - {name: default-chat, platform: telegram, chat_id: "<group>", profile: empty}  # catch-all, no thread_id
```

Verify with the real parser, not by eyeballing YAML:

```python
from gateway.profile_routing import parse_profile_routes, match_profile_route
rs = parse_profile_routes(cfg['gateway']['profile_routes'])
for tid in ('764', '641', '9999'):
    m = match_profile_route(rs, platform='telegram', chat_id='<group>', thread_id=tid)
    print(tid, '->', m.profile if m else 'DEFAULT')
```

## Programmatic switch (portal `profile_switch.switch()`)

When multiplex is on, do NOT stop/start profile-specific gateways — the profile is selected by route:

1. Load the multiplex profile's `config.yaml` from a path derived from the manager's `profile_root` (never a module-level absolute path, or tests with a temp root mutate production config).
2. Find the route named `default-chat`, set its `profile` to the target; append the catch-all route if absent.
3. Write via `yaml.safe_dump` to a `.tmp` sibling and `os.replace` it into place (atomic).
4. `hermes -p <mux> gateway stop`, then `hermes -p <mux> gateway start --force`. Leave the ordinary gateway running.
5. Poll `<home>/profiles/<mux>/gateway_state.json` for `gateway_state == "running"` (up to ~90 s) before reporting success — `gateway start` returns while the process is still `starting`.
6. Persist the active-profile marker only after that.

## Test adaptation

- Fast liveness reads replace per-profile `hermes gateway status` subprocesses with state-file + one `tasklist /FO CSV /NH`. Tests that inject a fake runner still assert on status calls — branch to the runner-based path when `self.runner is not subprocess.run`.
- Tests that asserted `active_profile()` returns a state-file value even when another gateway is running must be rewritten to assert the running gateway wins and the stale state file is repaired.
- A test that mocks a sequence of `status` outputs needs one extra entry: `active_profile()` now consumes a status call before the switch logic does.

## Adding an independent bot beside a running multiplexer

When a second, unrelated bot must run while a multiplex gateway serves the preset group, give it a **separate HERMES_HOME outside the shared `profiles/` tree**. The multiplexer enumerates every live profile directory and hot-reconciles their adapters; a new `profiles/<name>/.env` with a bot token is adopted automatically and holds that token, so the intended standalone gateway can never start. There is no per-profile allowlist in this build — isolation by directory is the reliable mechanism.

```
src = <HERMES_HOME>/profiles/<name>          # created earlier
dst = %LOCALAPPDATA%\hermes-standalone-<name>
# Move config/.env/SOUL.md there; a locked .__agent.lock can block shutil.move on Windows,
# so copy the files and leave the locked leftover directory behind if needed. Ensure no
# .env under profiles/ still contains the new token (fingerprint-check, never print it).
```

Startup order:

1. Restart the multiplex gateway once after removing the token from the profiles tree; confirm its state no longer lists `<name>:telegram` as connected.
2. With `HERMES_HOME` exported to the standalone home, run `hermes gateway install --no-start-now --start-on-login` (avoid the interactive install prompts), then start the process directly with `python -m hermes_cli.main gateway run --replace --force` as a background terminal process. `hermes gateway start` from a secondary HOME may report another home's running PID (`Gateway already running`) instead of starting this one.
3. Check `<standalone-home>/gateway_state.json` for `gateway_state == running` and `telegram: connected`; the adapter can take ~40 s to connect.
4. Verify externally: read the token from that HOME's `.env` in-process, call `getMe` (username/id), then `sendMessage` to the owner. Confirm the model from that HOME's `config.yaml`, not the default profile's.

A clean standalone profile needs the provider API key copied from the default `.env` programmatically; secrets never appear in output. An `inbound message` logged before the standalone startup belongs to the earlier multiplex owner, not a verified answer from this gateway.

## Cleanup of the catch-all target

The catch-all profile must not carry other presets' skills. Walk its `skills/` tree for `pdf`, `short-video-*`, `grok-image-*`; move offending top-level directories into a `skills-quarantine-<stamp>/` sibling rather than deleting them. A `fatal` platform like `<other-profile>:telegram` ("credential is held by another gateway — parked") is expected and harmless; do not stop the other gateway to clear it.
