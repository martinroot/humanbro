# Fury antidetect browser: install and migrate an existing pool

Use when replacing or adding an anti-detect browser while keeping the account → profile → proxy binding. Fury is AGPL, standalone by default, and exposes a local automation API.

## Install (Windows)

1. Download **both** the app installer (`fury-<v>-windows-x64-setup.exe`) and the core archive (`fury-core-<v>-windows-x64.tar.xz`) from the release. The installer alone leaves the agent with `core: null`.
2. Verify each file against `SHA256SUMS` with an **exact filename match**. A loose `grep 'windows-x64-setup.exe'` also matches the `.sig` line and reports a false mismatch; compare against `grep '<exact-name>$'`.
3. Run the installer silently; it lands in `AppData/Local/Fury` (`fury-agent.exe`, `fury-desktop.exe`). Extract the core into **`AppData/Roaming/Fury/core.bundle`** — that is the path the agent queries, not the install directory. Confirm via `GET /v1/status`: `data.core` must end in `core.bundle\chrome.exe`.
4. The automation API is off by default. Start `FURY_API_PORT=35000 fury-agent serve`; the token is written to `AppData/Roaming/Fury/api-token`. Send it as `Authorization: Bearer <token>`. Verify `GET /v1/status` and `GET /v1/profiles` before reporting anything as installed.
5. Launch a profile with `POST /v1/profiles/start`, body `{"id":"<uuid>","cdp":true}` → `data.debug_port` and `data.ws_endpoint`. There is **no** `/profiles/<id>/start` endpoint. Verify `http://127.0.0.1:<debug_port>/json/version`. Stop with `POST /v1/profiles/stop`.

## Migrating from Dolphin Anty

- The built-in «Из другого антидетекта… → Dolphin Anty» importer calls the **cloud** Dolphin API and needs a panel token. A local `DOLPHIN_API_KEY` returns `422 Unprocessable Entity` there even though the same token works on `http://localhost:3001`. Do not spend time re-trying the local token in that dialog.
- Working path: read profiles and proxies through the vendor's local API (`/`v1.0/*`/`, token login first), build a CSV with columns `name,proxy,tags,notes`, then use «Добавить много… → Импорт CSV…». A one-row test import first confirms the header mapping before committing all rows.
- Write the proxy as a full URL `scheme://user:pass@host:port`; Fury parses it into host/port/username and creates one proxy record per distinct line. Keep the vendor id in `notes` so the two pools can be reconciled.
- **Fingerprints do not migrate** — Fury assigns its own device/seed with the same OS. Sessions/cookies do not migrate through the CSV path; plan a re-login or a separate cookies export.
- Verify by reading back `GET /v1/profiles`: count must equal source count and each profile must carry a parsed proxy object. Then start one profile with CDP and check `/json/version`.

## Re-authenticating migrated profiles from the registry

When the old browser's cookie export is unavailable, restore sessions by logging in, not by decrypting cookies.

- Source credentials live in the account registry (`registry.py list-accounts` gives ids/profiles; `registry.py export-creds --account <id>` returns login/password/security answer). Never print or pass the password in a chat message or tool argument; the login script should read it from the registry process itself.
- For each identity: map its source profile id to the destination profile name, start that profile through the API with `cdp:true`, run the login script against the returned `debug_port`, then stop the profile. Process profiles serially — one browser at a time.
- A Yandex login script must (1) branch on the **password field**, not URL; (2) include `input[type="email"]` in the login-field selector — after choosing the "Логин, почта…" option the field type changes and a text-only selector silently skips the login step; (3) answer the security question from the registry; (4) defer the WebAuthn/passkey enrolment dialog; (5) end with `process.exit(0)`, never `browser.close()` — closing over CDP kills the profile's browser.
- Verify in the browser, not in logs: navigate to the account page (e.g. `https://id.yandex.ru/`), wait ~8 s for hydration, read `document.body.innerText` and assert the expected login is present. A URL or title of `id.yandex.ru` alone does not prove authentication; a login check that runs too early can also read "not found" on a session that did land, so re-read with the longer wait before declaring failure.
- Two hard blockers, both reported to the owner rather than worked around: a `pwl-yandex/auth/add` page asking for a phone number means the recovery data is missing and the account cannot be logged in without it; `ERR_TUNNEL_CONNECTION_FAILED` / `ERR_CONNECTION_CLOSED` while loading the login page means the proxy port is dead and must be replaced. Do not remove the proxy to make the page load.

## Proxy health before trusting a migrated profile

- Probe each imported proxy independently (`curl -m <t> -x <url> https://api.ipify.org`) **before** blaming the new browser. A rejected `Win_msk`-style profile with `upstream failed — refusing, not falling back` in the agent log means the proxy port is dead, not that the profile is corrupt.
- Fury deliberately refuses to fall back to the host IP on proxy failure — preserve that; never "fix" it by removing the proxy.

## GUI automation of the Tauri desktop app

- Background `key_combo` delivery is dropped by Tauri windows; escalate to `delivery_mode='foreground'` or use the accessibility `set_value` action on Edit fields. `set_value` on a Tauri Edit works and the app reparses the value immediately (watch for the «прочитано как / N строк» confirmation).
- For large or secret-bearing payloads, do not pass the value as a tool argument: write it to a UTF-8 file, load it into the clipboard from that file (`Set-Clipboard -Value ([Console]::In.ReadToEnd())`), or use the file-picker button and type only the path. Same rule for API tokens: load from the gitignored env file into the field without echoing it.
- Close the profile after verification; every open profile is a Chromium process tree.
