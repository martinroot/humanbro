# BROWSER AUTOMATION HANDOFF — JobLock / Windows

Составлено 2026-11-23 по фактическим файлам, процессам и запущенным сервисам.
Это рабочий справочник для агента, который берёт браузерную автоматизацию.
**Секреты здесь НЕ приведены** — только пути к защищённым файлам и имена ключей.
Никогда не печатай значения ключей/паролей/токенов в чат, логи,саммари и отчёты.

## 1. Куда всё лежит

| Что | Путь |
|---|---|
| Корень браузерной автоматизации | `C:/Users/Administrator/browser-automation` |
| База знаний (историческая, October) | ``BASE-KNOWLEDGE.md``, `CONTEXT-2026-10-21.md` |
| Портал JobLock (FastAPI, DB, оценка, Telegram) | `C:/sites/joblock/portal` |
| Песочница (НЕ трогать без запроса) | `C:/sandbox` (:8788/:8789) |
| Hermes venv Python | `C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` |
| Bun | `C:/Users/Administrator/.bun/bin/bun.exe` |
| Видимый Chrome | профиль `C:/chrome-profile`, CDP `http://127.0.0.1:9222` |
| Fury antidetect | `C:/Users/Administrator/AppData/Local/Fury` (exe `fury-desktop.exe`, `fury-agent.exe`) |
| Fury state / API token | `C:/Users/Administrator/AppData/Roaming/Fury` (`fury.db`, `api-token`) |
| Dolphin Anty (legacy) | `C:/Program Files/Dolphin Anty/Dolphin Anty.exe`, local API `http://127.0.0.1:3001` |
| Workspace временных скриптов/Fury | `C:/Users/Administrator/AppData/Local/Temp/fury-install` |
| Навыки Hermes | `C:/Users/Administrator/AppData/Local/hermes/skills` |

## 2. Сервисы и порты (последняя проверка)

| Порт | Роль | Проверка |
|---|---|---|
| 9222 | общий видимый Chrome, все CDP-скрипты | `curl http://127.0.0.1:9222/json/version` → 200 |
| 8701 | JobLock portal | `curl http://127.0.0.1:8701/` → 200 |
| 8080 | nginx, публичный `/portal/*` basic-auth | `401` без авторизации — норма |
| 3001 | Dolphin local API (только пока запущен клиент) | `401` без токена — норма |
| 35000 | Fury local automation API | `401` без токена — норма |
| 8000 | jobsy (портал Mission Control) | в момент проверки не слушал |
| 3306 | MariaDB | через curl не виден, проверять DB клиентом |
| 8788/8789 | песочница | НЕ трогать |

Публичный портал: `http://195.63.128.99:8080/portal/...`; nginx проксирует только `/portal/`,
поэтому любой `fetch()` в JS страниц должен строить `apiPrefix = path.startsWith('/portal/') ? '/portal' : ''`.

## 3. Текущий режим и процессы

- `reviews/data/mode.json`: `режим = search` (фокус пуст, с 2026-11-21 19:48).
- Инцидент 2026-11-23 21:05: второй агент нашёл застой `feed-log.jsonl` с 16:47 при живых
  процессах и авторизованной вкладке Workzilla. Точечно остановлены PID 10412/5392/5644/10124/3724/252
  и поднят один `PARSER_MARKETS=wz bun parser.ts`; к 21:07 mtime фида и лога обновился, пришли новые
  карточки (`22568174`, `22568288`) с `ingest_number`. Урок: живой процесс ≠ живой приём — сверять mtime.
- Активны: `bun parser.ts` с `PARSER_MARKETS=wz` (Workzilla-only), `bun watch-chat.ts --minutes 300`,
  `python app.py` портала, видимый Chrome на :9222, Fury desktop, Dolphin (по необходимости).
- Единственный писатель `mode.json` — `reviews/mode.py переключить <режим> [фокус]`.
  Порядок фаз: `execute` (1 заказ) → `chat` (разобрать всё) → `search`.
- Режим отклика — полный стоп: `portal/response_isolation.py.остановить_всё()`; если хоть один
  воркер жив, отправки нет.

## 4. Ключевые скрипты

### Shared visible Chrome / CDP
- `browser.ts` — `attachToVisible()`, подключение к :9222, уборка вкладок, таб-бюджет.
- `parser.ts` — фид-парсер, **`PARSER_MARKETS=wz`** (только ASCII-имена env!). Workzilla only.
  Ленты обновляются AJAX: click «Новые» + `waitForResponse('/list/open')`, **не reload**.
- `hold.ts`, `serve.ts` — удержание видимого окна; `serve.ts` интерактивен, в background только с PTY.
- `tab-budget.ts` — порог уборки вкладок по `keep-tabs.json`.
- `open-monitor-tab.ts`, `probe-visible-tab.ts` — восстановить мониторинг-таб / прочитать вкладку.

