# Verifying residential / mobile HTTP proxies

Proxies fail in a small number of characteristic ways that all look identical from the outside: silence. Work the layers separately so the cause is named instead of guessed.

## Layer order

1. **TCP reachability** — a successful socket connect only proves something is listening. It does not mean the proxy works.
2. **Auth challenge** — an unauthenticated request returns `407 Proxy Authentication Required` with a `Proxy-Authenticate: Basic realm="proxy"` header. Seeing `407` is good news: the service is alive and talking to you.
3. **Tunnel** — `200 Connection Established` after `CONNECT`. This is the only thing that proves the proxy carries traffic.
4. **Egress IP** — read the IP the outside world sees. This is the only thing that proves the proxy routes where you think.

A vendor status field like `status: 1` or "works" is not evidence at any of these layers.

## The curl trap on Windows

The bundled `curl` may not send proxy credentials on `CONNECT` when given `-x`/`--proxy`, including credentials embedded in the URL as `http://user:pass@host:port`. A perfectly good proxy then reads as dead: you get either a bare `407` or an indefinite hang. Do not conclude the proxy or the service is broken from that result.

Test the same proxy two ways before blaming it: once with `curl --proxy-user/--proxy-pass`, and once with a hand-built socket tunnel. If the socket works and curl does not, the fault is in the client.

## Building the tunnel by hand

Order is mandatory — TCP to the proxy, `CONNECT`, read the response header, and only then TLS-wrap the same socket:

```js
const auth = Buffer.from(`${login}:${password}`).toString("base64");
const raw = net.connect({ host, port: 9999 }, () => {
  raw.write(
    `CONNECT ${targetHost}:443 HTTP/1.1\r\n` +
    `Host: ${targetHost}:443\r\n` +
    `Proxy-Authorization: Basic ${auth}\r\n` +
    `Connection: close\r\n\r\n`,
  );
});

raw.on("data", (chunk) => {
  const head = chunk.subarray(0, chunk.indexOf("\r\n\r\n")).toString("utf-8");
  if (!/^HTTP\/1\.[01] 200/.test(head)) return finish(null);   // 407 = bad creds
  // only now wrap the SAME socket
  const secure = tls.connect({ socket: raw, servername: targetHost }, () => {
    secure.write(`GET /?format=json HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`);
  });
  // read the JSON body, extract the ip field
});
```

- `200` → tunnel established, keep going.
- `407` immediately → credentials wrong. The service is fine; stop investigating the service.
- No bytes at all → port/proxy genuinely unresponsive.

TLS-wrapping before reading the `CONNECT` response makes the request talk to the proxy server instead of the destination site, which is easy to misread as a dead proxy.

## Triaging a pool that looks dead

- **Test at least two countries before blaming a region.** A pool labelled Russia that never responded worked normally when a German port from the same vendor was created and tested; the country was never the variable.
- **A refresh or re-create call returning `{"success": true}` may not change anything** — same address, same behaviour. A success flag is not a liveness check.
- **A search endpoint returning hundreds of proxy strings proves nothing.** Many results are different credentials against the same small set of addresses. Count *distinct addresses* after probing, not result rows.
- **A port that has never once produced a tunnel is usually not a transient outage.** Move on rather than re-testing it repeatedly.

## Reporting

State which layer failed and what was observed, rather than a verdict like "the service is broken". The distinction between "TCP open, `407` on CONNECT" and "nothing at all" is the difference between an auth bug and a dead provider, and it decides what the user does next.

## Keys

Vendor keys arrive pasted in chat, which makes them exposed regardless of where the code stores them. Keep them in a gitignored env file beside the client script, never in source, never echoed into logs, and recommend rotation once the integration is actually in use.
