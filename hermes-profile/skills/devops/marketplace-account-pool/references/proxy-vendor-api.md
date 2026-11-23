# Buying a proxy pool programmatically (provider purchase API)

Companion to the pool skill. The antidetect cabinet is a registry, not a shop —
it has no billing route. But the **proxy provider's own API often does**, so
"buy proxies via API" is usually available one hop away. Verified instance:
ASOCKS (`https://api.asocks.com/v2`), the vendor already integrated with the
cabinet in use.

## Authentication style differs per provider — read it, don't guess

- **ASOCKS: the key travels as a query parameter** — `?apiKey=<key>` on every
  call. Sending it as `Authorization: Bearer`, `X-Api-Key` or an
  `apiKey` header returns `401 Unauthenticated` for every route, which reads
  as "the key is wrong" when the key is fine and the *placement* is wrong.
- The key belongs in a gitignored env file next to the client script, read at
  call time — never in source, never in a report.

## Purchase API (ASOCKS)

| Call | Purpose |
|---|---|
| `GET /v2/user/balance` | balance and currency |
| `GET /v2/plan/info` | tariff, expiry, per-port data URLs, proxy list download links |
| `GET /v2/proxy/ports` | owned ports: id, port, server, country, city, status, expiry, type |
| `POST /v2/proxy/create-port` | **buy ports** |
| `GET /v2/proxy/refresh/{id}` | rotate the egress IP of one port |
| `GET /v2/dir/countries` | country codes |
| `GET /v2/proxy/search` | full pool export incl. credentials (tens of MB — stream it, don't page it) |

Create-port body — every field is required and the names are snake_case:

```json
{"country_code": "RU", "count": 1,
 "type_id": 1, "proxy_type_id": 1, "server_port_type_id": 1}
```

- `type_id` 1 = residential, 2 = mobile (verify against the provider's type
  list before buying volume — the id is not self-describing).
- A camelCase key (`countryCode`) returns `422 "can not find or create proxy
  with this params"`, which reads as "the country is unavailable" rather than
  "the field name is wrong".
- The response carries the created ports with their id, port, server host,
  country, status and generated name.

## Buy one, then batch

Purchase is a paid, irreversible action. Run it end-to-end with `count: 1`
first — read the created port back from `GET /v2/proxy/ports`, confirm the
country and the type are what was asked for, and only then scale the count.
The balance endpoint is the check: the delta after a purchase is the proof
that the plan, not the type id, was the thing you got wrong.

## From provider to cabinet, automatically

The provider's ports carry credentials and usually a per-port rotation
endpoint. Register each in the antidetect cabinet and bind it to a profile:

```
POST /proxy           {type, host, port, login, password, name, provider, changeIpUrl}
PATCH /browser_profiles/{id}   {"proxy": {"id": <cabinet proxy id>}}
```

The PATCH body field is the **object** `proxy`, not the integer `proxyId`: `{"proxyId": N}` answers `200` with the full profile body and silently binds nothing, and the profile then egresses on the host IP while every check looks healthy. Bind the **cabinet's** proxy id — the vendor's port id and the cabinet's id are different numbers.

`changeIpUrl` is the provider's own refresh endpoint for that port; storing it
in the cabinet's proxy record makes rotation a call instead of a rebind. The
cabinet's `provider` field is how the pool is later counted by vendor.

**One port per account, and the busy-list must include your own registry.** Excluding only the ports already referenced by cabinet profiles is not enough: if a binding silently failed, that port looks free to the cabinet and the next account is handed the same one. Compute the busy set from the cabinet's profiles *and* from your own account→proxy assignments, then re-read the binding after each write.

## Reading a docs site that is a JS app

The provider's operation reference is usually a single-page app that takes the
key in the URL and stores it in `sessionStorage`. A plain fetch of it returns
the shell and no content. Read it in a browser (the key in the query string
populates the session), and pull the endpoint, the required body fields and
the type ids from the rendered operation page rather than from a
minified bundle — the bundle is where a stale path hides.

## A mobile pool's IP is a point-in-time fact, not a property

Residential **mobile** ports egress from a rotating address: the same port
returned a different IP and a different city on the next request. So "the
proxy is confirmed" means *the egress was observed from the right country at
that moment*, and it must be recorded that way — with the address, the city
and the ISP — never as a fixed attribute of the account.

When a client demands a stable IP per account, a rotating mobile port cannot
serve that requirement; bind such an account to a port whose egress is
stable, or rotate it explicitly before the session that must keep the address.

## What still needs a human

A purchase API buys the port, not the geography the account needs. Confirm the
country mix of the pool after buying, and confirm the pool was not already
shared with other accounts — one port serving several identities defeats the
isolation the pool exists for.
