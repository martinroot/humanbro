# Provisioning Dolphin Anty profiles that actually start

Companion to the pool skill. Creating a profile through the cabinet's REST
API is the obvious way to make one per account, and it is the way that
produces profiles that **cannot be launched at all**. Verified instance:
Dolphin Anty (`https://dolphin-anty-api.com`).

## The symptom that identifies the trap

- `GET /browser_profiles/{id}` answers **500** for the API-created profile
  and 200 for a profile made by hand in the cabinet.
- `POST /v1.0/browser_profiles/{id}/start` answers **500**, and the client
  log shows the real reason: `POST https://darkwing.dolphin-anty-api.com/api/v1/start`
  → 500 while preparing the launch parameters.
- The same client, the same local API, the same proxy, the same operator:
  a hand-made profile starts fine. So it is not the network, the key, the
  proxy or the account.

The cause: a profile created through `POST /browser_profiles` comes back with
the fingerprint block **empty** — `deviceName`, `locale`, `timezone`, `screen`,
`canvas`, `webgl`, `webrtc`, `audio`, `cpu`, `memory`, `mediaDevices`,
`clientRect` are null or empty objects. The launch-preparation service needs
those fields and fails on the incomplete record.

## Fix: clone a working profile

Read a known-good profile completely, carry its field set over, and override
only what must differ (name, User-Agent, proxy).

```python
шаблон = api(f"/browser_profiles/{РАБОЧИЙ}").get("data") or {}
тело = {k: v for k, v in шаблон.items()
        if k not in СЛУЖЕБНЫЕ and v is not None and v != {} and v != []}
```

Exclude the server-managed keys — they are rejected or ignored on create:
`id, teamId, userId, created_at, updated_at, deleted_at, lastRunAt,
lastRunUuid, lastRunningTime, lastStartTime, archived, access,
runsAvailable, cookiesHash, datadirHash, cloudSyncDisabled,
cloudSyncDisabledOnMachineId, lastRunnedByUserId, folder, addedSortingName,
isHiddenProfileName, tabs, homepages, newHomepages, bookmarks, extensions,
extensionsNewNaming, userFields, notes, password, login, running,
storagePath, ports, proxyId, webgpu`.

Two traps in that set:

- `webgpu` arrives as an **array** and the create schema wants an object:
  `422 validation.array` with the field named. Drop it.
- `proxyId` must not be carried over — bind the proxy after creation with
  `PATCH {"proxy": {"id": N}}` (see the pool skill for why the object form
  is the only one that binds).

After the clone the profile reads 200 and starts.

## If you must create from scratch, fill the fingerprint

`GET /fingerprints/fingerprint?platform=<navigator.platform>&browser_type=anty&browser_version=<major>`
returns a ready fingerprint block; `PATCH {"fingerprint": {...}}` makes the
backend expand it into the flat fields.

- `platform` is the **navigator** value: `windows` works, `win32` and
  `win64` return an empty array (HTTP 200, no data) — the empty result
  reads as "no fingerprint available" and is easy to mistake for a wrong
  platform.
- `browser_version` is **required**: omitting it gives
  `422 validation.required`.
- The block does not carry `canvas`/`webgl`/`webrtc`/`deviceName`; the
  cloned template is still the better source for those.

## Keep the fingerprint internally consistent

The pool exists to look like independent people, and an inconsistent
fingerprint is louder than a plain one. From one UA string derive everything:

- **UA and OS must agree.** A profile with `platform: windows` and a Linux
  UA is a contradiction the moment `navigator.userAgent` and
  `navigator.platform` are compared. Filter the UA pool to the profile's
  own OS family.
- **`uaFullVersion` must come from that same UA.** If it is left alone the
  cabinet writes its own browser version, and you get a UA saying
  `Chrome/143` next to a Client-Hints version of `155`.
- **`platformVersion`** should match the working profile's value for the
  same OS, not a value parsed out of the UA by accident.
- **Locale and timezone** belong to the proxy's country: an RU proxy with
  `ru-RU` and `Europe/Moscow` is coherent; an RU proxy with `en-US` and
  `Europe/Paris` is not.

