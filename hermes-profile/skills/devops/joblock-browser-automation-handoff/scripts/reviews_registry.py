"""Реестр аккаунтов, Dolphin-профилей и отзывов.

Зачем. Отзыв — это не «кнопка», а связка из трёх сущностей:
  аккаунт (кто пишет) → Dolphin-профиль (изоляция) → прокси (гео и репутация IP).
Пока эти три не хранятся в одном реестре, масштабировать нельзя: аккаунт
теряется между «купили» и «опубликовали», а повторная публикация с того же
аккаунта — это бан.

Что здесь:
  * SQLite-реестр без секретов в открытом виде: пароли шифруются DPAPI
    (Windows), читает их только тот же пользователь на этой же машине.
  * Привязка аккаунта к Dolphin-профилю и прокси, с выбором прокси по стране.
  * Идемпотентность отзыва: одна платформа + одна компания + один аккаунт
    = максимум одна запись.

Команды:
  python registry.py add-account --platform avito --login user --password ... --country RU
  python registry.py list-accounts
  python registry.py bind --account 1 --country RU      # создать профиль + привязать
  python registry.py profiles
  python registry.py start --account 1                  # поднять, вернуть CDP-порт
  python registry.py record --account 1 --platform yandex --target <url> --text "..."
  python registry.py verify --review 3                  # подтвердить публикацию
  python registry.py stats
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
DB_PATH = DATA / "registry.db"
DOLPHIN_ENV = HERE.parent / "dolphin.env"
ОБЛАКО = "https://dolphin-anty-api.com"
ЛОКАЛЬНЫЙ = "http://localhost:3001"

# ─────────────────────────── DPAPI: секреты ───────────────────────────

class _CRYPTPROTECT_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    """Шифрует/расшифровывает блоб средствами Windows (DPAPI, текущий юзер).

    CryptProtectData/CryptUnprotectData живут в crypt32.dll, а не в advapi32 —
    от advapi там только CryptGenRandom и подобное.
    """
    if os.name != "nt":
        raise RuntimeError("DPAPI доступен только на Windows")
    crypt32 = ctypes.WinDLL("Crypt32")
    kernel = ctypes.WinDLL("Kernel32")

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_byte))]

    def блоб(raw: bytes) -> tuple[DATA_BLOB, ctypes.Array]:
        buf = (ctypes.c_byte * len(raw)).from_buffer_copy(raw)
        return DATA_BLOB(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte))), buf

    src, src_buf = блоб(data)
    out = DATA_BLOB()
    # ppszDataDescr для расшифровки — отдельная переменная, её нельзя
    # совмещать с выходным буфером.
    desc = ctypes.c_wchar_p()

    crypt32.CryptProtectData.argtypes = [ctypes.POINTER(DATA_BLOB), wintypes.LPCWSTR,
                                         ctypes.POINTER(DATA_BLOB), ctypes.c_void_p,
                                         ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB)]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(DATA_BLOB), ctypes.POINTER(ctypes.c_wchar_p),
                                           ctypes.POINTER(DATA_BLOB), ctypes.c_void_p,
                                           ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB)]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p

    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(src), "joblock", None, None, None, 0x01, ctypes.byref(out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(src), ctypes.byref(desc), None, None, None, 0x01, ctypes.byref(out))
    if not ok:
        raise ctypes.WinError()
    try:
        # pbData — указатель, а не массив: срез указателя даёт не байты.
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel.LocalFree(out.pbData)


def секрет_зашифровать(текст: str) -> str:
    return base64.b64encode(_dpapi(текст.encode("utf-8"), True)).decode("ascii")


def секрет_расшифровать(blob: str) -> str:
    return _dpapi(base64.b64decode(blob), False).decode("utf-8")


# ─────────────────────────── Dolphin API ───────────────────────────

def токен() -> str:
    if os.environ.get("DOLPHIN_API_KEY"):
        return os.environ["DOLPHIN_API_KEY"].strip()
    for line in DOLPHIN_ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.strip().startswith("DOLPHIN_API_KEY"):
            return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def api(путь: str, метод: str = "GET", тело: dict | None = None, локальный: bool = False) -> dict:
    t = токен()
    if not t:
        raise RuntimeError("DOLPHIN_API_KEY не найден")
    url = (ЛОКАЛЬНЫЙ if локальный else ОБЛАКО) + путь
    data = json.dumps(тело).encode() if тело is not None else None
    req = urllib.request.Request(url, data=data, method=метод, headers={
        "Authorization": f"Bearer {t}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    return json.loads(raw) if raw else {}


def прокси_кабинета() -> list[dict]:
    t = api("/proxy")
    return t if isinstance(t, list) else (t.get("data") or [])


def профили_кабинета() -> list[dict]:
    t = api("/browser_profiles")
    return t.get("data") or []


СТРАНЫ = {
    "russia": "RU", "russian": "RU", "россия": "RU",
    "kazakhstan": "KZ", "казахстан": "KZ",
    "belarus": "BY", "беларусь": "BY",
    "ukraine": "UA", "украина": "UA",
    "georgia": "GE", "грузия": "GE",
    "armenia": "AM", "армения": "AM",
    "turkey": "TR", "турция": "TR",
    "kyrgyzstan": "KG", "киргизия": "KG",
    "uzbekistan": "UZ", "узбекистан": "UZ",
}


def страна_прокси(p: dict) -> str:
    m = None
    import re
    m = re.search(r"country-([A-Z]{2})", str(p.get("login") or ""))
    if m:
        return m.group(1)
    # Порты ASOCKS, залитые нами: имя вида "asocks_RU_239895815".
    m = re.search(r"asocks_([A-Z]{2})_", str(p.get("name") or ""))
    if m:
        return m.group(1)
    имя = str(p.get("name") or "").split(" - ")[0].strip().lower()
    return СТРАНЫ.get(имя, "")


def выбрать_прокси(страна: str, без_профиля: bool = True,
                   кроме: set[int] | None = None) -> dict | None:
    """Берёт прокси нужной страны, желательно ещё не занятый профилем.

    Занятость смотрим и в кабинете Dolphin (proxyId у профилей), и в
    нашем реестре (proxy_id у аккаунтов). Только по кабинету не хватает:
    привязка прокси к профилю может не сохраниться, и тогда один и тот же
    прокси выдаётся всем аккаунтам подряд.
    """
    занятые = {p.get("proxyId") for p in профили_кабинета()}
    занятые |= {r["proxy_id"] for r in db().execute(
        "SELECT proxy_id FROM accounts WHERE proxy_id>0")}
    занятые |= (кроме or set())
    пул = [p for p in прокси_кабинета() if страна_прокси(p) == страна.upper()]
    if not пул:
        return None
    свободные = [p for p in пул if p.get("id") not in занятые]
    return (свободные or пул)[0]


# ─────────────────────────── реестр ───────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  login TEXT NOT NULL,
  secret BLOB DEFAULT '',
  totp BLOB DEFAULT '',
  answer BLOB DEFAULT '',       -- ответ на контрольный вопрос площадки
  country TEXT DEFAULT '',
  status TEXT DEFAULT 'new',        -- new | warming | active | banned | dead
  daily_limit INTEGER DEFAULT 3,
  used_today INTEGER DEFAULT 0,
  day TEXT DEFAULT '',
  profile_id INTEGER DEFAULT 0,
  proxy_id INTEGER DEFAULT 0,
  cost_rub REAL DEFAULT 0,
  bought_at TEXT DEFAULT '',
  note TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  target TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  text TEXT DEFAULT '',
  state TEXT DEFAULT 'draft',       -- draft | submitted | approved | rejected
  url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  verified_at TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_once
  ON reviews(platform, target, account_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ua TEXT NOT NULL UNIQUE,
  os TEXT DEFAULT '',
  locale TEXT DEFAULT '',
  used_by INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
"""


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    # Миграция: база могла быть создана до появления колонок totp/answer.
    # ALTER TABLE ADD COLUMN не падает, если колонка уже есть.
    колонки = {r["name"] for r in con.execute("PRAGMA table_info(accounts)")}
    for имя, тип in (("totp", "BLOB DEFAULT ''"), ("answer", "BLOB DEFAULT ''")):
        if имя not in колонки:
            con.execute(f"ALTER TABLE accounts ADD COLUMN {имя} {тип}")
            con.commit()
    # Значения, ранее записанные в totp, — это ответы на контрольные
    # вопросы (Яндекс спрашивает «дата рождения бабушки», а не код 2FA).
    перенесено = con.execute("SELECT id, totp FROM accounts WHERE totp IS NOT NULL "
                              "AND totp != '' AND (answer IS NULL OR answer = '')").fetchall()
    for r in перенесено:
        con.execute("UPDATE accounts SET answer=? WHERE id=?", (r["totp"], r["id"]))
    if перенесено:
        con.commit()
    return con


