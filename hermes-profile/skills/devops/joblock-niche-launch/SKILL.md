---
name: joblock-niche-launch
description: "Use when launching a new JobLock niche from demand data."
---

# Запуск ниши JobLock

Класс: выбрать новую нишу по данным, доказать на песочнице, настроить поток заказов и постановку — с чекапом систем перед каждым шлюзом. Провал ворот = откат к выбору ниши, НЕ «докручивание на живых заказах».

## Ворота
1. **Чекап систем**: `curl http://localhost:8701/` (200), bun `--version`, registry.db читается, Chrome с CDP :9222, Dagi :8791 (блокер только постановки). Сводку писать в `portal/logs/system_checkup.json`.
2. **Съём спроса + скоринг**: пороги — ≥5 заказов/день, медиана ≥500₽, покрытие шаблонами jobsy ≥0.5. Один снапшот ленты — НЕ дневной поток; порог по объёму подтверждается мониторингом за 24ч (wz_pull/повторные срезы), не одним срезом. Запасная ниша выбирается заранее (следующая по медиана×покрытие).
3. **Песочница**: sandbox-заказ `POST /api/tasks` с `cat:"sandbox"` → прогон шаблона через jobsy → артефакт на подтверждение владельцу. Нет шаблона и писать >1ч — вернуться к скорингу, брать нишу с покрытием.
4. **Поток**: парсер по ключевым словам → только через `POST /api/ingest` → проверка `GET /api/unified-orders` содержит свежие записи. Фильтр «в работу/отказ» в `portal/mll_settings.json`; отказ — честный отказ, не тишина.
5. **Постановка**: `python reviews/mode.py переключить execute <фокус>` → `/api/bot` показывает режим/фокус → запуск через jobsy → итог в чат владельцу ДО отправки → сдача по правилам Workzilla (файл один раз, скрин с задержкой).

## Съём спроса Workzilla (снято и проверено)
- Скрипт: `browser-automation/wz-demand.ts "<запрос>" [limit]` — attach к видимому Chrome (CDP :9222), карточки `[data-order-id]`.
- Лента = `client.work-zilla.com/freelancer`. НЕ `?search=`, НЕ `/tasks`, НЕ `/freelancer/orders` — все они 404 или редирект на главную. Серверного keyword-поиска в ленте нет: снимать всю ленту целиком и фильтровать по ключевым словам на своей стороне.
- Цена Workzilla — число в ХВОСТЕ текста карточки, без символа валюты: брать последнее число; матч `\d+\s*(₽|руб)` даёт пусто.
- Фильтр ключевых слов — ТОЛЬКО с границами слов (`\b(телеграм|telegram|бот|бота|chat-?bot)\b`): подстрочный матч даёт ложные срабатывания из «работа» (содержит «бота») и «робот» (содержит «бот») — срез выглядел как «2 релевантных», реально 0.
- Скоринг: `browser-automation/out/niche_score.py` (ключевые слова → в_ленте/медиана/покрытие → `out/niche_score.json` + markdown-досье `C:/sites/joblock/niche-candidates.md`).
- Правильные URL искать через CDP-разведку DOM (пробные ts-скрипты `wz-probe-*.ts`: dump `document.body.innerText` + href меню), не угадывать пути.

## Мониторинг потока (подтверждение порога 5/день)
- Watchdog-паттерн cron: скрипт (`out/tgbot_watch.py` → копия в `~/AppData/Local/hermes/scripts/`) с dedupe-файлом (id виденных заказов), выводит строки ТОЛЬКО на новые релевантные заказы; cron `no_agent: true, schedule: every 2h, deliver: telegram` — пустой stdout ничего не доставляет (без спама в чат).
- Путь скрипта для cron ОБЯЗАН быть относительным к `hermes/scripts/` (filename only) — абсолютный путь cron-менеджер отклоняет.

## Хром
- Chrome без CDP (netstat :9222 пуст) — запускать фоново: `chrome.exe --user-data-dir=C:/chrome-profile --remote-debugging-port=9222 --window-size=1400,900` (background). `bun serve.ts` в неинтерактивной shell умирает на stdin EOF — headless через него не запускать.
- Владелец видит это окно — ок; невидимые сессии ему не подходят.

## Ремонт Dagi (:8791) — блокер постановки
- Живость проверять `GET /api/health` с `Authorization: Bearer <DAGI_WEB_TOKEN из jobsy/.env>` → `{"healthy": true}`. `GET /` с 500 «sandbox request failed» — НЕ показатель: catch-all `core/web.py` глотает трейсбек (добавить `traceback.print_exc` в `except Exception:` do_GET/do_POST и перезапустить), а 500 на `/` бывает чисто косметикой (отсутствие UI-пакета `dagi_core`, API при этом жив).
- Реальные причины: `ModuleNotFoundError: openai` в .hermes-runtime python → `<runtime-python> -m pip install --break-system-packages openai` (PEP 668; синк зависимостей может снова вычистить — после любого апдейта Hermes проверять Dagi первым). Потеря шаблонов jobsy-агентов (`no Dagi template for agent <slug>`) → `python C:/Users/Administrator/jobsy/seed_dagi_templates.py` (upsert copywriter/developer/seo-site-text из templates/*.yaml; factory seed их НЕ умеет).
- Запуск: `cd jobsy && <hermes .hermes-runtime python> run_dagi_web.py > dagi-web.log 2>&1` (фон; venv-python не подходит). Прогон заказа: `POST /api/orders` (slug/title/description) → `POST /api/orders/<number>/start` — синхронный, минуты.

## Portal ops (смежное, кратко)
- Портал :8701 автостартится Scheduled Task «JobLock-Portal» → `portal/run_portal_task.cmd` (venv-python в cmd прописан явно — системный python без pymysql падает на импорте); `launch_portal.bat` только делегирует `schtasks /Run`. Перезапуск после правки app.py: убить python-процессы с `app.py` в cmdline → `schtasks /Run /TN "JobLock-Portal"`.
- Фоновый цикл актуализации статусов в app.py (refresh_all.главная() раз в 3 мин) требует живого Chrome CDP :9222 для bun-коллекторов — при выключенном Chrome цикл мягко деградирует (ok:false), не падает.
- Песочный заказ для проверки агента: `POST /api/orders` (jobsy :8000, slug/title/description) → `POST /api/orders/<number>/start` — синхронно, минуты; артефакты в `C:/var/lib/jobsy/data/workspace/sessions/<id>/`. Проверенный прогон: бот записи на приём (aiogram 3, FSM, SQLite) — done за ~90 с.

## Питфолы
- Dagi :8791 может отдавать `sandbox request failed` при живом санбоксе :8788 — диагностировать по процедуре «Ремонт Dagi», песочницу через jobsy не начинать до `{"healthy": true}`.
- Кириллические POST из git-bash — только через UTF-8 файл (`--data-binary @file`), не argv.
- Портал без hot-reload: после правки app.py убить процессы и `schtasks /Run /TN "JobLock-Portal"` (процедура в skill `joblock-monitoring`).
- Если владелец не подтвердил песочницу — ворота 3 не закрыт, живые заказы не брать.