### Отклики и лента
- `bid.ts` — отклик на задание; `bid-sender.ts` — очередь `/api/win/bids`; `auto-bid.ts`;
  `chat.ts`, `ask-client.ts`, `kwork-bid.ts`.
- `watch-chat.ts` — монитор ответов заказчиков (один процесс на список id, не на заказ).
- `watch-feed.ts`, `watch-orders.ts`, `watch-boards.ts` — наблюдатели.
- `wz-detail.ts` — детали заказа (второй этап); `*-demand.ts` — коннекторы спроса.
- `bid-watch.ts` —是watcher откликов.

### Антидетект и прокси
- `fury-login-all.sh` — последовательная авторизация Яндекс-аккаунтов в Fury.
- `yandex-login.ts`, `yandex-whoami.ts`, `check-auth.ts` (в temp) — логин и проверка.
- `dolphin.ts` — локальный/облачный API Dolphin; `dolphin-to-fury.ts` + CSV-мост.
- `asocks-buy.ts` — покупка/проверка портов ASOCKS (`ASOCKS_TYPE_ID=2` = mobile RU);
  `asocks.ts` — общий клиент.
- `reviews/registry.py list-accounts` — реестр аккаунтов (9 активных Яндекс: #2,#3,#4,#15,#16,#17,#18,#19,#20).
- `reviews/pool.py`, `reviews/dolphin_pool.py` — пул аккаунтов и прокси.
- `Fury MCP`: `C:/Users/Administrator/AppData/Local/Fury/fury-agent.exe mcp`, 19 инструментов
  (`fury_add_proxies`, `fury_update_profile`, `fury_start_profile`, `fury_read_page`, …).
  Рабочий клиент: `Temp/fury-install/mcp_client.py`. HTTP `/v1` только читает/стартует.

### reviews/ (Python, конвейер)
`mode.py`, `pipeline.py`, `pipeline_cycle.py`, `pool.py`, `registry.py`, `order_flow.py`,
`dialog.py`, `chat_state.py`, `dedup_send.py`, `approve.py`, `auto_publish.py`, `notify.py`,
`cleanup_profiles.py`, `provision.py`, `diag_*.py`, `file_log.py`, `hold_tab.py`.

## 5. Доступы (только пути и имена ключей)

| Файл | Ключи / назначение |
|---|---|
| `browser-automation/.env` | `XAI_API_KEY`, `GROK_TG_TOKEN`, `GROK_TG_CHAT`, `TG_TOKEN`, `TG_CHAT`, `TG_QUIET`, `PORTAL_API_KEY`, `PARSER_SINK`, `FABRA_PARSER_TOKEN`, `OPENROUTER_API_KEY` |
| `browser-automation/asocks.env` | `ASOCKS_API_KEY` |
| `browser-automation/dolphin.env` | `DOLPHIN_API_KEY` |
| `C:/Users/Administrator/AppData/Roaming/Fury/api-token` | токен Fury local API :35000 |
| `C:/Users/Administrator/AppData/Local/Temp/fury-install/failed_accounts_creds.txt` | логин/пароль/ответ на контрольный вопрос #4/#16/#18/#20 |
| `Temp/fury-install/new-proxies.json`, `px2.json` | новые мобильные RU-порты #16/#20 |
| `C:/sites/joblock/portal/engine.py` | доступы к MariaDB (в коде, не выносить в чат) |
| `C:/nginx/conf/.htpasswd` | basic-auth публичного портала |
| Hermes Vault / browser_vault_* | для логинов на биржах — вызывать `browser_vault_list` ПЕРВЫМ, никогда не угадывать |

Правила:
- **Никогда не print/не копировать значения** ключей, паролей, токенов, прокси-строк.
- `PARSER_SINK=joblock` обязателен (`fabra` рассылал проекты не туда, откат невозможен).
- В СНГ/кириллица: для HTTP-тел с кириллицей использовать `--data-urlencode "text@file.txt"` (файл UTF-8).

## 6. Как пользоваться (проверенные команды)

```bash
cd C:/Users/Administrator/browser-automation

# язык и зависимости
bun --version
bun update playwright && bunx playwright install chromium   # только при рассинхроне драйвера/Chrome

# проверить видимый Chrome
curl http://127.0.0.1:9222/json/version

# парсер (только search; один процесс на рынок)
PARSER_MARKETS=wz bun parser.ts >> parser-wz.log 2>&1
# проверить: mtime parser-wz.log и feed-log.jsonl advancing in ~60s

# прочитать чат заказа
bun chat.ts <id>
# детали заказа
bun wz-detail.ts <market> <id> <url>

# реестр аккаунтов
python reviews/registry.py list-accounts
# переключение фазы (единственный писатель)
python reviews/mode.py переключить search

# Fury MCP (stdio JSON-RPC)
python C:/Users/Administrator/AppData/Local/Temp/fury-install/mcp_client.py

# HTTP API Fury (read/start)
TOKEN=$(cat C:/Users/Administrator/AppData/Roaming/Fury/api-token | tr -d '[:space:]')
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:35000/v1/profiles
```

## 7. Жёсткие правила

1. Martin хочет видимый Windows Chrome через CDP; скрытые сессии — только для чтения/диагностики, не для работы.
2. Login только вручную в видимом окне; если нет сохранённого vault — вернуть пользователю, не угадывать.
3. `browser.close()` по CDP закрывает весь браузер профиля — всегда `process.exit(0)`.
4. Не перезагружать (`reload`) живую SPA-ленту и страницу после отправки отклика — читать DOM/XHR.
5. В режиме отклика/ручного UI останавливать ВСЕ воркеры: parser, wz-detail, watch-chat, demand;
   проверять по CommandLine, не по имени процесса.
6. Один рынок — один процесс парсера; env-переменная только ASCII (`PARSER_MARKETS=wz`).
7. `keep-tabs.json` переписывать только через `reviews/mode.py`, не хардкодить все биржи.
8. Убивать конкретные PID по CommandLine; `taskkill /IM bun.exe` убивает.shared Chrome и воркеры.
9. В Chrome 157+ `--remote-debugging-port` работает только с явным `--user-data-dir=C:/chrome-profile`.
10. Скрипт с `connectOverCDP` не закрывать `browser.close()`, otherwise profile dies.
11. Live-отклик только после явного одобрения владельца и gate; Test — только черновик.
12. Каждый заказ — отдельный профиль Hermes и отдельный топик; база скиллов отдельная сущность.

## 8. Известное состояние Fury accounts

- Подтверждены через MCP/HTTP: #2,#3,#15,#17,#19 (чистый логин), #4,#18 (ручной вход владельца).
- #16/#20: новые мобильные RU ASOCKS-порты, привязаны и запущены через MCP; `ERR_TUNNEL_CONNECTION_FAILED` ушёл.
- #2: 2026-11-23 старый порт `185.100.232.75:11697` умер (`CONNECT tunnel failed, response 404`);
  куплен и через MCP привязан `185.100.232.75:10331`, кабинет отзывов открылся, сессия сохранилась.
- #3 был временно перепривязан по ошибке и восстановлен на старый прокси (`175.110.115.169:11762`).

## 10. Финальный чекап Яндекс-сессий (2026-11-23)

- Все 9 профилей (`#2,#3,#4,#15,#16,#17,#18,#19,#20`) имеют живую сессию Яндекса:
  проверка `https://id.yandex.ru/profile` через Fury MCP прошла для всех.
- `https://reviews.yandex.ru/` открывает кабинет `/ugcpub/cabinet` с блоками
  «Задания / Оценки и отзывы» и карточками организаций во всех 9 профилях.
- #20 был разлогинен; вход восстановлен: на `auth/add` нажать «Ещё» → «Войти по логину»,
  ввести логин/пароль, ответ на контрольный вопрос, затем «Напомнить позже» на WebAuthn.
  Креды брать из `Temp/fury-install/failed_accounts_creds.txt`, не печатать значения.
- Рабочие скрипты: `Temp/fury-install/check_all_reviews.py`, `check_sessions_all.py`,
  `final_recheck_reviews.py`, `login20_step{1..4}.py`.

## 11. Куда смотреть дальше

- `BASE-KNOWLEDGE.md` — исторический контекст (старый Dolphin/3 аккаунта — считать устаревшим).
- Навыки Hermes: `visible-marketplace-browser-automation` (+ `references/parser-pause-resume.md`,
  `kwork-offer-form.md`, `kwork-portfolio-upload.md`, `dolphin-anty-api.md`),
  `joblock-chrome-cdp-ops` (+ `references/cleanup-after-work.md`, `stage-mode-controller.md`),
  `joblock-order-pipeline`, `marketplace-account-pool` (+ `references/proxy-vendor-api.md`,
  `references/fury-proxy-ui.md`), `order-feed-pipeline`, `joblock-agent-portal`,
  `joblock-monitoring`, `joblock-niche-launch`, `windows-persistent-services`.
- Логи: `parser-wz.log`, `feed-log.jsonl`, `reviews/data/*`, `Temp/fury-login-all.log`,
  `Temp/fury-install/*`, `Roaming/Fury/logs/agent.log`.