def событие(con, kind: str, payload: dict) -> None:
    con.execute("INSERT INTO events(kind,payload) VALUES(?,?)",
                (kind, json.dumps(payload, ensure_ascii=False)))
    con.commit()


# ─────────────────────────── команды ───────────────────────────

def cmd_add_account(a) -> int:
    con = db()
    cur = con.execute(
        "INSERT INTO accounts(platform,login,secret,totp,country,cost_rub,bought_at,note) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (a.platform, a.login, секрет_зашифровать(a.password or ""),
         секрет_зашифровать(a.totp or ""), (a.country or "").upper(),
         a.cost or 0, a.bought_at or time.strftime("%Y-%m-%d"), a.note or ""))
    con.commit()
    событие(con, "account_added", {"id": cur.lastrowid, "platform": a.platform, "login": a.login})
    print(f"аккаунт #{cur.lastrowid}: {a.platform}/{a.login} (страна {a.country or '—'})")
    con.close()
    return 0


def cmd_import(a) -> int:
    """Импорт аккаунтов из файла поставки.

    Формат строки: `логин:пароль` или `логин:пароль:2FA-секрет` (как у
    продавцов аккаунтов). Строки-разделители вроде `====` и пустые
    пропускаем. 2FA-секрет хранится в том же DPAPI-шифровании, что пароль.
    """
    текст = Path(a.file).read_text(encoding="utf-8-sig", errors="replace")
    добавлено = 0
    for номер, строка in enumerate(текст.splitlines(), 1):
        с = строка.strip()
        if not с or с.startswith("=") or с.startswith("***") or " " in с:
            continue
        части = с.split(":")
        if len(части) < 2 or not части[0] or not части[1]:
            continue
        логин, пароль = части[0], части[1]
        # Третье поле поставки — ответ на контрольный вопрос площадки
        # («дата рождения бабушки» у Яндекса), а не TOTP-секрет.
        ответ = части[2] if len(части) > 2 else ""
        con = db()
        уже = con.execute("SELECT id FROM accounts WHERE login=?", (логин,)).fetchone()
        if уже:
            print(f"  строка {номер}: {логин} — уже есть (#{уже['id']}), пропускаю")
            con.close()
            continue
        cur = con.execute(
            "INSERT INTO accounts(platform,login,secret,answer,country,cost_rub,bought_at,note) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (a.platform, логин, секрет_зашифровать(пароль), секрет_зашифровать(ответ),
             (a.country or "").upper(), a.cost or 0, time.strftime("%Y-%m-%d"), a.note or ""))
        con.commit()
        событие(con, "account_added", {"id": cur.lastrowid, "platform": a.platform, "login": логин})
        print(f"  строка {номер}: добавлен #{cur.lastrowid} {логин}"
              f"{' (+ответ)' if ответ else ''}")
        добавлено += 1
        con.close()
    print(f"импортировано: {добавлено}")
    return 0 if добавлено else 1


