#!/usr/bin/env python
"""Проверка режима контура: режим ↔ вкладки ↔ процессы.

Диагностика трёх вещей по отдельности (владелец жаловался на «вкладки не
закрываются, статус не переключается»):

  1. что записано в файле режима — он может опережать реальность;
  2. какие вкладки реально открыты в общем браузере;
  3. какие процессы живы — режим без процесса означает, что режим
     объявлен, а работа не идёт.

Печатает вкладки, не принадлежащие текущему режиму.

    python check_mode_tabs.py [путь-к-каталогу-данных]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

CDP = "http://127.0.0.1:9222"
BUN = r"C:\Users\Administrator\.bun\bin\bun.exe"


def _данные(root: Path) -> Path:
    """Каталог с файлами режима и белого списка вкладок."""
    for кандидат in (root / "reviews" / "data", root / "data", root):
        if (кандидат / "mode.json").exists():
            return кандидат
    return root / "reviews" / "data"


def _режим(путь: Path) -> dict:
    try:
        return json.loads((путь / "mode.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _белый_список(путь: Path) -> list[str]:
    try:
        k = json.loads((путь / "keep-tabs.json").read_text(encoding="utf-8"))
        return list(k.get("паттерны") or [])
    except Exception:
        return []


def _вкладки() -> list[dict]:
    try:
        raw = urlopen(f"{CDP}/json", timeout=10).read().decode("utf-8")
    except Exception as e:
        print(f"! общий браузер не отвечает ({CDP}): {e}")
        return []
    out = []
    for t in json.loads(raw):
        if t.get("type") != "page":
            continue
        out.append({"id": t.get("id"), "url": t.get("url", ""), "title": t.get("title") or ""})
    return out


def _процессы() -> list[str]:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'bun.exe' }) | "
             "ForEach-Object { $_.CommandLine }"],
            capture_output=True, text=True, timeout=40).stdout
    except Exception:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(
        r"C:\Users\Administrator\browser-automation")
    путь = _данные(root)

    режим = _режим(путь)
    белый = _белый_список(путь)
    вкладки = _вкладки()
    процессы = _процессы()

    print("РЕЖИМ")
    print(f"  {режим.get('режим', '—')}  фокус={режим.get('фокус') or '—'}  "
          f"с={режим.get('с', '—')}")
    print(f"  белый список: {белый or '— пусто —'}")

    print("\nВКЛАДКИ")
    if not вкладки:
        print("  (нет или браузер не отвечает)")
    for v in вкладки:
        url = v["url"]
        принадлежит = any(p in url for p in белый) if белый else False
        метка = "ok " if принадлежит else "!! "
        print(f"  {метка}{url[:74]}")

    print("\nПРОЦЕССЫ")
    for p in процессы:
        print(f"  {p[:74]}")

    чужие = [v for v in вкладки if белый and not any(p in v["url"] for p in белый)]
    if чужие:
        print(f"\n!! вкладок вне режима: {len(чужие)} — их закроет уборка, "
              f"либо режим не применён")
    if режим.get("режим") == "search":
        ленты = [p for p in процессы if "parser.ts" in p]
        if not ленты:
            print("\n!! режим «Поиск», но ленты не запущены — режим объявлен, "
                  f"работа не идёт")
    if режим.get("режим") in ("chat", "execute", "submit"):
        ленты = [p for p in процессы if "parser.ts" in p]
        if ленты:
            print(f"\n!! режим «{режим['режим']}», но ленты живы "
                  f"({len(ленты)}) — сторож должен их остановить")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
