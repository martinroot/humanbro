# Dolphin Anty — verified API integration notes

Distilled from the vendor's own LLM-friendly OpenAPI document and help-center automation article. Read these before probing the API: the start call is a **GET with a required query parameter**, and guessing a `POST` returns `404` that looks exactly like a missing feature or a plan restriction.

## Getting the spec

The docs site is a JS app whose body web extraction returns empty. Fetch the machine-readable document the page links instead — it is served from the same CDN as a raw `openapi.yaml`, and users often download it straight into `Downloads/`. From it, read `servers` for the real host list (this is where `http://localhost:3001` appears), `paths` for the verb on each operation, and each operation's `requestBody` schema for required fields. The account JWT decodes without verification to reveal `team_plan` and expiry — useful for knowing the tier without printing the token.

## Where things live

| Purpose | Host | Notes |
|---|---|---|
| Cloud (list, create, inspect) | `https://dolphin-anty-api.com` | Bearer panel JWT |
| Cloud v2 | `https://apiv2.dolphin-anty-api.com/api/v2` | Bearer panel JWT |
| **Local (start, stop)** | `http://localhost:3001` | only while desktop app runs, same machine |

The profile **launch** capability exists only on the local API. The cloud API returning `404` for a start call is correct behaviour, not an entitlement limit — do not report it as a paywall.

Local port is 3001 by default and moves if busy; the running port is shown in Dolphin's Health window.

## Auth

- Cloud: `Authorization: Bearer <panel JWT>` on every request. Token is minted in the web panel.
- Local: requires an active session first. Log in with the same JWT before any other local call:

```
POST http://localhost:3001/v1.0/auth/login-with-token
Content-Type: application/json

{"token": "<panel JWT>"}
```

Response `{"success": true}`. Skipping this gives `401 {"error":"invalid session token"}` on every subsequent local call — including after a successful-looking login, so re-check the verb and query string before concluding the session failed.

## Start and stop — GET, with `automation=1`

```
GET http://localhost:3001/v1.0/browser_profiles/{id}/start?automation=1
GET http://localhost:3001/v1.0/browser_profiles/{id}/start?automation=1&headless=1
GET http://localhost:3001/v1.0/browser_profiles/{id}/stop
```

`automation=1` is mandatory: without it the browser starts with no DevTools endpoint.

Success shape:

```json
{"success": true,
 "automation": {"port": 60453,
                "wsEndpoint": "/devtools/browser/<uuid>"}}
```

Attach the same way as any CDP browser: `chromium.connectOverCDP("http://127.0.0.1:60453")`. The port is assigned per launch — read it from this response, never cache it.

The call returns as soon as the browser is up. Tab management and automation then run over the CDP connection or the desktop app; nothing else is needed from the API.

## Cloud calls worth knowing

```
GET  /browser_profiles                 list
GET  /browser_profiles/{id}            detail
POST /browser_profiles                 create
POST /browser_profiles/mass            bulk create
GET  /proxy                            list proxies
GET  /fingerprints/useragent?browser_type=anty&browser_version=140&platform=windows
GET  /fingerprints/webgl?browser_type=anty&platform=windows
```

### Binding a proxy to a profile

`proxy` in the `POST /browser_profiles` body is **silently dropped** — the profile is created and comes back with `proxyId: 0`, so it egresses on the host IP while every API call still looks healthy. Bind in a second call and read the field back.

**The PATCH body field is `proxy` (an object), not `proxyId` (an integer).** This is the trap: `{"proxyId": <id>}` answers `200` with the full profile body and **changes nothing** — the profile still reports `proxyId: 0`. The write that works:

```
PATCH https://dolphin-anty-api.com/browser_profiles/{id}
Authorization: Bearer <panel JWT>
Content-Type: application/json

{"proxy": {"id": <cabinet proxy id>}}
```

`PUT` on the same path answers `405`; `PATCH` is the verb. After the patch, confirm the binding from the **list** endpoint — a per-id `GET /browser_profiles/{id}` may answer `500` while `GET /browser_profiles` returns the same profile with its fields intact, so read bindings from the list and do not conclude the patch failed from a per-id error.