АЛФАВИТ_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def base32_ключ(секрет: str) -> bytes:
    """Декодирует base32-секрет 2FA без жёсткого требования к длине.

    Продавцы отдают секрет словами вроде 'Drewes' — 6 символов, то есть
    30 бит, а не кратно 8. Стандартный b32decode требует длину, кратную 8,
    и падает с 'Incorrect padding'. Поэтому разбираем биты вручную и
    отбрасываем неполный байт в конце.
    """
    символы = "".join(ch for ch in секрет.upper() if ch in АЛФАВИТ_BASE32)
    if not символы:
        raise ValueError("в секрете нет символов base32")
    биты = 0
    for ch in символы:
        биты = (биты << 5) | АЛФАВИТ_BASE32.index(ch)
    всего = len(символы) * 5
    целых = всего // 8
    if целых == 0:
        raise ValueError("секрет короче одного байта")
    return (биты >> (всего % 8)).to_bytes(целых, "big")


def cmd_totp(a) -> int:
    """Показывает актуальный код 2FA для аккаунта (секрет из DPAPI)."""
    import hashlib
    import hmac
    import struct

    con = db()
    r = con.execute("SELECT login, totp FROM accounts WHERE id=?", (a.account,)).fetchone()
    con.close()
    if not r or not r["totp"]:
        print("у аккаунта нет секрета 2FA")
        return 1
    секрет = секрет_расшифровать(r["totp"]).replace(" ", "").upper()
    try:
        ключ = base32_ключ(секрет)
    except Exception as e:
        print(f"секрет не читается как base32: {e}")
        return 2
    счётчик = int(time.time()) // 30
    digest = hmac.new(ключ, struct.pack(">Q", счётчик), hashlib.sha1).digest()
    смещение = digest[-1] & 0x0F
    число = struct.unpack(">I", digest[смещение:смещение + 4])[0] & 0x7FFFFFFF
    код = str(число % 10 ** 6).zfill(6)
    осталось = 30 - int(time.time()) % 30
    print(f"{r['login']}: {код}  (обновится через {осталось} с)")
    return 0


