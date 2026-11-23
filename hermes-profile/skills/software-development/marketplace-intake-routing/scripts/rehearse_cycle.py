#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Полный прогон цикла на локальной бирже-песочнице.

Проверяет не «процесс жив», а договор цепочки:

  1. Клиент публикует заказ на бирже (POST /api/add песочницы).
  2. Проверка: заказ ВИДЕН В ЛЕНТЕ (GET /board) — иначе парсер его не увидит
     никогда, и ожидание карточки в очереди бессмысленно.
  3. Парсер снимает ленту и кладёт карточку в market_projects.
  4. Очередь /api/win/bids отдаёт карточку.
  5. Отклик (POST /order/<id>/respond).
  6. Работа: PNG 1200x1200 на белом фоне (PIL), сверка на диске.
  7. Сдача файлом (multipart POST /order/<id>/reply).
  8. Проверка ФАКТОМ: перечитывание страницы заказа — файл обязан быть в
     блоке «Сдано исполнителем».
  9. Только после этого доклад POST /api/win/bid-sent.

Всё локальное: адреса 127.0.0.1, режим откликов портала — test.

Запуск:
  python rehearse_cycle.py            # человеческий вывод
  python rehearse_cycle.py --json     # отчёт JSON
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

PORTAL = os.environ.get("JOBLOCK_PORTAL", "http://127.0.0.1:8701")
SANDBOX = os.environ.get("JOBLOCK_SANDBOX", "http://127.0.0.1:8788")
ENV_FILE = Path(os.environ.get("JOBLOCK_PORTAL_ENV", r"C:\sites\joblock\portal\.env"))
WORKDIR = Path(os.environ.get("TEMP", r"C:\Users\Administrator\AppData\Local\Temp")) / "joblock-rehearsal"


def _token() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("FABRA_PARSER_TOKEN"):
            return line.split("=", 1)[1].strip().strip("\"'")
    return ""


TOKEN = _token()


