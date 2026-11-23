---
name: joblock-self-repair-loop
description: Use when JobLock repair queue or diagnostics is involved.
---

# JobLock self-repair loop (диагностика → эскалация → ремонт → проверка)

Автономный контур самоподдержки: падения контура превращаются в инженерные карточки, карточки — в конечные ремонты через агента, результат — в независимую проверку. Исполнитель заказов (`review-order-fulfillment`) и портальный движок (`joblock-agent-portal`) — отдельные слои; сюда их код НЕ переносится (публикация отзывов, аккаунты, обходы — вне этого контура).

## Участники и команды (всё установлено отдельными папками; старое не удалять)
- **Диагностика без LLM** — `C:\Users\Administrator\joblock-maintenance-0.1.0\joblock-maintenance-0.1.0`, ScheduledTask `JobLockMaintenanceDiagnostics`: `python joblock_maintenance.py once | status | record <компонент> <код> | flush | audit --source <путь>`; конфиг `maintenance.example.json` (probe `http://127.0.0.1:8701/api/tasks`, `task_api.enabled=true` → инженерные карточки с маркером `[JM:…]`); потерянный POST не ретраится — сверка списка, затем `confirm-not-sent <fingerprint> --confirmed-absent`.
- **Очередь ремонта** — `C:\Users\Administrator\joblock-runtime-1.0.0\joblock-runtime-1.0`, Scheduled Tasks `JobLockRuntimeV1` (аргумент `run`) и `JobLockAgentGatewayV1` (AtStartup, restart 999×1 мин, S4U): `python runtime.py --config runtime.json {run,once,status,enqueue command --payload … --key …}`; gateway `127.0.0.1:8802`, своя БД `state/agent.db` (это НЕ база заказов).
- **Эскалация из cron-скриптов** — `%LOCALAPPDATA%\hermes\scripts\task_queue.py`: `on_exception(компонент, тип, текст)` (стоит в `sys.excepthook` и в except-блоках обёрток) → гейт → `POST /api/tasks` портала.
- **Наблюдение** — cron `status_sys.py` (личка владельца): heartbeat >600 с, `failed`-задача, рост открытых `[EX:]` — инженерный сигнал, который должен читаться НЕЗАВИСИМО от проверяемого процесса.

## Always-on правила
- **Диагностика только читает; ремонт — конечный шаг с независимой проверкой.** Слово агента «готово» не является доказательством: verify-wrapper сам выполняет `verify_argv` из инцидента и отвергает done при непрохождении.
- **Без слепых повторов:** карточка в `/api/tasks` ставится только после сверки маркера `[EX:<sha1>]` среди открытых; приём в gateway требует `Idempotency-Key` ровно 24 hex.
- **Один ремонт — один ресурс, шаг конечен** (`step_timeout=180`, обёртка режет на 170 с). Длинную работу агент дробит сам; бесконечных попыток саморедактирования нет, `failed` остаётся видимым оператору.
- **Ремонта без состояния не бывает:** при недоступном агенте инцидент лежит в базе и доставляется после восстановления; ручное «починить мимо» теряет контроль.

## Процедура
1. **Статус контура:** `python runtime.py --config runtime.json status` (heartbeat/jobs/incidents) + `python joblock_maintenance.py status` + открытые карточки `[EX:]`/`[JM:]` в `GET http://127.0.0.1:8701/api/tasks`.
2. **Эскалация падения:** штатно делает хук из `task_queue.py`; вручную — `on_exception(...)` или `python task_queue.py "<заголовок>" [--dry-run]`. Формат канала трекера: `ID <компонент> | Исключение <тип> | Ошибка: <текст>`; портал-канал работает всегда, трекер WINTASK — только при наличии `X_INGEST_KEY` (без ключа хук пишет отказ в stdout и не спамит чат).
3. **Постановка ремонта:** `POST http://127.0.0.1:8802/tasks` с `Authorization: Bearer $JOBLOCK_AGENT_TOKEN`, тело `{"kind":"engineering_repair","idempotency_key":"<24hex>","summary":"…","path":"…","verify_argv":[…]}`; статус — `GET /tasks/<key>` (`queued|running|succeeded|failed`).
4. **Цикл ремонта:** runtime → `agent_wrapper.py` (JSON stdin → `hermes -z "<промпт>" --cli` → ПОСЛЕДНЯЯ строка — строго один JSON `{"state":"done"|"blocked",…}`) → `verify_wrapper.py` (независимый запуск `verify_argv`, fallback `py_compile` по `path`) → состояние jobs.
5. **Приёмка** — таблица 24-часовых сценариев в `joblock-runtime-1.0.0/…/AGENT_HANDOFF.md`; результаты установки фиксировать в `DEPLOYMENT.md` того же каталога.

## Питфоллы
- **`.format()` над шаблоном, содержащим JSON-скобки, роняет обёртку** (`KeyError: '"state"'`) — шаг умирает ДО вызова агента, а в инциденте остаётся лишь имя класса исключения. Промпты собирать конкатенацией, не форматированием.
- **Windows-`Singleton`: `PermissionError` на чтении залоченного файла означает «занято»,** не сбой планировщика — оборачивать в `RuntimeError('Another runtime owns …')`, иначе один тест падает на Windows при полностью рабочем ядре.
- **`setx` не экспортирует в уже открытую оболочку:** токен задаётся в HKCU (его видят Scheduled Task), а при ручном запуске gateway передаётся в `env` явно — иначе свой же процесс отвечает 401 на свой токен.
- **Патчи живого кода — скриптом на ASCII-идентификаторах:** текстовый конвертер рядом с кириллицей подставляет `in`→`в` и калечит walrus `:=`, превращая патч в SyntaxError; всегда `compile()` до записи и не перезаписывать файл без успешной компиляции.
- **Шум не эскалируется:** `task_queue.gate` глотает FileNotFoundError/KeyError/StopIteration и повтор того же исключения в cooldown 30 мин; лимиты трекера (дубли, ≤3 открытых от одного source, 429) — ждать, а не ретраить.
- **Цикл доказывается целиком, а не по звену:** безвредная локальная поломка (py_compile собственного файла) → инцидент → ровно одна работа → агент → verify → `succeeded/verified`.