def cmd_export_creds(a) -> int:
    """Отдаёт учётные данные аккаунта в stdout — для авторизации в браузере.

    Печатает пароль в открытом виде, поэтому вызывается только из
    локального процесса, который сам вводит их в форму. В отчёты и в
    чат эти значения не попадают.
    """
    con = db()
    r = con.execute("SELECT id,platform,login,secret,answer,country FROM accounts WHERE id=?",
                    (a.account,)).fetchone()
    con.close()
    if not r:
        print(json.dumps({"error": "аккаунт не найден"}, ensure_ascii=False))
        return 1
    данные = {
        "id": r["id"],
        "platform": r["platform"],
        "login": r["login"],
        "password": секрет_расшифровать(r["secret"]) if r["secret"] else "",
        "country": r["country"],
    }
    if r["answer"]:
        данные["answer"] = секрет_расшифровать(r["answer"])
    print(json.dumps(данные, ensure_ascii=False))
    return 0


def cmd_list_accounts(a) -> int:
    con = db()
    for r in con.execute("SELECT id,platform,login,country,status,profile_id,proxy_id,used_today,last_error "
                         "FROM accounts ORDER BY id"):
        print(f"  #{r['id']:<3} {r['platform']:<8} {r['login']:<22} {r['country'] or '—':<3} "
              f"{r['status']:<8} профиль={r['profile_id'] or '—'} прокси={r['proxy_id'] or '—'} "
              f"сегодня={r['used_today']} {r['last_error'][:60]}")
    con.close()
    return 0


def cmd_import_ua(a) -> int:
    """Импорт пула User-Agent строк (файл поставки, одна строка — один UA).

    Разбираем ОС и локаль из самой строки: Dolphin просит platformVersion
    и locale отдельно, а в UA они зашиты («Windows NT 11.0; … ru-RU»).
    Каждому аккаунту достаётся свой UA: одинаковый UA у нескольких
    профилей — самый заметный признак накрутки.
    """
    текст = Path(a.file).read_text(encoding="utf-8-sig", errors="replace")
    добавлено = 0
    for номер, строка in enumerate(текст.splitlines(), 1):
        с = строка.strip()
        if not с or с.startswith("=") or с.startswith("*") or с.startswith("http"):
            continue
        if "Mozilla/" not in с:
            continue
        ос, локаль = разобрать_ua(с)
        con = db()
        try:
            con.execute("INSERT INTO user_agents(ua,os,locale) VALUES(?,?,?)", (с, ос, локаль))
            добавлено += 1
        except sqlite3.IntegrityError:
            pass
        con.commit()
        con.close()
    con = db()
    всего = con.execute("SELECT COUNT(*) n FROM user_agents").fetchone()["n"]
    con.close()
    print(f"новых UA: {добавлено}, всего в пуле: {всего}")
    return 0


