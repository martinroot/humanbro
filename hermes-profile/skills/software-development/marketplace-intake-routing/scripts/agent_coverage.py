#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Покрытие подбором агента по уже принятым карточкам.

Показывает долю карточек, которым назначен ЖИВОЙ агент, и группирует
неназначенные по причине. Диагностика «почему пришло мало заказов»:
сперва сверь это число с числом строк в БД, потом смотри срез ленты.

Запуск (из каталога портала, где лежат engine.py и ingest.py):
  python agent_coverage.py                 # отчёт
  python agent_coverage.py --portal PATH   # другой портал
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument("--portal", default=r"C:\sites\joblock\portal")
args = ap.parse_args()

sys.path.insert(0, args.portal)
import engine  # noqa: E402
import ingest  # noqa: E402

c = engine.db()
cur = c.cursor()
cur.execute("SELECT number, source, job, agent_code, payload FROM orders")
rows = cur.fetchall()
c.close()

ЖИВЫЕ = {a["slug"] for a in engine.list_agents() if a.get("status") == "live"}

счётчик = Counter()
примеры: list[tuple[str, str]] = []
for r in rows:
    if r["agent_code"]:
        счётчик[r["job"] or "— слаг пуст —"] += 1
        continue
    try:
        p = json.loads(r["payload"] or "{}")
    except ValueError:
        p = {}
    slug = ingest.pick_agent({"title": p.get("title", ""), "description": p.get("description", "")})
    if slug and slug in ЖИВЫЕ:
        счётчик[slug] += 1
    else:
        счётчик["— без агента —"] += 1
        if len(примеры) < 15:
            примеры.append((r["source"], p.get("title", "")[:70]))

всего = len(rows)
с_агентом = sum(v for k, v in счётчик.items() if k != "— без агента —")
print(f"карточек в базе: {всего}")
print(f"агент назначен: {с_агентом} ({с_агентом * 100 // max(всего, 1)}%)")
for k, v in счётчик.most_common():
    print(f"  {k}: {v}")
if примеры:
    print("\nпримеры без агента:")
    for s, t in примеры:
        print(f"  [{s}] {t}")
