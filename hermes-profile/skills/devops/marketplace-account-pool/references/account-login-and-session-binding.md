# Logging a bought account in, and proving the session is bound to the profile

Companion to the pool skill. A delivered account is not a logged-in account:
the first login is where the platform's own challenges live, and where a
pool quietly loses an identity. Verified instance: Yandex ID
(`passport.yandex.ru`).

## The third field of a delivery is often a security-answer, not a TOTP secret

A delivery line of `login:password:xxx` looks like a 2FA secret, and a
TOTP decoder accepts it — a 6-character word like `Drewes` is valid base32
if you decode the bits by hand instead of using `b32decode` (which demands
a length that is a multiple of 8 and fails with "Incorrect padding").

But a code that computes is not a code that works. The platform decides
which challenge it asks. Yandex after the password asks:

> Введите ответ на контрольный вопрос: Дата рождения бабушки

That is a **security question**, and the delivery's third field is its
answer. Treat the third field as "the secret the platform will ask for",
not as "a TOTP secret", and store it as an answer.

Note that the question differs per account even in one delivery — the same
pool asked "Дата рождения бабушки", "Почтовый индекс родителей" and
"Фамилия вашего любимого музыканта" — so the third field cannot be a
literal answer to any one of them, and the platform accepted it for all
three. Whatever the field really is, it is what the platform asks for, and
that is what to send. Do not build a per-account answer table from the
question text.

**Order of the challenges, so the automation does not stop at the wrong one:**

1. Login page asks for a phone by default. A login name is not accepted
   there. Put it in the URL — `passport.yandex.ru/auth?...&login=<name>`
   — which switches the form to "Логин или email". If that does not work,
   open "Ещё" and pick the login option.
2. Password page.
3. **Security question** — the delivery's third field. If the page says
   "контрольный вопрос", fill the answer; only if it asks for a numeric
   code is a TOTP secret the right thing to type.
4. Offer to sign in by face/fingerprint (WebAuthn). Take **"Напомнить
   позже"** — "Давайте!" would enrol WebAuthn on this profile and change
   how the account authenticates from then on.

After that the account is in, and the profile shows the account's own
name and login.

## One monitor for all orders, not one process per order

Each monitor process holds its own CDP connection to the shared browser. Four
monitors on one port 9222 is four simultaneous connections: the port stops
answering (`/json/version` returns empty) and **every** monitor fails with
`goto: Timeout` — the client's messages stop being read at all. One process
that polls the orders in sequence, over one connection, is the fix.

The guard file a monitor writes must match the cleanup's glob
(`tab-guard-chat-*.json`); a name outside it means the cleanup treats the
monitor's tab as rubbish and closes it mid-poll.

## Appending to a log: `Bun.write` does not append

`Bun.write(path, data, { flag: "a" })` **overwrites** the file — two writes in
a row leave only the second. A monitor that recorded the client's answers that
way kept a single line, and every link and review text it had found was
erased before anyone could act on it. Use `appendFileSync` from `node:fs`.

## A guard must protect its own tab, not switch the cleanup off

A guard file that makes the cleanup `return 0` is a global mute. When actions
run every few minutes the guard is always fresh, the cleanup never runs, and
tabs accumulate until the browser's memory and the CDP port give out. Let the
guard exempt its own tab id and let everything else be cleaned.

## The review text is the client's, and it arrives mixed with instructions

A chat reply contains three different things: the card link, the client's
instructions («switch off geolocation, build a route»), and the review text
itself. Publish only the review text — writing one's own is not allowed. Filter
the instructions out **before** choosing the candidate, not after: the
instruction is usually the longest line, so choosing first and filtering after
drops the review text every time.

A fresh bought account's login page keeps the URL `passport.yandex.ru/auth?...&login=<name>`
all the way to the password prompt — the `pwl-yandex/auth/password` segment only
appears on accounts that already have a password on file. A script that branches
on that URL segment skips the password step entirely: the account ends up on the
id.yandex.ru landing page with no login on it, and the run reports "login done".

Branch on the **presence of `input[type="password"]`** instead. And compare the
final page against **the login of the account being logged in**, not against a
hardcoded list of older accounts — a hardcoded list makes every new account look
like a failed login.