def разобрать_ua(ua: str) -> tuple[str, str]:
    """Достаёт ОС и локаль из строки User-Agent."""
    ос = ""
    локаль = ""
    m = re.search(r"Windows NT ([\d.]+)", ua)
    if m:
        ос = f"Windows {m.group(1)}"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        m = re.search(r"Mac OS X ([0-9_]+)", ua)
        ос = f"macOS {m.group(1).replace('_', '.')}" if m else "macOS"
    elif "Linux" in ua:
        ос = "Linux"
    elif "Android" in ua:
        ос = "Android"
    m = re.search(r"\b([a-z]{2}-[A-Z]{2})\b", ua)
    if m:
        локаль = m.group(1)
    return ос, локаль


def cmd_ua(a) -> int:
    con = db()
    if a.take:
        r = con.execute("SELECT * FROM user_agents WHERE used_by=0 ORDER BY RANDOM() LIMIT 1").fetchone()
    else:
        r = con.execute("SELECT * FROM user_agents ORDER BY id LIMIT 1").fetchone()
    if not r:
        print("пул пуст — сначала import-ua"); con.close(); return 1
    print(f"UA #{r['id']}  {r['os']}  {r['locale']}\n{r['ua']}")
    con.close()
    return 0


def cmd_ua_stats(a) -> int:
    con = db()
    всего = con.execute("SELECT COUNT(*) n FROM user_agents").fetchone()["n"]
    занято = con.execute("SELECT COUNT(*) n FROM user_agents WHERE used_by>0").fetchone()["n"]
    print(f"UA всего: {всего}, занято: {занято}, свободно: {всего - занято}")
    for r in con.execute("SELECT os, locale, COUNT(*) n FROM user_agents "
                         "GROUP BY os, locale ORDER BY n DESC LIMIT 12"):
        print(f"  {r['os'] or '—':<16} {r['locale'] or '—':<6} {r['n']}")
    con.close()
    return 0


def cmd_bind(a) -> int:
    con = db()
    acc = con.execute("SELECT * FROM accounts WHERE id=?", (a.account,)).fetchone()
    if not acc:
        print("аккаунт не найден"); return 1
    страна = (a.country or acc["country"] or "").upper()
    прокси = выбрать_прокси(страна) if страна else None
    if страна and not прокси:
        print(f"нет прокси в стране {страна}"); return 2
    имя = f"rev_{acc['platform']}_{acc['id']}"
    тело: dict = {"name": имя, "platform": "windows", "browserType": "anty"}
    # Свой User-Agent на профиль: одинаковый UA у всех профилей — самый
    # заметный признак накрутки. Берём незанятый UA из пула.
    ua_row = con.execute("SELECT * FROM user_agents WHERE used_by=0 ORDER BY RANDOM() LIMIT 1").fetchone()
    if ua_row:
        тело["useragent"] = {"mode": "manual", "value": ua_row["ua"]}
        тело["uaFullVersion"] = версия_из_ua(ua_row["ua"])
        if ua_row["os"]:
            тело["platformVersion"] = версия_из_ua(ua_row["os"]) or None
        if ua_row["locale"]:
            тело["locale"] = {"mode": "manual", "value": ua_row["locale"]}
    создан = api("/browser_profiles", "POST", тело)
    pid = создан.get("id") or (создан.get("data") or {}).get("id")
    # Прокси цепляется отдельным PATCH, и поле называется `proxy` — объект
    # с `id`, а не `proxyId`. С `proxyId` PATCH проходит без ошибки, но
    # значение не сохраняется: профиль выходит в интернет с IP машины.
    # Поле `statusId` в PATCH тоже трогать нельзя — доступ к статусам
    # ограничен, ответ 403.
    if pid and прокси:
        api(f"/browser_profiles/{pid}", "PATCH", {"proxy": {"id": прокси["id"]}})
    con.execute("UPDATE accounts SET profile_id=?, proxy_id=?, status=? WHERE id=?",
                (pid or 0, прокси["id"] if прокси else 0, "warming", acc["id"]))
    con.commit()
    событие(con, "profile_bound", {"account": acc["id"], "profile": pid,
                                   "proxy": прокси["id"] if прокси else 0,
                                   "ua": ua_row["id"] if ua_row else 0})
    if ua_row:
        con.execute("UPDATE user_agents SET used_by=? WHERE id=?", (acc["id"], ua_row["id"]))
        con.commit()
    проверка = next((p for p in профили_кабинета() if p.get("id") == pid), {})
    привязан = проверка.get("proxyId")
    if прокси and not привязан:
        print(f"ВНИМАНИЕ: прокси {прокси['id']} не привязался (в профиле {привязан})")
        return 4
    print(f"профиль Dolphin #{pid} создан для аккаунта #{acc['id']} "
          f"(прокси {привязан or '—'}, страна {страна or '—'}, "
          f"UA {ua_row['id'] if ua_row else '—'})")
    con.close()
    return 0


