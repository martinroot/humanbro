# Account registry recipe — encrypted secrets, one-shot actions

A working shape for a small registry that holds platform accounts, their anti-detect profile bindings, and the actions taken through them. SQLite, no server, one file.

## Schema

```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  login TEXT NOT NULL,
  secret BLOB DEFAULT '',        -- DPAPI ciphertext, base64
  country TEXT DEFAULT '',
  status TEXT DEFAULT 'new',     -- new | warming | active | banned | dead
  daily_limit INTEGER DEFAULT 3,
  used_today INTEGER DEFAULT 0,
  day TEXT DEFAULT '',           -- the date used_today refers to
  profile_id INTEGER DEFAULT 0,
  proxy_id INTEGER DEFAULT 0,
  cost_rub REAL DEFAULT 0,
  bought_at TEXT DEFAULT '',
  last_error TEXT DEFAULT ''
);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  target TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  text TEXT DEFAULT '',
  state TEXT DEFAULT 'draft',    -- draft | submitted | approved | rejected
  url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  verified_at TEXT DEFAULT ''
);
CREATE UNIQUE INDEX ux_action_once ON actions(platform, target, account_id);
```

The unique index is the idempotency mechanism. A repeat insert raises `IntegrityError`; the caller reads that as "already done" and does **not** retry. Enforcing this in the database rather than in the caller's memory is what stops a re-run from publishing twice.

`used_today` + `day` implement the daily cap without a scheduler: on each use, if `day != today`, reset the counter and the day.

## DPAPI: encrypting the secret

Windows DPAPI binds the ciphertext to the user and the machine — a stolen DB file is useless elsewhere, and no key file has to be secured separately.

Two traps, both of which fail in ways that look like something else:

1. **`CryptProtectData` lives in `crypt32.dll`, not `advapi32.dll`.** Loading it from advapi raises `AttributeError: function 'CryptProtectData' not found`, which reads like a wrong API name rather than a wrong DLL.
2. **`pbData` is a pointer, not an array.** `bytes(bytearray(out.pbData[:out.cbData]))` raises `ValueError: byte must be in range(0, 256)` — slicing a `POINTER(c_byte)` yields garbage addresses, not bytes. Use `ctypes.string_at(out.pbData, out.cbData)`.

Also: for `CryptUnprotectData` the description pointer must be a **separate** variable, not the same buffer passed as the output — passing one object for both corrupts the result.

```python
import base64, ctypes
from ctypes import wintypes

class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte))]

def dpapi(data: bytes, protect: bool) -> bytes:
    crypt32 = ctypes.WinDLL("Crypt32")
    kernel = ctypes.WinDLL("Kernel32")
    buf = (ctypes.c_byte * len(data)).from_buffer_copy(data)
    src = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    out = DATA_BLOB()
    desc = ctypes.c_wchar_p()
    crypt32.CryptProtectData.argtypes = [ctypes.POINTER(DATA_BLOB), wintypes.LPCWSTR,
        ctypes.POINTER(DATA_BLOB), ctypes.c_void_p, ctypes.c_void_p,
        wintypes.DWORD, ctypes.POINTER(DATA_BLOB)]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(DATA_BLOB),
        ctypes.POINTER(ctypes.c_wchar_p), ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB)]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(src), "pool", None, None, None, 0x01, ctypes.byref(out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(src), ctypes.byref(desc), None, None, None, 0x01, ctypes.byref(out))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel.LocalFree(out.pbData)

encrypt = lambda s: base64.b64encode(dpapi(s.encode("utf-8"), True)).decode("ascii")
decrypt = lambda b: dpapi(base64.b64decode(b), False).decode("utf-8")
```

`CRYPTPROTECT_UI_FORBIDDEN` (`0x01`) keeps the call non-interactive, so it never blocks on a prompt inside a service or a scheduled run.

## Verifying it

Round-trip the secret and assert equality before trusting the scheme: encrypt a known string, read the stored blob back, decrypt, compare. The stored value must look like ciphertext (`AQAAANCMnd8…`) and never like the plaintext.

## Probing the proxy pool for a country

Vendor proxy records carry the country inside the login string rather than in a dedicated field, and the `name` field carries it in prose. Prefer the structured marker, fall back to a name map:

```python
import re
def country_of(proxy: dict) -> str:
    m = re.search(r"country-([A-Z]{2})", str(proxy.get("login") or ""))
    if m:
        return m.group(1)
    return NAME_TO_ISO.get(str(proxy.get("name") or "").split(" - ")[0].strip().lower(), "")
```

Before choosing a proxy, exclude those already bound to a profile — two accounts sharing a proxy defeat the isolation the pool exists for. **Take the busy set from the cabinet's profiles *and* from your own registry's `proxy_id` column.** A binding that silently failed leaves the port looking free to the cabinet, so the cabinet alone hands the same port to the next account in a row.

## Importing a seller's delivery file

Sellers deliver accounts as a text file, one identity per line, in a
`login:password` or `login:password:2FA` shape, wrapped in banner lines and
`====` separators. Import the file rather than re-typing identities:

- Skip lines that do not look like an identity (empty, banner text, `====`
  separators, anything containing spaces) — a delivery file is prose with
  records embedded in it, not a clean list.
- Dedupe on the login: a re-import of the same delivery must not create a
  second row, and the report should say which lines were skipped as already
  present.
- The third field of a `login:password:2FA` line is **not necessarily a TOTP
  secret.** Validate it as base32 before promising automated 2FA: a secret
  that fails padding or decodes to a wrong-length key is a *password hint* or
  a recovery word, and a code generator over it produces a wrong code that
  looks right. Keep the value either way, encrypted, and mark the account as
  needing manual 2FA when it does not decode.
- Store the 2FA secret with the same DPAPI protection as the password, in
  its own column.

## User-Agent as part of the identity

A pool of profiles that share one User-Agent is trivially detectable, and a
UA that disagrees with the profile's own OS version and locale is worse than
no spoofing at all. Keep the UA strings in a table of their own, hand each
profile a **distinct, unused** one, and derive every related field from that
single string — the Chrome build for `uaFullVersion`, the `Windows NT 11.0`
part for `platformVersion`, and the `ru-RU`/`en-US` token for `locale`. One
source string cannot contradict itself, and the "unused" mark is what keeps
two accounts from sharing a fingerprint by accident.

## Command shape

Give the registry a subcommand per operation, each printing ids and counts only:

```
add-account --platform P --login L --password S --country CC --cost N
list-accounts
bind --account N [--country CC]      # create profile, then PATCH the proxy, then read back
profiles                            # local bindings + the vendor's own list
start --account N                   # local API login, then GET start?automation=1 → CDP port
record --account N --platform P --target URL --text T
verify --record N --url URL         # after a read-back confirmed the item is visible
stats
```

Never echo a secret in any of them. `add-account` takes the password as an argument for convenience, but a production version should read it from stdin or a prompt so it does not land in the process list.
