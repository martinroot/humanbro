# 26 — Много аккаунтов, сценарии и централизованная база

Расследование по вопросу: «куча аккаунтов, разные кастомные сценарии, фарминг,
облачное размещение и централизованная база — как это реализовать на этом репо».
Дата: 2026-11-26. Репозиторий: `martinroot/humanbro` (форк Fury, workspace 0.6.9).

## 1. Что уже есть в репо и не надо изобретать

| Возможность | Где | Ограничение |
|---|---|---|
| Self-hosted сервер: организации, проекты, пользователи, RBAC, RLS, распределённый лок, аудит, метаданные прокси | `server/`, `server/migrations/0001..0022`, `docs/04` | Сервер намеренно «тупой»: не расшифровывает бандлы, не проксирует трафик |
| Профили шифруются на клиенте, сервер хранит шифротекст + `wrapped_dek` | `agent/src/bundle.rs`, `docs/01`, `docs/06` | Бандлы лежат на диске сервера (`FURY_BUNDLE_DIR`), S3/MinIO нет |
| Лок с TTL и heartbeat каждые 30 с | `profile_locks`, `agent/src/sync.rs` | Двух сессий одного профиля не бывает — это готовый барьер для сценариев |
| Agent Local API `127.0.0.1:35000` + выдача CDP WebSocket | `agent/src/ipc.rs` | Слушает только loopback; наружу выводить туннелем, не портом |
| Встроенный MCP с 20 инструментами: пул профилей, старт/стоп, открыть URL, прочитать страницу, клик, ввод, скриншот, warm-up, `fury_farm_plan`, `fury_farm_status` | `agent/src/mcp.rs:72-239` | MCP живёт в агенте, а не на сервере; центрального MCP нет |
| Farming-движок: планы на 1–90 дней, `sites_per_day` диапазоном, случайный порядок, 1–3 сессии в день, часы по таймзоне профиля, `at_once` до 6, без нагона пропущенных дней | `agent/src/farm.rs` | Состояние — JSON рядом с БД агента; командные профили фармятся только пока открыта оболочка (`farm.due`/`farm.claim`) |
| Каталог автоматизаций: `automation.json` + скрипт, `fury.py` с `running()`, `rotate.py` — один профиль за раз, shuffle, нерегулярные паузы, никакого оставленного браузера при ошибке | `examples/automations/`, `examples/rotate.py` | Это готовый шаблон «кастомного сценария», но запускается вручную/cron на машине |
| Роли: `owner`/`admin`/`manager`/`member`, права на проект битмаской (`launch`, `reveal_secrets`, `export_cookies`, …) | `docs/04` | «Оператор без секретов» уже описан и работает |

## 2. Чего НЕ хватает именно для облачной фермы сценариев

1. **Облако — только control plane.** `core` и `agent` собираются под Windows/macOS;
   в README прямо сказано: **Linux не является целью**. Значит на VDS можно поднять
   сервер и базу, но браузерные воркеры остаются на Windows-машинах. Если нужны
   именно облачные браузеры — отдельный тип воркера на Dolphin Anty Linux или
   Chrome+CDP, без обещания совместимости отпечатков Fury.
2. **Планы фарминга не централизованы.** `farm.list/create/due/claim` — методы IPC
   агента (`agent/src/ipc.rs:2040-2090`), не REST сервера. Состояние в JSON-файле.
   Нет таблиц `scenario`, `run`, `task`, нет очереди и планировщика на сервере.
3. **Командный фарминг привязан к оболочке.** `farm.due`/`farm.claim` существуют,
   потому что лок, бандл и ключ организации живут в desktop-приложении. Пока
   оболочка закрыта — командный профиль не фармится.
4. **Нет хранилища результатов.** Audit_events пишет только `profile.launch/stop`,
   `secret.reveal`, `proxy.reveal`, смену прав. «Сценарий X отработал по профилю Y,
   результат Z» — отдельной таблицы нет.
5. **Аудит не append-only.** `REVOKE UPDATE, DELETE` в `0001_init.sql` закомментирован,
   роли `fury_app` нет, compose подключается владельцем таблиц. Для нескольких
   операторов это надо чинить до запуска.
6. **Бандлы цельные, без дельт.** Каждое закрытие — полная загрузка версии;
   `FURY_KEEP_BUNDLE_VERSIONS=10` по умолчанию. Диск сервера — узкое место.