def версия_из_ua(строка: str) -> str:
    """Достаёт числовую версию: 'Windows NT 11.0' → '11.0', UA → '146.0.6736.185'."""
    if not строка:
        return ""
    m = re.search(r"Windows NT ([\d.]+)", строка)
    if m:
        return m.group(1)
    m = re.search(r"Chrome/([\d.]+)", строка)
    if m:
        return m.group(1)
    m = re.search(r"Mac OS X ([0-9_]+)", строка)
    if m:
        return m.group(1).replace("_", ".")
    return ""


def cmd_fix_proxy(a) -> int:
    """Доводит привязку прокси у уже созданных профилей.

    Нужна, когда профили созданы, а прокси не привязались: bind не смог
    записать proxyId, либо в кабинете появились новые порты. Каждому
    аккаунту — свой прокси из его страны, по одному на профиль.
    """
    con = db()
    строки = con.execute("SELECT id,platform,login,country,profile_id,proxy_id FROM accounts "
                          "WHERE profile_id>0 ORDER BY id").fetchall()
    занятые: set[int] = set()
    # Фактическое состояние профилей читаем списком: одиночный GET
    # /browser_profiles/{id} у части профилей отдаёт 500.
    по_профилю = {p.get("id"): p for p in профили_кабинета()}
    for s in строки:
        if a.only and s["id"] not in a.only:
            continue
        страна = (s["country"] or "").upper()
        if not страна:
            print(f"  акк #{s['id']}: страна не задана — пропускаю"); continue
        факт_сейчас = (по_профилю.get(s["profile_id"]) or {}).get("proxyId") or 0
        if факт_сейчас and s["id"] != a.исключить_из_занятых:
            занятые.add(факт_сейчас)
        прокси = выбрать_прокси(страна, кроме=занятые)
        if not прокси:
            print(f"  акк #{s['id']}: нет свободного прокси в {страна}"); continue
        занятые.add(прокси["id"])
        api(f"/browser_profiles/{s['profile_id']}", "PATCH", {"proxy": {"id": прокси["id"]}})
        con.execute("UPDATE accounts SET proxy_id=? WHERE id=?", (прокси["id"], s["id"]))
        con.commit()
        событие(con, "proxy_fixed", {"account": s["id"], "proxy": прокси["id"]})
        # Проверяем фактом: перечитываем список профилей.
        по_профилю = {p.get("id"): p for p in профили_кабинета()}
        факт = (по_профилю.get(s["profile_id"]) or {}).get("proxyId")
        знак = "OK" if факт == прокси["id"] else f"НЕ ПРИМЕНИЛОСЬ (в профиле {факт})"
        print(f"  акк #{s['id']} профиль {s['profile_id']}: прокси {прокси['id']} "
              f"({прокси.get('name')}) — {знак}")
    con.close()
    return 0


def cmd_stop(a) -> int:
    """Останавливает профиль Dolphin. После остановки клиент архивирует
    data_dir и заливает его в облако — сессия переживает перезапуск."""
    con = db()
    acc = con.execute("SELECT id,profile_id,status FROM accounts WHERE id=?", (a.account,)).fetchone()
    con.close()
    if not acc or not acc["profile_id"]:
        print("у аккаунта нет профиля"); return 1
    api("/v1.0/auth/login-with-token", "POST", {"token": токен()}, локальный=True)
    t = api(f"/v1.0/browser_profiles/{acc['profile_id']}/stop", "GET", локальный=True)
    print(f"профиль {acc['profile_id']} остановлен: {json.dumps(t, ensure_ascii=False)[:120]}")
    return 0