**Two different ids are involved; mixing them fails silently.** The cabinet's proxy record has its own id (returned by `GET /proxy`), while the upstream vendor's port has a different id (returned by the vendor's port list). Bind the **cabinet** id. The profile's own `proxyId` then echoes that cabinet id.

**Do not put `statusId` in the profile PATCH.** It answers `403 E_BROWSER_PROFILE_ACCESS_DENIED ("You do not have access to this status")` — a permissions wall, not a validation error — and it aborts the whole patch, so a combined `{"statusId": 4, "proxy": {"id": N}}` binds nothing. Send the proxy alone.

The `platform` values are `Windows`, `MacOS`, `Linux`; both fingerprint calls require the Authorization header.

Hardware fields are cross-checked against a table of real configurations (OS vs GPU vs cores vs memory). An impossible combination is rejected with an error naming the bad field. When profile creation starts failing after it worked, read the response body — the usual cause is an incompatible hardware combination, not a quota.

## Session migration

Cookies and localStorage are separate surfaces and either may hold a marketplace login:

```
POST /v1.0/import/cookies/{id}/robot          run cookie robot
POST /v1.0/export-cookies                    export cookies
GET  /v1.0/local-storage/export/{id}         export local storage
POST /v1.0/local-storage/import              import local storage
```

### Importing cookies you already have

A purchased or hand-captured session is imported as a JSON array. The cloud route
`POST /cookies/import` takes `browserProfileId` + `cookies`; the local route
`POST /v1.0/cookies/import` takes `profileId` + `cookies` + `transfer` (0/1 or
boolean). Each cookie object requires exactly these five fields:

| Field | Type | Notes |
|---|---|---|
| `domain` | string | hostname the cookie applies to; a leading dot covers subdomains |
| `name` | string | cookie name |
| `path` | string | resource path scope, e.g. `/` |
| `value` | string | raw value |
| `expirationDate` | int64 | **milliseconds** since the Unix epoch (Chromium format) |

Optional: `secure` (bool), `httpOnly` (bool), `sameSite` (`no_restriction` |
`lax` | `strict`). Netscape cookie files must be converted to this shape before
import — the endpoint takes JSON objects, not a text blob.

### The cookie robot

`POST /v1.0/import/cookies/{browserProfileId}/robot` with `data` = array of
absolute URLs, plus `headless` and `imageless` booleans. The robot opens each
URL **sequentially**, waits for network idle, pauses a couple of seconds for
late async requests, extracts the cookies the site produced, closes the tab and
moves on. This is how a profile is warmed on a real site without a visible
browser: it is the migration path for a session that must be re-established
rather than pasted.

## Bulk operations

`POST /browser_profiles/mass` creates many profiles in one call: `items` is an
array of the same objects as single-profile creation, and an optional `common`
object applies the same values to every element before validation. Bulk-create
one profile per account, then bind each proxy individually.

`POST /proxy` registers a proxy in the cabinet: required `type`
(`http`|`socks4`|`socks5`|`ssh`), `host`, `port`; optional `login`, `password`,
`name`, `provider`, `changeIpUrl`. This is the route for onboarding proxies
bought elsewhere — the cabinet is a registry, not a shop.

## The cabinet does not sell proxies

Inventory the whole spec before promising automation of a purchase. The path
list contains **no billing, balance, order or reseller route** — only
`/proxy` CRUD and the `/v1.0/*` runtime calls. Buying proxies happens in the
provider's own cabinet; what the antidetect API can do is register the
credentials (`POST /proxy`), bind them to profiles, and rotate their egress IP
on demand. Say that plainly rather than promising to "buy via API".

## Rotating the egress IP without restarting the profile

Each proxy record may carry `changeIpUrl` — a provider endpoint that returns a
new IP for that port on request. Hit it and the profile's next request leaves
from a different address, with no relaunch and no new profile. `provider`
identifies the upstream vendor (one pool in a real account can be entirely
`ASOCKS`, which is also the pool that carries the majority of `changeIpUrl`
records). A pool where one proxy serves several accounts defeats the
one-account-one-IP isolation the antidetect profile exists to provide, so
rotation matters most exactly where the pool is small.

## Limits

- Cloud: 500 requests/min.
- Local: 1500 requests/min.
- Free plan: cookie import/export via API is unavailable (no cloud sync).

## Verifying a started profile

Startup success does not mean the proxy applied. A profile can carry a `proxyId` and still egress on the host IP. Load an IP-echo page in the launched profile and read the country/ISP/proxy line before relying on its geolocation.

## Diagnosing `E_PROXY_CHECK_ERROR` on start

A start that fails with `HTTP 500 E_PROXY_CHECK_ERROR` is a dead proxy record on the profile, not a broken profile. Read the profile's `proxyId`, `GET /proxy/{id}`, and compare its `host:port` against a proxy you have probed yourself. The bound entry is frequently a stale port from an earlier batch that no longer answers, while a sibling entry from the same vendor works fine.

Repoint the existing record rather than creating a new one:

```
PATCH https://dolphin-anty-api.com/proxy/{id}
Authorization: Bearer <panel JWT>
Content-Type: application/json

{"type":"http","host":"<ip>","port":9999,"login":"<user>","password":"<pass>"}
```

`type` is required in the body. Omitting it returns `422 {"error":{"type":"E_VALIDATION","fields":[{"field":"type"}]}}` — a missing field, not a rejected value. The same `422` shape lists the exact field, so read it rather than guessing at the payload.

After the patch the start succeeds and the reported egress IP/ISP changes. Compare the **ISP** string, not just the IP: an unchanged ISP means traffic still bypassed the tunnel.

## Anti-detect value, measured

Render the same target in the shared Chrome profile and in the anti-detect profile and compare. A search engine that serves a bot-check interstitial to the ordinary profile will often render its results page normally in the anti-detect profile. This is the reason to keep the vendor rather than adding more complexity to the existing CDP code, and it is worth confirming on a real target before investing elsewhere.