A failed login also looks like a *session* failure on the check page: id.yandex.ru
redirects to the landing page, whose text contains no login and no "Войти". Read
`id.yandex.ru/profile`, not `id.yandex.ru/`, and treat "profile page shows the
account's own name" as the success marker.

## Prove the session, then prove it survives a restart

Three checks, in this order, because each can pass while the previous
failed:

- **Which account is it.** Read the account's own page and look for the
  login string on it. The landing page can show a search box and a "Войти"
  button while the session is actually fine — the redirect to the portal
  is what creates that impression.
- **Which cookies exist.** List cookie **names** only. `Session_id` and
  `yandexuid` are the ones that matter; never print their values.
- **After a stop and a start.** Stop the profile, start it again, and read
  the account page once more. The antidetect client archives the data dir
  and uploads it on stop, so a session that survives the restart is bound
  to the profile for good. A session that only exists in the running
  browser is bound to nothing.

## Prove the session from the profile's own data dir, not from the cabinet

The cabinet's cloud endpoints are the wrong place to look for proof of a session:

- `POST /export-cookies` can answer `200` with **zero domains** for a profile that is demonstrably logged in.
- The profile list's `lastRunAt` can read "never run" for a profile that has a full data dir with the platform's cookies.

Ground truth is the profile's own state on disk. The antidetect client keeps it at
`%APPDATA%/dolphin_anty/browser_profiles/<profileId>/<profileId>.datadir.zip`
(plus `.../data_dir/` while the profile runs). The archive is a Chromium profile;
`Default/Cookies` is a SQLite DB whose `host_key` column lists the domains the profile holds cookies for.

```python
import zipfile, sqlite3, tempfile, os
z = zipfile.ZipFile(path)
tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
tmp.write(z.read('Default/Cookies')); tmp.close()
c = sqlite3.connect(tmp.name)
hosts = [r[0] for r in c.execute('select distinct host_key from cookies')]
c.close(); os.unlink(tmp.name)
```

A profile logged into Yandex shows `*.yandex.ru`, `*.passport.yandex.ru`, `*.ya.ru`.
Print **host names only** — never cookie values, never the rows themselves.

Pitfall: close the sqlite connection before deleting the temp file — Windows refuses the delete while the handle is open.

The archive's mtime is the identity's real "last used" time; prefer it over `lastRunAt`.
Use `scripts/check_profile_session.py <profileId> [...]` to list the domains of one or more profiles.

**Cookie presence is not proof of identity.** The same cookie names exist on a
profile that merely *visited* the login page. The proof is the account's own
name and login rendered on its profile page — a cookie check narrows the
candidates, a page read decides.

## Keep a session backup next to the registry

The cabinet's own cookie export endpoint can answer `{"success":false}`
even for a live profile. Read the cookies over CDP instead and store them
beside the registry, named by account and profile, so a rebuilt profile
can be given the session back instead of logging in again. The file holds
live credentials: it stays out of reports and out of chat.

For Yandex the session markers are `yandexuid`, `Session_id` and `sessar` —
count them by name only. A backup with zero session cookies is not a session:
re-login before trusting the file.

## A failed start is not a failed account

Starting a profile that is already running answers `409` with
`PROFILE_ALREADY_RUNNING`. That is the profile being **up**, not broken —
recover its CDP port from the profile's data dir (`DevToolsActivePort`) and
carry on. Do not re-login the account on the strength of a start error, and do
not delete the profile: the common causes are a duplicate start attempt and a
port still held by the previous instance, and both are answered by reading the
port the profile already has.

Distinguish the layers when a start fails: a `500` from the launch service is
an incomplete profile record (clone a known-good one), a `409` is a duplicate
start, and a transport error on the proxy tunnel is the proxy — rotate it and
start again. Only a platform-level rejection is evidence about the account.

## What the account's own page tells you about its limits

A freshly registered Yandex ID asks for a phone number and offers to merge
accounts. A review platform that ties an action to a verified channel will
refuse a prompt for a review from an account with no phone and no history.
Read the account's state before promising a client a review on it: the
login working is not the account being usable for a published action.