def get(url: str, *, headers: dict | None = None, timeout: int = 20) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def post_form(url: str, fields: dict, *, files: dict | None = None,
              headers: dict | None = None, timeout: int = 30) -> tuple[int, bytes]:
    if not files:
        data = urllib.parse.urlencode(fields).encode()
        head = {"Content-Type": "application/x-www-form-urlencoded"}
    else:
        boundary = "----joblock" + uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in fields.items():
            buf.write(f"--{boundary}\r\n".encode())
            buf.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
            buf.write(f"{v}\r\n".encode())
        for k, (fname, content) in files.items():
            buf.write(f"--{boundary}\r\n".encode())
            buf.write(f'Content-Disposition: form-data; name="{k}"; filename="{fname}"\r\n'.encode())
            buf.write(b"Content-Type: application/octet-stream\r\n\r\n")
            buf.write(content)
            buf.write(b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        head = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    head.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=head, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def api_headers() -> dict:
    return {"x-fabra-parser-token": TOKEN}


def создать_заказ() -> tuple[str, dict]:
    oid = "SBX-REH-" + uuid.uuid4().hex[:6].upper()
    заказ = {
        "id": oid,
        "title": "Карточка товара для маркетплейса: предметная съёмка",
        "description": ("Нужен PNG 1200x1200 на чистом белом фоне, товар по центру, "
                        "мягкая тень. Бюджет 6000 руб."),
        "price": 6000,
        "client": "rehearsal_client",
        "status": "open",
        "script": "normal",
        "created": time.strftime("%H:%M:%S"),
    }
    code, body = post_form(f"{SANDBOX}/api/add", {"order": json.dumps(заказ, ensure_ascii=False)})
    if code != 200:
        raise RuntimeError(f"песочница не приняла заказ: HTTP {code} {body[:200]!r}")
    return oid, заказ


def дождаться_в_ленте(oid: str, timeout_s: int = 60) -> str:
    """Шаг 2: заказ должен появиться в ленте (/board) — иначе парсер его не увидит."""
    дедлайн = time.time() + timeout_s
    while time.time() < дедлайн:
        code, body = get(f"{SANDBOX}/board")
        if code == 200 and oid in body.decode("utf-8", errors="replace"):
            return "заказ виден в ленте"
        time.sleep(3)
    raise TimeoutError(f"заказ {oid} не появился в ленте /board за {timeout_s}с — "
                       "фикстура не опубликована, парсер её не увидит никогда")


def дождаться_проекта(oid: str, timeout_s: int = 120) -> dict:
    дедлайн = time.time() + timeout_s
    while time.time() < дедлайн:
        code, body = get(f"{PORTAL}/api/win/bids?limit=30&min_price=0", headers=api_headers())
        if code == 200:
            try:
                очередь = json.loads(body)
            except ValueError:
                очередь = {}
            for b in очередь.get("bids", []):
                if b.get("source") == "sandbox" and b.get("external_id") == oid:
                    return b
        time.sleep(5)
    raise TimeoutError(f"проект {oid} не появился в очереди за {timeout_s}с")


def откликнуться(oid: str) -> str:
    текст = ("Здравствуйте! Взял задачу: сделаю предметную съёмку 1200x1200 "
             "на чистом белом фоне с мягкой тенью, отдам PNG. Материалы у меня есть.")
    code, _ = post_form(f"{SANDBOX}/order/{oid}/respond", {"text": текст})
    if code not in (200, 303):
        raise RuntimeError(f"отклик не принят: HTTP {code}")
    return текст


def сделать_работу(oid: str) -> tuple[str, bytes, dict]:
    from PIL import Image, ImageDraw

    WORKDIR.mkdir(parents=True, exist_ok=True)
    size = 1200
    img = Image.new("RGB", (size, size), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([360, 420, 840, 780], radius=28, fill=(214, 218, 224),
                           outline=(120, 126, 136), width=4)
    draw.ellipse([430, 500, 560, 630], fill=(240, 242, 246))
    draw.rectangle([360, 700, 840, 780], fill=(196, 201, 210))
    draw.ellipse([330, 760, 870, 830], fill=(232, 234, 238))
    path = WORKDIR / f"{oid}.png"
    img.save(path, "PNG")
    data = path.read_bytes()
    with Image.open(path) as check:
        assert check.size == (size, size), check.size
        assert check.format == "PNG"
    return path.name, data, {"размер": f"{size}x{size}", "формат": "PNG",
                             "байт": len(data), "путь": str(path)}


def сдать(oid: str, имя: str, данные: bytes, текст: str) -> None:
    code, body = post_form(f"{SANDBOX}/order/{oid}/reply",
                            {"price": "6000", "text": текст},
                            files={"file:files": (имя, данные)})
    if code not in (200, 303):
        raise RuntimeError(f"сдача не принята: HTTP {code} {body[:200]!r}")


def проверить_сдачу(oid: str, имя: str) -> str:
    code, body = get(f"{SANDBOX}/order/{oid}")
    if code != 200:
        raise RuntimeError(f"страница заказа не открылась: HTTP {code}")
    html = body.decode("utf-8", errors="replace")
    блок = re.search(r"<h2>Сдано исполнителем</h2>(.*?)</div>", html, re.S)
    сдано = блок.group(1) if блок else ""
    if имя not in сдано:
        raise RuntimeError(f"файл {имя} не виден в блоке «Сдано исполнителем» — сдачи не было")
    return re.sub(r"\s+", " ", сдано).strip()[:200]


def доложить(bid: dict, текст: str) -> dict:
    code, body = post_form(
        f"{PORTAL}/api/win/bid-sent",
        {"project_id": bid["project_id"], "source": bid["source"],
         "external_id": bid["external_id"], "price": bid["price"],
         "title": bid["title"], "reply": текст, "note": "репетиция полного цикла"},
        headers=api_headers())
    if code != 200:
        raise RuntimeError(f"доклад не принят: HTTP {code} {body[:200]!r}")
    return json.loads(body)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    отчёт: dict = {"шаги": []}

    def шаг(имя, детали):
        отчёт["шаги"].append({"шаг": имя, "детали": детали})
        if not args.json:
            print(f"[{len(отчёт['шаги'])}] {имя}: {детали}")

    try:
        oid, заказ = создать_заказ()
        шаг("заказ_на_бирже", f"{oid} — {заказ['title']}")
        шаг("фикстура_в_ленте", дождаться_в_ленте(oid))
        bid = дождаться_проекта(oid)
        шаг("проект_в_базе", f"{bid['source']}/{bid['external_id']} · {bid['price']} ₽")
        текст = откликнуться(oid)
        шаг("отклик_отправлен", текст[:80])
        имя, данные, факт = сделать_работу(oid)
        шаг("результат_готов", json.dumps(факт, ensure_ascii=False))
        сдать(oid, имя, данные, f"Готово: {факт['размер']} PNG, белый фон, мягкая тень.")
        шаг("сдача_отправлена", имя)
        шаг("сдача_подтверждена_фактом", проверить_сдачу(oid, имя))
        доложить(bid, текст)
        шаг("доклад_на_биржу", f"{bid['source']}/{bid['external_id']} — отклик отмечен как отправленный")
        отчёт["ok"] = True
        отчёт["order"] = oid
    except Exception as e:
        отчёт["ok"] = False
        отчёт["ошибка"] = f"{type(e).__name__}: {e}"

    if args.json:
        print(json.dumps(отчёт, ensure_ascii=False, indent=2))
    else:
        print("ИТОГ:", "успех" if отчёт.get("ok") else f"провал — {отчёт.get('ошибка')}")
    return 0 if отчёт.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
