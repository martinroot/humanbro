# -*- coding: utf-8 -*-
"""Быстрая проверка конвейера отклика/оценки после правок промпта или карточки.

Запуск:  cd C:/sites/joblock/portal && PYTHONPATH=. python <этот файл>

Ничего не пишет в БД и ничего не отправляет в Telegram — только читает настройки
и рендерит карточку на синтетическом заказе.
"""
import json
import sys

sys.path.insert(0, r"C:\sites\joblock\portal")

import mll2
import mll_models
import tg_notify

FAIL = []


def check(name, ok, detail=""):
    print(("OK   " if ok else "FAIL ") + name + ((" :: " + str(detail)[:160]) if detail and not ok else ""))
    if not ok:
        FAIL.append(name)


# 1. Сохранённый промпт не должен перебивать новый дефолт (частая ловушка).
saved = mll2.reply_prompt()
default = mll2.DEFAULT_REPLY_PROMPT
check("saved prompt == DEFAULT_REPLY_PROMPT", saved == default,
      "в mll_settings.json лежит старый текст — вызвать mll_reply.save_prompt(mll2.DEFAULT_REPLY_PROMPT)")

low = default.lower()
check("prompt: короткий формат", "готов выполнить" in low)
check("prompt: запрет пересказа ТЗ", "не пересказыв" in low)
check("prompt: опыт из базы", "опыт" in low)

# 2. Пороги меток должны совпадать с границами в промпте.
sys_prompt = mll2.build_score_prompt([], 40)
check("prompt score: скамность 0–100", "0–100" in sys_prompt)
check("prompt score: скамность не null", "не возвращай null" in sys_prompt.lower())
check("prompt score: agentic 90–100", "90–100" in sys_prompt)
check("prompt score: agentic 50–89", "50–89" in sys_prompt)

check("метка агента: 90 = сам", mll2.агент_метка(90) == "агент сделает сам", mll2.агент_метка(90))
check("метка агента: 89 = + человек", mll2.агент_метка(89) == "агент + человек", mll2.агент_метка(89))
check("метка скама: 0 = низкий, не н/д", mll2.риск_метка(0) == "низкий", mll2.риск_метка(0))
check("метка скама: 70 = высокий", mll2.риск_метка(70) == "высокий")

# 3. Валидация держит три числа 0–100.
item = {
    "id": "W-1", "score": 78, "verdict": "ready", "risks": [], "time": "",
    "plan": [], "cost": None, "questions": [], "reply_draft": "Д" * 40,
    "quote_range_rub": None, "customer_risk_score": 20,
    "customer_risk_reasons": [], "customer_risk_confidence": "low",
    "agentic": 89,
}
try:
    out = mll_models.validate_pass2_item(item, "W-1")
    check("валидация: три числа прошли", (out["score"], out["customer_risk_score"], out["agentic"]) == (78, 20, 89))
except Exception as exc:
    check("валидация: три числа прошли", False, exc)

try:
    mll_models.validate_pass2_item(dict(item, agentic=150), "W-1")
    check("валидация: agentic>100 отклонён", False)
except ValueError:
    check("валидация: agentic>100 отклонён", True)

prepared = mll2.prepare_pass2_item(item, "W-1", 40, "test-model")
check("prepare_pass2_item не теряет agentic", prepared.get("agentic") == 89, prepared.get("agentic"))

# 4. Карточка: три числа и честный вердикт.
order = {"id": 1, "source": "workzilla", "external_id": "W-1", "title": "Тест",
         "price": 1000, "raw_json": "{}", "analysis_json": "{}"}
card = tg_notify.текст_заказа(order, prepared)
check("карточка: Оценка", "Оценка: 78" in card)
check("карточка: Скамность", "Скамность: 20" in card)
check("карточка: Агент", "Агент: 89" in card)

bad = tg_notify.текст_заказа(order, {
    "score": 0, "verdict": "reject", "reply_draft": "Д" * 40,
    "customer_risk_score": 95, "customer_risk_confidence": "high",
    "customer_risk_reasons": ["просит привести клиентов и принять оплату"]})
check("карточка reject: не «готов взять»", "готов взять агентом" not in bad.lower())
check("карточка reject: скамность 95", "Скамность: 95" in bad)
check("карточка: тех.коды скрыты", "insufficient_public_data" not in bad)

print()
print("ИТОГО:", "всё зелёное" if not FAIL else "ПАДАЕТ: " + ", ".join(FAIL))
sys.exit(1 if FAIL else 0)
