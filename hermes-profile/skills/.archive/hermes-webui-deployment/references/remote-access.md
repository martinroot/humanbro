# Remote access for a Hermes web UI

## Choose a path

| Use case | Preferred topology | Gate before opening a public firewall port |
|---|---|---|
| Same PC / LAN-free use | Bind `127.0.0.1` | Local health + API auth checks |
| Owner's devices on a private mesh | Keep app loopback-bound; expose through Tailscale or equivalent | Restrict mesh ACLs, set allowed Host name, enable API token |
| Public DNS URL | TLS reverse proxy to loopback service | TLS certificate, proxy auth or app token, allowed Host, same-origin mutation check |
| Raw public IP without TLS | Avoid by default | If explicitly required, warn that HTTP leaks bearer tokens; require app token and restrict source IPs where possible; do not imply this is secure |

## Configure and verify

1. Generate the token locally using a cryptographically secure RNG; store it in a permission-restricted environment file, not in source, query strings, command-line arguments, or chat.
2. Set the application bind and port explicitly. Prefer the app on loopback behind the proxy; if direct binding is unavoidable, use the narrowest firewall remote-address scope available.
3. Set the app's Host allowlist to the exact DNS name or address clients will use. Confirm the framework accepts the intended IP literal; do not assume a hostname allowlist accepts it.
4. If the API uses header-token auth, verify unauthenticated `/api/...` gives `401` and authenticated requests work. Ensure the static frontend has a password-type input or equivalent that stores the token only for the browser session and adds it as a header. Never place it in a URL.
5. Verify local static page and health first, then verify the exact URL from a device outside the host network. Confirm the firewall rule and listener are still scoped to the intended service.
6. When using a TLS proxy, keep the application bound to loopback; expose only the proxy's TLS port. Do not make both the proxy and raw application port public.

## Windows considerations

- A Linux `.sh` installer or systemd unit is not a native Windows install path. Use the project's manual Python/`uv` procedure and a reviewed Windows launcher.
- Add a firewall rule only for the chosen TCP port and profile; prefer a specified remote IP/range over `Any`. Verify the displayed rule after creation.
- Do not kill/rebind a port-owning process until its executable, command line, and purpose are identified; preserve unrelated user services.
- For a persistent process, use a named Windows service/task only after foreground startup and health checks pass. Keep the token outside the task command line.

## User handoff

Give the URL only after external reachability is verified. State whether TLS is present, what authentication the user must enter, and where the local token can be found without printing it. If auth/TLS or external verification is incomplete, say so and do not claim the public endpoint is ready.
