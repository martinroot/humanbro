# Fury antidetect: managing proxies and profiles via MCP (verified on v0.6.8)

The local HTTP API `http://127.0.0.1:35000/v1` is **read-only for state**:
`/v1/status`, `/v1/profiles`, `/v1/proxies`, `/v1/personas`,
`POST /v1/profiles/start|stop`. There is no HTTP route to add a proxy or
rebind a profile. **The write API is MCP**, over stdio:
`C:/Users/Administrator/AppData/Local/Fury/fury-agent.exe mcp`.
The bundled `shared/mcp/SKILL.md` documents the tools; `agent/src/mcp.rs`
shows they call desktop IPC `proxies.importMany` / `profiles.upsert` /
`profile.launch`.

## MCP client (no third-party deps)

Spawn `fury-agent.exe mcp`, exchange newline-delimited JSON-RPC 2.0 on
stdin/stdout: `initialize` → `notifications/initialized` →
`tools/call {name, arguments}`. Working reference client:
`C:/Users/Administrator/AppData/Local/Temp/fury-install/mcp_client.py`.
19 tools, including `fury_status`, `fury_list_profiles`,
`fury_list_proxies`, `fury_add_proxies`, `fury_update_profile`,
`fury_start_profile`, `fury_stop_profile`, `fury_read_page`,
`fury_click`, `fury_type`, `fury_screenshot`.

## The full proxy replacement flow, all via MCP

1. `fury_add_proxies` with `lines` = newline-separated
   `http://user:pass@host:port` (also accepts `host:port:user:pass`).
   Returns saved entries + unparsed lines. For rotation URLs use
   `fury_update_profile`? No — rotation is not in the MCP schema; set
   `rotate_url` through the desktop UI only when the vendor requires it.
2. `fury_stop_profile` — `fury_update_profile` refuses a running profile
   ("the profile is open; close it first").
3. `fury_update_profile` with `profile` = name/id and `proxy` = the **saved
   proxy's id or name** (empty string removes it). It changes only the
   fields passed; the fingerprint is never touched.
4. `fury_start_profile` with `background: true` — opens a real visible
   window behind others, `page_tools: true` when CDP is available.
5. Verify with `fury_list_profiles {"query": name}` — reports `open` and
   the bound proxy host/port/country. This is idempotent: re-binding to the
   same proxy id and restarting worked in practice.

## Verification outside MCP

- `C:/Users/Administrator/AppData/Roaming/Fury/fury.db`:
  `profiles.proxy_id` → `proxies.host/port`. Both MCP and UI write here.
- `curl -x http://login:pass@host:port https://api.ipify.org` gives the exit
  IP independently of the cached `last_ip`. Mobile proxies rotate: record
  the IP/country at check time, never as a permanent account property.

## GUI fallback

If MCP is unavailable: «Профили» → «Изменить прокси» → «Настроить» → type,
host, port, login, password, rotate_url → «Сохранить». UIA `set_value`
works on the Tauri WebView form, `ctrl+v` foreground does not on the child
modal. AX indices are invalidated by every modal open and by scrolling —
always re-capture. Filter by the search box to reach a row below the
viewport.
