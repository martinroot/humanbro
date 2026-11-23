---
name: embedded-agent-steps
description: Use when calling Hermes in-process from Python with skills.
---

# Агентский шаг из кода: AIAgent + предзагрузка skills

Когда сценарному коду нужен рассуждающий шаг (разбор ТЗ, решение нестандартной ситуации, ремонт после неудачной проверки) — вызывать Hermes функцией в своём процессе. Схема владельца: код выполняет предсказуемое, skill объясняет агенту как и когда, проверка результата остаётся в коде; агент вызывается только там, где нужны суждение или инструменты.

## Порядок вызова (сверено с установкой Hermes)
1. ДО импорта Hermes убрать каталог своего скрипта из `sys.path`, затем вставить корень `hermes-agent`:
   `sys.path = [p for p in sys.path if abspath(p or ".") != dirname(__file__)]; sys.path.insert(0, H)`
2. Предзагрузка: `from agent.skill_commands import build_preloaded_skills_prompt` → `prompt, loaded, missing = build_preloaded_skills_prompt([...], task_id=...)`. `missing` непуст — бросить ДО вызова модели: не тратить ход на нерабочий контекст.
3. `AIAgent(model="", quiet_mode=True, enabled_toolsets=[...], max_iterations=≤8, skip_memory=True, skip_context_files=True, ephemeral_system_prompt=prompt, request_overrides={"temperature": 0})` — пустая `model` берёт `model.default` из config.yaml.
4. `result = agent.run_conversation(user_message=..., task_id=...)`; ответ читать дефолтивно: `result.get("final_response") or result.get("response") or ...`.
5. Валидация в КОДЕ: JSON-разбор + обязательные ключи схемы; при сбое — ровно ОДИН ограниченный repair-вызов с текстом ошибки парсинга.

## Pitfalls
- **Локальный `queue.py` затирает stdlib `queue`:** импорт Hermes падает `module 'queue' has no attribute 'Queue'`, и несколько модулей tools молча не загружаются. Фикс — шаг 1; каталог контура почти всегда содержит файл с именем модуля stdlib, поэтому правило не снимается «для простоты».
- **Не форматировать шаблон, содержащий JSON-скобки, через `str.format`** — `KeyError: '"state"'`; собирать конкатенцией или f-строкой.
- **Длинный JSON от модели нестабилен даже при temperature 0** — ступенчатый разбор: снять markdown-fences → первый сбалансированный блок → убрать висячие запятые; затем один repair-повтор. Больше ретраев = только деньги и тот же результат.
- **skill в промпте — инструкция, а не гарантия:** независимая проверка (verify) живёт в вызывающем коде; «агент ответил done» не закрывает шаг.
- **Бюджет шага ограничен (~60–90 с в задаче):** вынести вызов в отдельный процесс со своим контрактом stdin/stdout JSON (как `hermes_worker.py`) — тогда бюджет шага остаётся контролируемым, а CLI-шум уходит в stderr, не в протокол.