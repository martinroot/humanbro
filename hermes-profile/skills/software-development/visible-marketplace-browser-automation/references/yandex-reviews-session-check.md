# Yandex accounts in Fury: session check and login recovery

Verified on 2026-11-23 across nine Fury profiles (`rev_yandex_2,3,4,15,16,17,18,19,20`).

## Two independent checks — do both

1. **Session**: open `https://id.yandex.ru/profile` in each profile with
   `fury_open_url` and read the page. A live session lands on `id.yandex.ru`
   (or a Yandex service page) with no `passport.yandex.../auth` in the URL and
   no «Войти»/«Пароль» prompt.
2. **Target page**: open `https://reviews.yandex.ru/`. A live session lands on
   `https://reviews.yandex.ru/ugcpub/cabinet` (sometimes `?main_tab=professions`)
   with blocks «Задания», «Оценки и отзывы» and organization links
   `yandex.ru/profile/<id>`. A public organization page or
   `yandex.ru/collections` is NOT proof of a dead session — re-open the URL and
   wait; the SPA can redirect first. Only `passport.yandex.ru/.../auth/...`
   means login is required.

Use Fury MCP (`fury-agent.exe mcp`, stdio JSON-RPC); HTTP `/v1` cannot drive pages.
`fury_click` takes `element` (the `n` from `fury_read_page`), not `n`.

## Login when Yandex asks for a phone

The `auth/add` page offers «Ещё» → **«Войти по логину»**. That path accepts the
login/password pair and the control question, so a missing phone number is not
a blocker. Verified sequence for one previously logged-out profile:

1. Click «Войти» on the reviews page.
2. On `auth/add` («Введите номер телефона»), click «Ещё», then «Войти по логину».
3. Type login into the «Логин или email» field, submit.
4. Type password into the `type=password` field, submit.
5. Answer the control question field, submit.
6. On the WebAuthn registration prompt, click «Напомнить позже».
7. Re-open `https://reviews.yandex.ru/` and verify the cabinet.

Credentials live in a protected local file
(`C:/Users/Administrator/AppData/Local/Temp/fury-install/failed_accounts_creds.txt`),
not in source, chat or reports. Read values from the file inside the script;
never print login, password or the answer. On this host the owner supplied them
explicitly for recovery; otherwise hand login back to the owner in the visible
window rather than guessing.

## Reporting

Report the two checks separately and by profile id. "Nine sessions alive" is
only claimable after both `id.yandex.ru` and the reviews cabinet were read for
all nine; a healthy proxy or a live Fury profile proves neither.
