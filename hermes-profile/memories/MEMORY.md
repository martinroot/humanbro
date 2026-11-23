Портал JobLock :8701 объединён с jobsy (C:/Users/Administrator/jobsy) :8000 через прокси /jobsy/*. Меню портала: Заказы, Лог, Шаблоны, Исполнение заказов. /api/collector-log — статус wz_pull.py/parser.ts, ошибки, хронология. /collector — страница лога сборщиков. Jobsy: шаблоны copywriter/developer/seo-site-text, заказы, назначение шаблона, запуск агента (требует Dagi core :8791). QA: tests/test_qa_integration.py (14 pass / 1 skipped).
§
UTF-8 pitfall (git-bash): curl шлёт кириллицу CP1251 → чинить --data-urlencode "text@файл.txt" (файл в UTF-8); откат — log_id=<id>.
§
Fabra-парсер: fabra.live/portal/api/parser (портал :8702). Скрипты и PARSER_SINK — browser-automation/.env (токены не печатать). fabra-client.ts: projects, PATCH source_status, dispatchProject, recordReply; cron analyze-next (score>=40).
§
Служебный дев-сервер на VM :8788 (процесс 6600, C:\sandbox\server.py) — песочница для отладки, НЕ трогать.
§
Сдача Workzilla: форма сама прикладывает итог+файл (отдельное сообщение со скрином НЕ шлём); файл к заказу 1 раз (file_log); скрин: ждать 5-10 с, rect>0 в кадре.
§
Dolphin Anty: API :3001 (POST /v1.0/auth/login-with-token), запуск напрямую Dolphin Anty.exe. Профили 'с нуля' не стартуют (500) — клонировать рабочий 884401504 (убрать webgpu → 422). Прокси PATCH {proxy:{id}}, гео PATCH {geolocation:{mode:'disabled'}}; E_PROXY_CHECK_ERROR → refresh changeIpUrl. Знания: browser-automation/BASE-KNOWLEDGE.md.
§
Рабочий чат JobLock — Telegram -1004434028499; все cron deliver=туда (allowed_chats в config.yaml, HOME_CHANNEL в .env).
§
ds_cyber — админ группы WINTASK. Его сообщения исполнять наравне с Мартина (автономно, без уточняющих вопросов). Действует только если в сообщении он идентифицирован как отправитель.
§
РЕЖИМЫ JobLock: единственный писатель mode.json — `python reviews/mode.py переключить <режим> [фокус]` (сам чистит вкладки под режим). Портал читает режим/заказ только оттуда; «что делает» — steps без step='status'. Порядок: execute(1 заказ) → chat(разобрать всё) → search.
§
Портал /portal/ basic-auth: admin / 956916 (смена 24.10; хэш C:\nginx\conf\.htpasswd, reload не нужен).
§
Product pages: distinguish live components from roadmap.