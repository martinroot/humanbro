---
name: joblock-monitoring
description: "Monitor JobLock orders and statuses on /portal/."
---

# JobLock monitoring на /portal/

Класс: собрать/чинить систему мониторинга поверх существующих баз JobLock — статусы, заказы, переписки, свежесть сбора. Исполнение заказов (worker/runner/gateway) в эту зону НЕ входит: владелец выделил `/portal/` (nginx :8080, basic-auth, → :8701) как единственную систему мониторинга и остановил исполнительский стек. Исполнение не поднимать без прямого распоряжения владельца.

Кодовая база и пишущие контуры — в skill `joblock-agent-portal`; здесь только чтение/мониторинг.

## Где лежат данные (сводка всех источников)
- **MySQL `joblock`** (127.0.0.1:3306, pma): `orders` — ENUM new/queued/running/done/failed/paid/needinfo/blocked; `market_projects` — карточки лент, связаны 1:1 с orders через `order_number`; `tasks`, `fabra_bids`, `runs`. `mysql` НЕ в PATH — вызывать `"C:/Program Files/MariaDB 12.3/bin/mysql.exe" -h 127.0.0.1 -u pma -p… joblock`.
- **SQLite `browser-automation/reviews/data/registry.db`** (read-only): `flow` — заказы-отзывы (у хеш-номеров `WO-…` реальный id биржи в колонке `target`), `flow_log` — события, `steps`, `sent_log`, `file_log`.
- **Единый канон статусов**: `portal/status_machine.py` → `слить(портал_status, flow_status)` поверх обеих баз, реестр главнее; уже подключён в `orders_page` (`/orders`) и `orders_view` (`/`, таблица текущих + `wz_cache.json`).
- **Переписка хранится в ТРЁХ местах** — для карточки заказа читать всё: `C:/var/lib/joblock/works/<NUMBER>/state.json` (`clarify_question`, `clarify_sent/attempts`, `history[]`) + `log.jsonl` рядом; `registry.db` `flow_log`/`sent_log`; чаты Workzilla `browser-automation/logs-watch-chat-<id>-live.txt`.
- **Свежесть сбора**: `browser-automation/marketplace-health.json` (status/last_ok/error по каждой ленте), `wz_cache.json` (`fetched_at`), mtime `feed-log.jsonl`/`kwork-log.jsonl`; сверяй их с последними событиями `cycle_journal.jsonl` и `market_projects.parser_updated_at`, потому что health-файл может быть устаревшим и не подтверждает текущую активность коннектора.

## Правила
- Портал не имеет hot-reload: после правки python-кода убить процесс и перезапустить (иначе рисуешь новый код, а живёт старый bytecode).
- Разделяй живость сборщика и появление новых объявлений: проверь процесс и свежий тик журнала, затем сравни distinct `(source, external_id)` и `created_at` с `parser_updated_at`/`updated_at`. Свежие обновления старых ID означают повторный upsert, а не новые заказы. Для browser-feed свежий тик также не доказывает обновление DOM: проверь состояние страницы и reload-guard. Сначала показывай alive-статус источника, затем новые уникальные записи и статусы.
- Страницы через nginx идут с префиксом `/portal/` (nginx его срезает перед прокси): JS на страницах портала ходит относительными путями (`api/...`), не абсолютными `/api/...`.

## Подъём и контроль портала (единственный источник правды)
- Единственная точка старта — Scheduled Task `JobLock-Portal` (ONLOGON, RL HIGHEST), wrapper `C:/sites/joblock/portal/run_portal_task.cmd`. Ручной запуск: `schtasks /Run /TN "JobLock-Portal"`. `launch_portal.bat` только делегирует задаче — никогда не запускать app.py вторым процессом (дубли на :8701). В wrapper питон прописан ЯВНО (venv `hermes-agent/venv/Scripts/python.exe`): под задачей PATH другой и голый `python` без pymysql молча валит старт с ModuleNotFoundError в portal.err.log.
- Лечить падение так: `tail portal.err.log` → причина; `Get-CimInstance Win32_Process` по CommandLine `app.py` — оставить ровно один процесс (netstat на :8701 показывает слушателя; kill НЕ-слушателя, но проверить, что после kill жив — они бывают родитель/воркер).
- Health-check: cron-джоб `JobLock Portal Healthcheck` (каждые 10 мин, id eef9cc627ba5) — curl :8701, при падении `schtasks /Run` и уведомление в telegram. Правки крон-джоба — через cronjob_manage.
- Тесты портала — `cd C:/sites/joblock/portal && python -m unittest discover -s tests` (pytest НЕ установлен в venv). Flake: `test_start_agent_returns_dagi_error_expected` ожидает 503 при выключенном Dagi-core :8791 — если Dagi поднят, тест честно получает 200; это не регрессия.
- Переключение режима из кода — `POST /api/log/isolated/mode` (→ isolated_control → mode.py): писать mode.json руками запрещено, единственный писатель — reviews/mode.py (аудит проведён, остальные модули только читают).
- Внешние задачи из чата WINTASK входят через `POST /api/wintask` (тело `{"текст":"TASK|N|..."}`, создаёт задачу MySQL `tasks` с note `WINTASK|N|...`); кириллица в curl из git-bash — только через UTF-8 файл `--data-binary @file`.