7. **VDS-реалии:** Ubuntu 24.04, 3 vCPU, 7,8 ГБ RAM, диск на 99% (782 МБ свободно),
   Docker/Node/Bun отсутствуют, nginx :443 и MySQL уже есть. Место надо освобождать.

## 3. Предлагаемая архитектура

```
VDS (control plane, Linux)          Worker-ноды (Windows, где уже стоят агенты)
┌────────────────────────────┐      ┌──────────────────────────────────────┐
│ nginx :443 (TLS)           │      │ desktop Fury → agent (named pipe)    │
│  ├ /v1/*  → fury-server    │◄─WS──┤ scenario-runner → Local API :35000   │
│  └ /scn/* → scenario-svc   │      │   └ CDP ws (loopback) → Playwright   │
│ Postgres 16                │      │ core: --user-data-dir + --proxy-server│
│  ├ schema fury (как есть)  │      └──────────────────────────────────────┘
│  └ schema scn  (сценарии)  │              │ исходящий трафик через relay
│ /var/lib/fury/bundles      │              ▼
└────────────────────────────┘        прокси клиента (не датацентр VDS)
```

**Принцип:** воркер сам инициирует исходящее WS-соединение к `scenario-svc` и
забирает задания. Входящих портов на агентах нет. Сервер по-прежнему не видит
ни cookies, ни паролей, ни страниц — он видит только метаданные заданий и результат.

## 4. Схема центральной базы для сценариев (schema `scn`)

Все таблицы — с `org_id` и `FORCE ROW LEVEL SECURITY`, как в `fury`.

- `worker_nodes(id uuid7, org_id, machine_id, capabilities jsonb, last_heartbeat, status)` —
  одна строка на агента; `capabilities` помечает, умеет ли он `fury`, `dolphin`, `chrome-cdp`.
- `scenarios(id uuid7, org_id, project_id, name, kind, spec jsonb, schedule_cron, enabled, created_by)` —
  `kind` = `farm` | `warmup` | `custom`; `spec` — переиспользование полей из
  `automation.json` плюс `targets`, `timezone_source`, `concurrency`, `jitter_sec`,
  `hours`, `sites_per_day`, `at_once`.
- `scenario_runs(id uuid7, scenario_id, status, started_at, finished_at, stats jsonb)`.
- `scenario_tasks(id uuid7, run_id, profile_id, worker_id, status, scheduled_at,
  started_at, finished_at, attempts, last_error, result jsonb)` — уникальный индекс
  `(run_id, profile_id)`; атомарный захват `UPDATE … WHERE status='queued' RETURNING`.
- `scenario_events(id bigserial, org_id, run_id, task_id, actor, action, detail jsonb, at)` —
  append-only, `REVOKE UPDATE, DELETE`.

**Лок не дублируем.** Перед стартом воркер обязан получить лок профиля через
 штатный `POST /profiles/{id}/lock`; если он занят — задача откладывается, а не
берётся «в обход». Существующий `profile_locks` остаётся единственным источником истины.

## 5. Как выглядит сценарий

- Встроенный фарминг: `kind=farm`, `spec` почти дословно повторяет `Spec` из
  `farm.rs`, но планировщик живёт в `scenario-svc`, а состояние — в `scenario_tasks`.
  Правила `farm.rs` сохраняем: без нагона пропущенных дней, часы профиля,
  `at_once`, случайный порядок,не ради скорости — чтобы не светить паттерн.
- Кастомный сценарий: папка `examples/automations/<name>/` с `automation.json`,
  entry-скриптом и `with running(...) as session`. Воркер передаёт `ws_endpoint`
  из ответа старта, скрипт цепляет Playwright и в `finally` гарантированно
  останавливает профиль. Шаблон — `examples/rotate.py` (shuffle, нерегулярный
  gap, продолжить после ошибки, итоговый отчёт, ненулевой exit при ошибках).
- Результат — в `scenario_tasks.result` и `scenario_events`; секретов в них нет.

## 6. План внедрения по слоям

**Фаза 0 — подготовка VDS.** Освободить место (кэш apt ~289 МБ + journal ~1,4 ГБ
безопасно; `/var/www/bustyvault.buzz` = 45 ГБ — только с решения владельца), поставить
Docker или готовый бинарь `fury-server` + Postgres 16, поднять compose из репо,
поверх nginx :443, закрепить `FURY_VERSION`, сделать первого пользователя и
enroll Windows-агента. Проверка: `curl -s http://127.0.0.1:8901/v1/me` → 401
`{"error":"unauthenticated"}`. Бэкапить оба тома: `fury-db` и `fury-bundles`.
До многопользовательского доступа выполнить `REVOKE UPDATE, DELETE` на `audit_events` от роли приложения.

