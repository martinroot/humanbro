# Launching a Dolphin profile: start, ports, proxy refresh

Companion to the pool skill. Covers getting an existing profile RUNNING with a
usable CDP port, and the two failures that stop it: a dead proxy and a
misleading status.

## Start through the local API

The cabinet's local API listens on `http://127.0.0.1:3001` and takes a Bearer
JWT (the value of `DOLPHIN_API_KEY` in `dolphin.env`) on **every** call:

```text
POST /v1.0/auth/login-with-token   {"token": "<JWT>"}   → {"success": true}
GET  /v1.0/browser_profiles/<id>/start?automation=1      → {"automation":{"port":57854,"wsEndpoint":"/devtools/browser/..."}}
GET  /v1.0/browser_profiles/<id>/stop
```

**Grep ONLY `dolphin.env` for this key.** The tree also has a `browser-automation/.env` whose `TOKEN=` lines look plausible and fail with `invalid session token` — the Dolphin JWT lives solely under `DOLPHIN_API_KEY` in `dolphin.env`. A login that answers `{"success":false}` with the token from the wrong file is a misread, not an expired key; the same `.env` sends the SAME wrong token to the cloud API, so both hosts fail identically and the diagnosis looks like a dead cabinet. After the JWT login, the local API keeps the session in the server process and later calls need the SAME Bearer header — a bare curl that logged in and then called without the header gets `invalid session token` even on a healthy cabinet.

The start call BLOCKS while the browser comes up — allow a timeout of ~150 s
instead of the default. Lists and reads (profiles, proxies) live on the CLOUD
API `https://dolphin-anty-api.com` with the same Bearer token: `GET
/browser_profiles`, `GET /proxy`.

## The CDP port comes from three places, in this order

1. the `automation.port` field of the start response;
2. `<dataDir>/DevToolsActivePort` (second line of the file is the ws path) —
   `C:\Users\Administrator\AppData\Roaming\dolphin_anty\browser_profiles\<id>\data_dir\DevToolsActivePort`;
3. a listening `127.0.0.1:<port>` owned by a process whose command line carries
   `--user-data-dir=...\browser_profiles\<id>\`.

Then connect with `chromium.connectOverCDP('http://127.0.0.1:<port>')`.

**Never take a port number alone as proof that it belongs to the profile** —
several profiles run side by side and the ports look alike; match the port to
the profile id through one of the three sources above.

## E_PROXY_CHECK_ERROR: refresh the proxy, do not fight the start

A start that answers
`{"success":false,"error":"E_PROXY_CHECK_ERROR"}` means the profile's proxy
did not answer the cabinet's check — the start will never succeed until the
proxy is alive, and retrying the start just repeats the 500.

1. `GET https://dolphin-anty-api.com/proxy` and read `changeIpUrl` for the
   profile's proxy id.
2. GET that `changeIpUrl` (it is a provider refresh link) → `{"success":true}`.
3. Prove the proxy answers **before** starting again:
   `curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x http://<login>:<pass>@<host>:<port> https://yandex.ru/`
   — `000` is still dead, `302`/`200` is alive.
4. Only then start the profile.

A refresh issues a NEW exit IP. That is the same class of change as moving the
account's region, so record it (the new IP shows up in the proxy's `lastCheck`)
and never use refresh as a way to fake a city — the owner forbade rotating
proxies for geography; region lives in the account settings and the CDP
geolocation override.

## Proving a profile is open — the cloud status LIES

The cloud list's `ports` / `session_id` / `lastRunAt` fields can read empty
and `null` for a profile that is in fact running (started locally, or the
cabinet UI not yet refreshed). Read the ground truth instead:

```powershell
# windows whose title is the profile name
Get-Process anty | Where-Object { $_.MainWindowTitle -eq 'rev_yandex_3' }
# or: the listening port + the process command line carrying the profile's data_dir
```

`anty.exe` with `--user-data-dir=...browser_profiles\<id>\data_dir` plus a
LISTENING debug port IS an open profile; the owner sees the window on the
desktop. A profile that fails every browser action while the API reports
success is usually this case inverted — check the window before debugging the
script.

## One profile at a time while an order is in flight

Start ONE profile per order — never two just to compare candidates (owner: «А зачем тебе 2 профиля? Там 1 отзыв нужен»): start one, read its cabinet for the review count, decide, and stop it if it loses the comparison. An open profile is ~9 `anty.exe` processes and a visible window. The queue is
serial: while the current order runs, other profiles stay stopped (the owner
closes them explicitly: «Если не стоит режим исполнение — закрываем всегда все
Dolphin профили»). Closing: the documented `GET /v1.0/browser_profiles/<id>/stop`
answers `{"success":false,"error":"feature_disabled"}` (403) for a profile started
with `automation=1`: without `properties.manage_lifecycle=true` at start the
cabinet refuses to stop it, so for such profiles the supported path is a
process kill, run after the order's evidence is captured — not "just in case":

```powershell
# single-quote the WHOLE -Command for bash: it eats $_ inside double quotes,
# and match the PROFILE id in the command line — never kill by port alone,
# a port-only sweep can take out a neighbouring profile's window
powershell -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "anty.exe" -and $_.CommandLine -match "<profileId>" } | ForEach-Object { $_.ProcessId }'
taskkill /PID <pid> /T /F
```

Confirm the close the same way an open one is proved: the debug port stops
listening and the window is gone. PIDs that answer "not found" on a second
kill were already taken by the first `/T` sweep — that is success, not an
error.

## Session cookies as a fallback

Per-profile exported cookies live at
`reviews/data/session_<n>_<profileId>.json` (captured earlier through CDP).
They open the author's cabinet in a THROWAWAY browser for reads, but they carry
the account's other orders with them (see the cabinet warning in
`order-attachments-and-screenshots.md`), and the egress IP differs from the
profile's proxy — so they are for inspection only, never for publishing.