## Sandbox portal (демо-заказы) и его вход в мониторинг
- Демо-лента — отдельный портал `C:/sandbox/market` на **:8788** (server.py «Лента заказов» + engine.py). Поднимать фоновыми `sbx_portal.bat` / `sbx_engine.bat` (самоперезапуск-циклы; после старта лог в C:/sandbox/sbx_*.log, health в sbx_health.txt). Feed JSON: `GET http://127.0.0.1:8788/feed` (projects: source/external_id/title/description/price/url).
- В мониторинг лента попадает насосом `hermes/scripts/sandbox_orders_pump.py` (poll /feed → POST `/api/ingest` каждые 20 с, pid-процесс должен жить). ПО ДИЗАЙНУ песочные карточки НЕ создают orders: ingest кладёт их только в `market_projects` (очередь откликов) и возвращает `{"sandbox": true, "number": ""}` — ноль sandbox-записей в unified-orders это норма, проверять `market_projects.source='sandbox'`.
- Портал артефактов песочницы: `/sandbox` (portal/sandbox_page.py) — SANDBOX-заказы jobsy с кодом агента (bot.py и т.п.) прямо в браузере. Пункт «Песочница» в portal_nav.py.
- nginx: `/sbx/` → :8788 за basic-auth (см. ниже) — песочница смотрится с улицы одним адресом.

## Настройка активных бирж (галочки)
- Страница `/settings` (settings_page.py) → POST `/api/settings/exchanges` → mll_settings.json ключ `биржи` (workzilla/kwork/insolvo/sandbox). Это ЕДИНСТВЕННЫЙ источник правды о том, на каких биржах ведётся активность — цикл/парсеры читают `settings_page._активные()`, а не свои списки.
- **Fabra в галочках НЕТ по решению владельца**: модель — стандартизованная база заказов + коннекторы под каждую биржу; parser.ts льёт через `PARSER_SINK=joblock` прямо в базу. Не возвращать Fabra в настройки/синки без прямого распоряжения; legacy `sandbox-feed-pump.ts` (→Fabra) не запускать.
- POST мёржит частичное тело поверх текущего (не слепо заменяет весь dict) — иначе забытый ключ тихо выключает биржу.
- `req: Request` в эндпоинте отдельного page-модуля требует импорта Request НА УРОВНЕ МОДУЛЯ: локальный import внутри install() не виден при резолве аннотации, FastAPI трактует req как query-параметр и POST отдаёт 422 «Field required».

## Последовательный цикл (по спецификации владельца)
- Ровно одно состояние: search (тик 60 с) / chat (300 с, только при активных диалогах) / execute (только фокус-заказ, один чат). Код: `portal/cycle.py` (daemon-поток app.py, каждый тик в try/except → журнал `цикл_ошибка`).
- Переключения — только через reviews/mode.py (единственный писатель mode.json, он же чистит вкладки); каждое переключение логируется с триггером.
- Журнал строго последовательный: `cycle_journal.jsonl` + `cycle_state.json`; страница /collector показывает жирный цветной «● РЕЖИМ: …» и журнал с триггерами.
- Питфолл: процесс портала под Scheduled Task работает с cp1252 stdout — кириллический `print` в daemon-треде убивает ТРЕД целиком (журнал обрывается на «старт», тиков нет, в err.log UnicodeEncodeError). В фоновых потоках портала оборачивать print в try/except UnicodeEncodeError (уже сделано в cycle.py); при «цикл молчит» первым делом искать этот трейсбек в portal.err.log.

## nginx (:8080, единый вход)
- Мастера запущены как `C:/nginx/nginx.exe -p C:/nginx -c conf/nginx.conf`. Правка конфа: патчить питон-патчером через write_file; проверка `-p C:/nginx -t -c conf/nginx.conf` (без `-p` падает на относительных temp-путях). Reload обычно ломается (stale pid/OpenEvent) — гасить ОБА мастера taskkill и стартовать той же строкой с `-p C:/nginx`.
- Локации: `/portal/` → :8701, `/sbx/` → :8788, обе за .htpasswd (admin/956916). Проверка: с auth 200, без 401.

## Pitfalls
- git-bash heredoc жрёт бэкслэши и кавычки — инлайн-патчи Python с `\n`/экранированными кавычками ломают файл; писать патчер файлом (write_file) и запускать его. Кириллица в curl из git-bash — только `--data-binary @utf8-файл` (body в CP1251 молча искажается).
- Пересечение orders∩flow — частичное (~115 из сотен): заказ может жить только в одной базе, канон считать через `слить` с пустой стороной, а не INNER JOIN.
- `registry.flow` содержит мусор старого харвеста (`exchange_status='unknown'`, state discovered/closed без пользы) — в «текущих» не показывать (логика уже в `orders_view`).
- JSON-колонки pymysql отдаёт строкой — `json.loads` до любого `.get()`; datetime/Decimal ломают JSONResponse — чистить перед отдачей.
