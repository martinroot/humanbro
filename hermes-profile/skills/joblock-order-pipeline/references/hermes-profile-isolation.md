# Hermes profile isolation for JobLock gateways

## The mechanism that decides isolation
`gateway/run.py` → `build_session_key(..., profile=_profile)` sets `_profile` from
the message source **only when** `gateway.multiplex_profiles: true`. Otherwise the
key is `agent:main:...` regardless of which profile the gateway was started with.
Consequences:
- `profile_switch.MANAGER.switch()` swaps HERMES_HOME (skills/memory) but the
topic's session still lands under `agent:main` in whichever `state.db` is active.
Sequential switching therefore isolates skills, not history — after ~10 profiles
the sessions and skills mix again.
- Real per-topic isolation needs `multiplex_profiles: true` plus `profile_routes`
matching `chat_id` / `thread_id`, so the key becomes `agent:<profile>:...:topic`.
With that, one shared gateway can serve many isolated topics; no `switch()`
per order (a `switch()` in that mode stops the shared gateway for everyone).

## Config recipe
File: `C:/Users/Administrator/AppData/Local/hermes/config.yaml`
- Back up first: `cd C:/Users/Administrator/AppData/Local/hermes && mkdir -p backups && cp config.yaml backups/config.yaml.bak-$(date +%Y%m%d_%H%M%S)`.
- Under `gateway:` set `multiplex_profiles: true`, `auto_multiplex_migration: false` (default; keep it unless a deliberate key migration is planned), and add `profile_routes` entries. Route schema (from `gateway/profile_routing.py`): each entry has `name`, `match` (keys such as `chat_id`, `thread_id`, `thread_ids`) and `profile`; precedence is explicit before wildcard.
- Keep the existing sessions in `agent:main` untouched until the migration is separately approved — flipping the flag does not move them, it only changes where new sessions are written.

## Probe routes before touching a running gateway
```
cd C:/Users/Administrator/AppData/Local/hermes/hermes-agent
"C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" -c "import yaml; from gateway.profile_routing import load_profile_routes, match_profile_route; ..."
```
Load the routes via `load_profile_routes(config)` and call `match_profile_route`
with a fake source carrying the real `chat_id` and a test `thread_id`. Expect the
profile name for each configured topic and the wildcard profile for an unknown
topic. This is read-only; do it before any restart.

## Watchdog / state-file trap
- A Scheduled Task named `Hermes_Gateway_Watchdog` can relaunch a stopped profile
gateway within its tick. `schtasks /Query | grep -i Hermes_Gateway` to enumerate
all gateway tasks, then `schtasks /Change /TN <task> /DISABLE` **before** stopping
a gateway. Otherwise `gateway stop` succeeds and the process comes back.
- `gateway_active_profile.json` (portal directory) can be rewritten by that
watchdog to a profile that is not running. Do not trust it alone. Check both:
```
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'gateway run' -and \$_.Name -match 'python' } | ForEach-Object { Write-Output \$_.CommandLine }"
```
If the file and process list disagree, trust the process list; after disabling the
watchdog, stop the stale gateway and write `{"active_profile": "default"}` to the
state file. Re-check after one full watchdog interval — not immediately.

## Verification checklist
1. Route probe returns the intended profile for each `thread_id` and the wildcard for an unknown one.
2. After a real dispatch, the session key in the target profile's `state.db` is `agent:<profile>:...:<thread_id>`, not `agent:main`.
3. The isolated `empty` profile has no copied skills; a video profile has only short-video skills. Enumerate on disk under `profiles/<name>/skills`.
4. Exactly the expected gateways are running — no orphan `ord-wo-*` gateway left from an earlier `switch()`.
5. Portal still answers `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8701/orders` → `200`.

## Do not
- Do not kill `bun parser.ts` processes to "clean the feed": the gateway parent
  relaunches them and the feed state breaks. Check source counts in the DB instead.
- Do not restart or stop gateways as a "just in case" check. Every restart risks
  an interrupted session and duplicate/missing agents; only act on a concrete
mismatch between route probe, process list and state file.