**Фаза 1 — центральный реестр сценариев.** Миграция `server/migrations/0023_scenarios.sql`
(таблицы выше + RLS + append-only audit). Отдельный сервис `scenario-svc/` в том же
compose, общие типы из `shared-rs`. REST: `POST /scenarios`, `POST /scenarios/{id}/run`,
`GET /runs/{id}/tasks`, `WS /workers/connect`. Никаких секретов в API.

**Фаза 2 — воркер.** Новые методы IPC `scenario.pull / scenario.claim / scenario.report`
в `agent/src/ipc.rs` и инструменты MCP `fury_scenario_list / run / status` рядом с
`fury_farm_plan`. Python-раннер по образцу `examples/automations/_template` держит
исходящее WS, вызывает Local API и сообщает результат. Таймаут/отказ воркера —
задача возвращается в очередь по `STALE_MS`, как в `farm.rs`.

**Фаза 3 — фарминг в центр.** Перенести состояние планов из JSON в `scn`, заменить
зависимость от открытой оболочки на центральный claim; локальный режим оставить рабочим.

**Фаза 4 — UI.** Вкладка «Сценарии» в desktop: список, run status, по профилю дни/сайты/ошибки,
кнопки паузы/повтора. Данные — из MCP/REST, без прямого доступа к БД.

**Фаза 5 — облачные браузеры (опционально).** Отдельный `worker_type` на Dolphin Anty
Linux или Chrome+CDP для задач, где не нужна подмена отпечатков Fury. Не смешивать
с фьюри-профилями в одном пуле без явного тега.

## 7. Риски, на которые не надо закрывать глаза

- AGPL-3.0: публичный SaaS на этом коде обязан открыть изменения. Self-host — нет.
- Linux не поддерживается ядром Fury — облачный браузер на этом репо невозможен без
  отдельного проекта; VDS годится только как control plane.
- Аудит сегодня правится напрямую в БД — починить до того, как сценарии начнут
  запускать несколько человек.
- Нет дельт бандлов и S3: дисковый бюджет считать по 10 ГБ ≈ десяток профилей.
- Не открывать CDP наружу и не включать `gateway.allow_all_users` «для удобства».
- Строка `⚙️ IN=…|USD=…` — оценка, не биллинг; для учёта сценариев использовать
  `scenario_events`, а не токенный футер.

## 8. Что реально сделано 26.11 (фазы 0–1)

- VDS `94.183.186.98`: освобождено ~1,3 ГБ (`apt-get clean` + `journalctl --vacuum-size=200M`),
  поставлены `docker.io` и `docker-compose-v2` (пакет `docker-compose-plugin` в Ubuntu 24.04
  отсутствует), подняты `db`, `server`, `scenario-svc`. Проверки:
  `/v1/me` → `401 {"error":"unauthenticated"}`,
  `/healthz` → `{"ok":true,"service":"scenario-svc"}`, `scn` — 5 таблиц.
- `docker-compose.yml` публикует Postgres только на `127.0.0.1:5432`: `sqlx::test` и `psql`
  ходят туда через SSH-туннель. Сборка `scenario-svc` идёт из исходников; Dockerfile обязан
  копировать **все** workspace-члены (`platform-rs`, `desktop/src-tauri` включительно),
  иначе `cargo build` падает на загрузке манифеста workspace.
- Важно: готовый образ `fury-server` содержит миграции, вкомпилированные на этапе сборки
  (`sqlx::migrate!`). Миграцию `0023_scenarios.sql` на текущем VDS пришлось применить
  вручную: `docker compose exec -T db psql -U fury -d fury < 0023_scenarios.sql`.
  При сборке сервера из исходников она применится сама.
- Диск во время release-сборки закончился (0 байт), Postgres ушёл в recovery; после
  `docker builder prune -f` (+2,5 ГБ) контейнеры поднялись нормально. `/var/www/bustyvault.buzz`
  (45 ГБ) не трогался.
- Тесты: 130 тестов `fury-shared` + 4 интеграционных теста `scenario-svc`
  (migration/health/auth/scenarios) — все зелёные; `cargo check -p fury-server` — ok.
- На Windows для `cargo test` потребовались Visual Studio BuildTools (VCTools) и переменная
  `LIB` с путями MSVC/Windows SDK; без неё `link.exe` не находил `dbghelp.lib`.

