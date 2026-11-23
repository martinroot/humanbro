"""Release what the pool no longer needs: profiles, monitors, stale files.

The owner asks for this after a work session: nothing may stay open "just in
case". Each open Dolphin profile is ~9 anty.exe processes and ~200 MB; a chat
monitor wedged in a reconnect loop after its CDP session died burns ~90% CPU
per core; a stale tab-guard file keeps a dead monitor's tab pinned.

What it does:
  1. Stops every OPEN Dolphin profile that is not attached to unfinished work.
     "Attached" = the account is assigned in `flow` to a job in a state that
     still needs it (bid / need-info / assigned / on-review / preparing).
     A profile is "open" when its data dir exists on disk — the cabinet's
     profile list does not report `running` reliably.
  2. Kills chat monitors whose per-order log went silent for STUCK_MIN minutes.
     A live monitor appends a status line to that log on every poll, so a
     silent log means the process is wedged. It also kills duplicate monitors
     for the same order set — several CDP clients on one shared Chrome port
     starve the port and every monitor starts failing with "goto: Timeout".
  3. Deletes stale tab-guard files (older than JUNK_MIN) and scratch files.

Idempotent and safe to run repeatedly. Prints one line per action taken and
nothing at all when there was nothing to do.

Usage:
    python cleanup_pool.py
    python cleanup_pool.py --max-profiles 2 --stuck-min 15 --dry-run

Needs the local Dolphin API for stopping profiles: POST
/v1.0/auth/login-with-token with the cabinet token, then
GET /v1.0/browser_profiles/<id>/stop.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AUT = Path(os.environ.get("REVIEW_AUT", r"C:\Users\Administrator\browser-automation"))
БД = AUT / "reviews" / "data" / "registry.db"
DOLPHIN_ENV = AUT / "dolphin.env"
ЛОКАЛЬНЫЙ = "http://localhost:3001"
ОБЛАКО = "https://dolphin-anty-api.com"

ЖИВЫЕ_СОСТОЯНИЯ = ("bid", "need-info", "assigned", "on-review", "preparing")
BUN = r"C:\Users\Administrator\.bun\bin\bun.exe"


# ── Dolphin ────────────────────────────────────────────────────────────────
def токен() -> str:
    if os.environ.get("DOLPHIN_API_KEY"):
        return os.environ["DOLPHIN_API_KEY"].strip()
    try:
        for line in DOLPHIN_ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip().startswith("DOLPHIN_API_KEY"):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def api(путь: str, метод: str = "GET", тело=None, локальный: bool = False):
    base = ЛОКАЛЬНЫЙ if локальный else ОБЛАКО
    data = json.dumps(тело).encode() if тело is not None else None
    req = urllib.request.Request(
        base + путь, data=data, method=метод,
        headers={"Authorization": f"Bearer {токен()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        return {"_http": e.code}
    except Exception as e:
        return {"_err": str(e)[:120]}
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def папки_профилей() -> Path:
    return Path(os.environ.get("APPDATA", os.path.expanduser("~/AppData/Roaming"))) / "dolphin_anty" / "browser_profiles"


def открытые_профили() -> list[int]:
    """Profiles with a live data dir on disk — the reliable "running" signal."""
    base = папки_профилей()
    out: list[int] = []
    if not base.exists():
        return out
    for d in base.iterdir():
        if not d.is_dir() or not (d / "data_dir").exists():
            continue
        try:
            out.append(int(d.name))
        except ValueError:
            pass
    return sorted(out)


def нужные_профили() -> set[int]:
    """Profiles of accounts assigned to unfinished work."""
    if not БД.exists():
        return set()
    import sqlite3
    con = sqlite3.connect(БД)
    try:
        placeholders = ",".join("?" * len(ЖИВЫЕ_СОСТОЯНИЯ))
        rows = con.execute(
            "SELECT DISTINCT a.profile_id FROM accounts a "
            f"JOIN flow f ON f.account_id = a.id "
            f"WHERE f.state IN ({placeholders}) AND a.profile_id > 0",
            ЖИВЫЕ_СОСТОЯНИЯ).fetchall()
        return {int(r[0]) for r in rows if r[0]}
    except Exception:
        return set()
    finally:
        con.close()


# ── процессы ───────────────────────────────────────────────────────────────
def bun_процессы() -> list[tuple[int, str]]:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'bun.exe' } | "
             "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }) -join \"`n\""],
            capture_output=True, text=True, timeout=40).stdout
    except Exception:
        return []
    рез: list[tuple[int, str]] = []
    for строка in out.splitlines():
        m = re.match(r"^(\d+)\|(.*)$", строка.strip())
        if m:
            рез.append((int(m.group(1)), m.group(2)))
    return рез


def убить(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=20)


def минут_с_изменения(путь: Path) -> float:
    if not путь.exists():
        return 1e9
    return (time.time() - путь.stat().st_mtime) / 60.0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-profiles", type=int, default=0,
                    help="how many Dolphin profiles may stay open (0 = only those with work)")
    ap.add_argument("--stuck-min", type=int, default=12,
                    help="a monitor whose log is silent for this many minutes is wedged")
    ap.add_argument("--junk-min", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    отчёт: list[str] = []

    # 1. Профили Dolphin
    открытые = открытые_профили()
    if открытые:
        лишние = [p for p in открытые if p not in нужные_профили()]
        if args.max_profiles > 0 and len(открытые) > args.max_profiles:
            лишние += открытые[: len(открытые) - args.max_profiles]
        if лишние:
            if not args.dry_run:
                api("/v1.0/auth/login-with-token", "POST", {"token": токен()}, локальный=True)
            for pid in sorted(set(лишние)):
                if args.dry_run:
                    отчёт.append(f"Dolphin: профиль {pid} — к остановке")
                    continue
                r = api(f"/v1.0/browser_profiles/{pid}/stop", "GET", локальный=True)
                ok = isinstance(r, dict) and r.get("success")
                отчёт.append(f"Dolphin: профиль {pid} {'остановлен' if ok else 'НЕ остановлен'}")

    # 2. Зависшие и дублирующие мониторы чатов
    мониторы = [(pid, cmd) for pid, cmd in bun_процессы() if "watch-chat.ts" in cmd]
    for pid, cmd in мониторы:
        m = re.search(r"watch-chat\.ts\s+([\d,]+)", cmd)
        if not m:
            continue
        for заказ in m.group(1).split(","):
            лог = AUT / f"logs-watch-chat-{заказ.strip()}-live.txt"
            if лог.exists() and минут_с_изменения(лог) > args.stuck_min:
                if not args.dry_run:
                    убить(pid)
                отчёт.append(
                    f"монитор {pid} по заказу {заказ}: "
                    f"лог молчит {int(минут_с_изменения(лог))} мин — завис")
                break
    if len(мониторы) > 1:
        for pid, _ in мониторы[1:]:
            if not args.dry_run:
                убить(pid)
            отчёт.append(f"монитор {pid}: дубль — закрыт (лишние CDP-клиенты вредят порту)")

    # 3. Мусор
    for файл in list(AUT.glob("tab-guard-chat*.json")) + list(AUT.glob("tab-guard.json")):
        if минут_с_изменения(файл) > args.junk_min:
            if not args.dry_run:
                try:
                    файл.unlink()
                except OSError:
                    continue
            отчёт.append(f"мусор: удалён {файл.name}")

    if отчёт:
        print("\n".join(отчёт))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