def cmd_mark_session(a) -> int:
    """Отмечает аккаунту состояние «вошёл» и сохраняет резервную копию сессии.

    Резервная копия cookie'ов выгружается из локального API Dolphin в
    data_dir профиля: если профиль пересоздадут, сессию можно вернуть
    импортом, а не входом заново.
    """
    con = db()
    acc = con.execute("SELECT id,profile_id,status,note FROM accounts WHERE id=?", (a.account,)).fetchone()
    if not acc:
        print("аккаунт не найден"); con.close(); return 1
    pid = acc["profile_id"]
    api("/v1.0/auth/login-with-token", "POST", {"token": токен()}, локальный=True)
    # Резерв сессии: локальный API Dolphin (/v1.0/export-cookies) отвечает
    # {"success":false}, поэтому cookie'и забирает отдельный скрипт через CDP
    # (yandex-export-session.ts) и кладёт их рядом с реестром.
    файл = DATA / f"session_{acc['id']}_{pid}.json"
    if файл.exists():
        сведения = f"резерв сессии: {файл.name}"
    else:
        сведения = "резерв сессии: только в профиле"
    con.execute("UPDATE accounts SET status='active', note=? WHERE id=?",
                ((acc["note"] or "") + " | " + сведения, acc["id"]))
    con.commit()
    событие(con, "session_marked", {"account": acc["id"], "profile": pid, "backup": str(файл)})
    print(f"аккаунт #{acc['id']} помечен active; {сведения}")
    con.close()
    return 0


def cmd_profiles(a) -> int:
    con = db()
    for r in con.execute("SELECT id,platform,login,profile_id,proxy_id,status FROM accounts WHERE profile_id>0"):
        print(f"  акк #{r['id']} {r['login']} → профиль {r['profile_id']} прокси {r['proxy_id']}")
    con.close()
    print("\nв кабинете Dolphin:")
    for p in профили_кабинета():
        print(f"  id={p.get('id')} имя={p.get('name')} прокси={p.get('proxyId')} "
              f"запусков={p.get('lastRunAt')}")
    return 0


def cmd_start(a) -> int:
    con = db()
    acc = con.execute("SELECT * FROM accounts WHERE id=?", (a.account,)).fetchone()
    if not acc or not acc["profile_id"]:
        print("у аккаунта нет профиля: сначала bind"); con.close(); return 1
    try:
        import progress as PG
        PG.лог(f"Dolphin: авторизация локального API", "dolphin", заказ=str(getattr(a, "target", "") or ""))
    except Exception:
        PG = None
    api("/v1.0/auth/login-with-token", "POST", {"token": токен()}, локальный=True)
    if PG: PG.лог(f"Dolphin: поднимаю профиль {acc['profile_id']}", "dolphin")
    t = api(f"/v1.0/browser_profiles/{acc['profile_id']}/start?automation=1", "GET", локальный=True)
    порт = (t.get("automation") or {}).get("port")
    if PG: PG.лог(f"Dolphin: CDP-порт {'получен: ' + str(порт) if порт else 'НЕ получен'}", "dolphin")
    con.execute("UPDATE accounts SET status=? WHERE id=?", ("active" if порт else acc["status"], acc["id"]))
    con.commit()
    событие(con, "profile_started", {"account": acc["id"], "port": порт})
    con.close()
    if not порт:
        print("порт не пришёл: профиль поднялся без DevTools")
        return 2
    print(f"CDP: http://127.0.0.1:{порт}")
    return 0


def cmd_record(a) -> int:
    con = db()
    try:
        con.execute("INSERT INTO reviews(platform,target,account_id,text,state) VALUES(?,?,?,?,'draft')",
                    (a.platform, a.target, a.account, a.text or ""))
    except sqlite3.IntegrityError:
        print("такой отзыв уже зарегистрирован для этого аккаунта — повтор не создаём")
        con.close(); return 3
    con.commit()
    rid = con.execute("SELECT last_insert_rowid() id").fetchone()["id"]
    con.execute("UPDATE accounts SET used_today=used_today+1, day=? WHERE id=?",
                (time.strftime("%Y-%m-%d"), a.account))
    con.commit()
    событие(con, "review_recorded", {"review": rid, "account": a.account, "target": a.target})
    print(f"отзыв #{rid} зарегистрирован (platform={a.platform}, target={a.target})")
    con.close()
    return 0