## One profile per account, and no leftovers

Every failed attempt leaves a profile in the cabinet. A diagnostic run
produced ten profiles for three accounts, which is what the owner noticed
and objected to. The pool is the count of **accounts**, not the count of
attempts: after provisioning, delete the failed ones, and count the cabinet
before reporting.

## Verify the egress per port, not per purchase

A vendor's country field is the **request**, not the outcome. Purchased
ports labelled `country_code: RU` returned Netherlands, Germany and other
egresses. For each port, make a real request through it and look up the
resulting IP's country and ISP.

If a port egresses from the wrong country, rotate it:
`GET /v2/proxy/refresh/{id}` (ASOCKS) — the port keeps its id and its
credentials, and the next request leaves from another address.

## Launching the local client on Windows

The cabinet's local API listens on `localhost:3001` and only exists while
the desktop client runs.

- `cmd.exe /c start "" "Dolphin Anty.exe"` from a shell **hangs** the
  calling command — the start command waits on the GUI process. Launch the
  executable directly in a background process instead.
- `GET http://localhost:3001/` answers `401` — that is the client being
  alive, not a fault. Authorise with
  `POST /v1.0/auth/login-with-token {"token": <key>}` before calling
  `/v1.0/...` routes.
- `POST /v1.0/browser_profiles/start` with a body creates a **temporary**
  profile and answers `200` with a new profile id. It is not "start this
  profile" and it is not a way around a failing start.
- `GET /v1.0/browser_profiles/running` returns the running profiles with
  their run ids — use it to see what is actually up.
- The local panel's `POST /v1.0/auth/login-with-token` answers `{"success":true}`
  **without handing back a token or a cookie**, so the list routes keep
  answering `401 invalid session token` regardless of the header style used —
  `GET /v1.0/browser_profiles` included. Treat that as a panel-session problem,
  not as a broken account: do not re-login the identities on the strength of
  it, and prove their sessions from the profile's own data dir instead (see
  `references/account-login-and-session-binding.md`).
- **The per-profile routes are not affected by that 401.** After the same
  login-with-token call, `GET /v1.0/browser_profiles/{id}/start?automation=1`
  answers `{"success":true,"automation":{"port":<cdp port>}}` and
  `GET /v1.0/browser_profiles/{id}/stop` answers `{"success":true}`. So the
  working path is: **start and stop through the local API, list and read
  metadata through the cloud API** — do not conclude from the failing list
  route that profiles cannot be launched.
- **Starting an already-running profile answers `409` with
  `PROFILE_ALREADY_RUNNING`**, not a start. The profile is already up; recover
  its CDP port from the data dir instead of retrying — the port sits in
  `browser_profiles/<id>/data_dir/DevToolsActivePort` (first line) while the
  profile runs, and the same file is the fallback whenever the start route
  answers `409`.
- The **cloud** API answers for profile metadata even when the local panel
  does not. `GET /browser_profiles` lists names, proxy bindings and
  `lastRunAt`; `POST /export-cookies` can answer `200` with **zero domains**
  for a profile that is demonstrably logged in, and `lastRunAt` can read
  "never run" for a profile that clearly ran. Both are a summary of what the
  panel knows, not the state of the identity — the profile's data dir is the
  state of the identity.

## Reading the launch failure out of the client log

The client log under `%APPDATA%/dolphin_anty/logs/` names the failing call
and the reason; grep it for the profile id. Two lines decide the case:

- `POST .../api/v1/start` → 500 = the profile record is incomplete (clone it).
- `EBUSY: resource busy or locked, open ...\DevToolsActivePort` = the
  previous instance of that profile did not release the port; stop the
  profile first.

## Checking the IP through the profile

`2ip.io` redirects to its slash form, and a strict `waitUntil: "domcontentloaded"`
loses the navigation to that redirect and errors out. Use
`waitUntil: "commit"` with a short settle, and retry the read a few times.
Read the page text, not a single field: the useful line is the country,
and the neighbouring words identify the city.