def cmd_verify(a) -> int:
    con = db()
    r = con.execute("SELECT * FROM reviews WHERE id=?", (a.review,)).fetchone()
    if not r:
        print("нет такого отзыва"); con.close(); return 1
    con.execute("UPDATE reviews SET state=?, url=?, verified_at=? WHERE id=?",
                ("approved", a.url or r["url"], time.strftime("%Y-%m-%d %H:%M:%S"), a.review))
    con.commit()
    событие(con, "review_verified", {"review": a.review, "url": a.url})
    print(f"отзыв #{a.review} подтверждён")
    con.close()
    return 0


def cmd_stats(a) -> int:
    con = db()
    print("аккаунты по статусу:", {r["status"]: r["n"] for r in con.execute(
        "SELECT status, COUNT(*) n FROM accounts GROUP BY status")})
    print("отзывы по состоянию:", {r["state"]: r["n"] for r in con.execute(
        "SELECT state, COUNT(*) n FROM reviews GROUP BY state")})
    print("прокси в кабинете:", len(прокси_кабинета()),
          "| профилей:", len(профили_кабинета()))
    con.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Реестр аккаунтов и отзывов")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-account"); p.set_defaults(fn=cmd_add_account)
    p.add_argument("--platform", required=True); p.add_argument("--login", required=True)
    p.add_argument("--password", default=""); p.add_argument("--totp", default="")
    p.add_argument("--country", default="")
    p.add_argument("--cost", type=float, default=0); p.add_argument("--bought-at", default="")
    p.add_argument("--note", default="")

    p = sub.add_parser("import"); p.set_defaults(fn=cmd_import)
    p.add_argument("--file", required=True); p.add_argument("--platform", required=True)
    p.add_argument("--country", default=""); p.add_argument("--cost", type=float, default=0)
    p.add_argument("--note", default="")

    p = sub.add_parser("totp"); p.set_defaults(fn=cmd_totp)
    p.add_argument("--account", type=int, required=True)

    p = sub.add_parser("export-creds"); p.set_defaults(fn=cmd_export_creds)
    p.add_argument("--account", type=int, required=True)

    p = sub.add_parser("stop"); p.set_defaults(fn=cmd_stop)
    p.add_argument("--account", type=int, required=True)

    p = sub.add_parser("mark-session"); p.set_defaults(fn=cmd_mark_session)
    p.add_argument("--account", type=int, required=True)

    p = sub.add_parser("import-ua"); p.set_defaults(fn=cmd_import_ua)
    p.add_argument("--file", required=True)

    p = sub.add_parser("ua"); p.set_defaults(fn=cmd_ua)
    p.add_argument("--take", action="store_true")

    p = sub.add_parser("ua-stats"); p.set_defaults(fn=cmd_ua_stats)

    p = sub.add_parser("fix-proxy"); p.set_defaults(fn=cmd_fix_proxy)
    p.add_argument("--only", type=int, nargs="*")
    p.add_argument("--исключить-из-занятых", type=int, default=0,
                   help="id аккаунта, чей текущий прокси можно переиспользовать")

    p = sub.add_parser("list-accounts"); p.set_defaults(fn=cmd_list_accounts)

    p = sub.add_parser("bind"); p.set_defaults(fn=cmd_bind)
    p.add_argument("--account", type=int, required=True); p.add_argument("--country", default="")

    p = sub.add_parser("profiles"); p.set_defaults(fn=cmd_profiles)

    p = sub.add_parser("start"); p.set_defaults(fn=cmd_start)
    p.add_argument("--account", type=int, required=True)

    p = sub.add_parser("record"); p.set_defaults(fn=cmd_record)
    p.add_argument("--account", type=int, required=True); p.add_argument("--platform", required=True)
    p.add_argument("--target", required=True); p.add_argument("--text", default="")

    p = sub.add_parser("verify"); p.set_defaults(fn=cmd_verify)
    p.add_argument("--review", type=int, required=True); p.add_argument("--url", default="")

    p = sub.add_parser("stats"); p.set_defaults(fn=cmd_stats)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
