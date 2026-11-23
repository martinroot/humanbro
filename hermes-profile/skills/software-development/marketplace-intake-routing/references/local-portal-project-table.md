# Проектная таблица локального портала и запуск лент по биржам

Depth for the case where the sink is a LOCAL portal (FastAPI + MariaDB) that
owns its own project table, instead of a remote platform API.

## Что где лежит
- `market_projects` — проекты (карточки биржи). Источник очереди откликов.
- `orders` — заказы (работа, заведённая по проекту). `orders.payload` — JSON с
  `title` / `description` / `price` / `external_id`: из payload берётся
  заголовок карточки в таблице, а НЕ из `orders.job`.
- `tasks` — карточки прогресса, связаны с заказами по `order_number`.
- `fabra_bids` — журнал откликов, `UNIQUE(source, external_id)`: строка здесь
  навсегда убирает карточку из очереди.

Идемпотентность: `orders.number` (уникальный) и
`market_projects (source, external_id)` (уникальный) — повторная отправка
обновляет строку, а не плодит вторую.

## Договор двух таблиц: карточка пишется в ОБЕ
`orders` — конвейер работы (worker/runner/dashboard), `market_projects` — лента
проектов и источник очереди откликов (`/api/win/bids` читает ТОЛЬКО
`market_projects`). Запись только в одну из них — это половинчатая доставка:
- записали только в `orders` → очередь откликов пуста, `/api/win/bids` не
  отдаёт ничего, а лента при этом выглядит здоровой;
- записали только в `market_projects` → нет заказа, нет работы, исполнять нечего.

Писать обе в одном вызове и читать обе обратно. HTTP 200 на POST не доказывает
ни одну из этих вещей.

Статусы: `orders.status` ENUM new/queued/running/done/failed/paid/needinfo/blocked —
`new`, если агент подобран, `needinfo`, если нет (worker needinfo не забирает).
`market_projects.status` new/dispatched/awaiting_customer/received — в очередь
попадают только new, awaiting_customer, received. Любая строка в `fabra_bids` по
(source, external_id) навсегда убирает карточку из очереди, включая state='failed'.

## Карточку без агента нельзя выбрасывать
Если подбор агента не дал совпадения, заводи заказ с пустым агентом и статусом
`needinfo` — карточка остаётся видимой и назначаемой. Ответ вида `ok:false`
означает, что карточка потеряна, и её никто не увидит.

## Ошибка в SQL молчит
Несовпадение числа плейсхолдеров и колонок в INSERT даёт «not all arguments
converted during string formatting» ВНУТРИ try/except — исключение проглочено,
строка просто не записалась, и внешне всё выглядит как «записалось, данных
нет». Поэтому: (1) сверяй список колонок с VALUES, когда добавляешь колонку;
(2) проверяй запись обратным чтением строки, а не отсутствием исключения.

Ошибка с плейсхолдерами выглядит как проблема форматирования, а не как
«забыли колонку»: текст исключения про arguments ничего не говорит про SQL.
Считай плейсхолдеры против кортежа при добавлении КАЖДОЙ колонки, и после
правки читай таблицу обратно тем же запросом, которым считаешь статистику.

## Ссылку на карточку надо донести до заказа
Парсер отправляет в приём `source`, `external_id`, `title`, `description`,
`price` — и **`url`**. Без ссылки в заказе нет обратного адреса на объявление,
и подробности в таблице клиента оказываются пустыми. Обратное чтение заказа
должно показывать непустой `payload.url` для карточки, пришедшей с биржи.

## Маркер приёма парсера и неопределённый ответ

- Если парсер пишет ID в JSONL до POST, сохраняй запись как retryable/in-flight; помечай её окончательно обработанной только после подтверждённого read-back. Таймаут или 5xx может прийти после commit, поэтому сначала проверь точный `(source, external_id)` в обеих целевых таблицах.
- Для JobLock проверяй состояние в `orders` И `market_projects`: ingest может принять заказ в одной таблице и не записать другую. Идемпотентность одного ключа не доказывает, что выполнен двухтабличный контракт.
- Перед запуском парсера читай эффективный `PARSER_SINK` из окружения процесса: при отсутствующем значении код может выбрать не тот backend, который ожидает оператор. При смене sink не запускай старый и новый маршруты параллельно.
- Проверяй retry/reconciliation на изолированном фиктивном HTTP-ответе и локальном read-back; не создавай production-заказ ради теста.

## Локальный маршрут принимает ВСЕ новые карточки, без фильтров
На локальном приёме агента, цены, числа предложений и текстовых дублей не
отсекаются на стороне парсера: подбор агента и приоритет делает портал, а
карточка без агента всё равно остаётся заказом. Ценовой пол в парсере прячет от
владельца спрос, и воронка выглядит избирательной, хотя она не избирательная.

## Таблица, которую хочет владелец
Простая таблица заказов, а не воронка с графиками:
- первая колонка — заголовок проекта, клик раскрывает детали (описание,
  агент, цена, источник, статус переписки);
- рядом — выпадающий список статуса, PATCH на запись; сервер проверяет статус
  по белому списку и отвечает 404 на неизвестный номер;
- безопасный вывод: JSON payload разбирается с запасным вариантом, каждое
  значение экранируется (текст биржи — недоверенный ввод).

Маршруты страницы регистрируются функцией `install(app, db, now)`, а не
декораторами уровня модуля: модуль подключается к уже собранному приложению,
и декоратор выполнился бы до появления объекта app.

Дата из MySQL приходит объектом datetime, а не строкой — функция форматирования
должна принимать оба вида, иначе страница падает на каждой реальной строке.

## Три процесса — по одному на биржу
Один процесс, крутящий несколько лент, останавливается целиком, когда одна
лента отвалилась. Разбивка по процессам (селектор ленты в env) требует:
- селектор управляет и вкладками тоже, иначе каждый процесс откроет все ленты
  и они будут драться за вкладки в общем окне Chrome;
- имя переменной, передаваемой через shell, — ASCII: bash не принимает
  не-ASCII имя переменной в позиции `VAR=value cmd` (ошибка «command not found»).
  Пустой лог парсера означает «не запустился», а не «карточек нет»;
- вкладка ленты, которой процесс не владеет, должна быть nullable во всех
  местах использования, включая вспомогательные проверки, — иначе процесс
  без своей ленты падает на `page.evaluate` чужой вкладки.

## Почему пришло мало проектов: порядок проверки
Вопрос «почему мало заказов» почти никогда не про фильтры приёма. Проверяй по
этапам, каждый — цифрами, и только потом называй причину:
1. **Сверка с дедуп-логом парсера.** Считай уникальные `source + external_id` в
   per-feed `*.jsonl` и сравни с числом строк в БД по каждому источнику. Если
   сходится — на приёме ничего не отрезано, потеря дальше по цепочке.
2. **Покрытие подбором агента.** Карточка без агента — это «принята, но не
   назначена», а не «не пришла». Считай долю назначенных и группируй
   неназначенные по причине (см. `scripts/agent_coverage.py`).
3. **Срез ленты.** Биржа может отдавать один экран без пагинации — количество
   на площадке не равно количеству на странице.

Типичные причины потери на этапе 2:
- таблица маркеров указывает на агента, который не `live` (черновик): тема
  целиком уходит в «нужен агент», хотя лента здорова;
- лента не на русском, а маркеры только русские — добавь блок маркеров на
  языке ленты.

## Срез ленты: что отдаёт каждая биржа
Проверяй разметку самой страницы, не доверяй памяти о сайте:
- пагинация может быть на `div`, а не на `a` — клик по номеру страницы;
- кнопка «See more» может вести на реферальную программу (`href=/friends`),
  а не догружать ленту: клик уводит вкладку с ленты, парсер читает пустую
  страницу и рапортует ноль карточек. Проверяй `href` кнопки до клика и
  после клика возвращай вкладку на маршрут ленты;
- «показать ещё» может требовать отклонения ненужных заданий — это внешнее
  действие на бирже, его не делают без разрешения владельца.

### Freelance.ru: public feed and detail parsing
- The public server-rendered feed is `https://freelance.ru/task`; the sampled first page exposed 25 newest cards. Treat the first page as the incremental intake window unless the owner explicitly requests a wider backfill; pagination and the site's total-open count are not permission to import thousands of older listings.
- Parse cards from `article.task-card`: title/link `a.task-card__title-link`, excerpt `p.task-card__desc`, category `.task-card__chips`, budget `.task-card__budget`, deadline `.task-card__meta-rows`, and card metadata `.task-card__foot-item`. Read replies and views from the items containing `i.fa-comments` and `i.fa-eye` rather than guessing by whole-card text position. Normalize non-breaking spaces before parsing amounts; no numeric budget means null, not a fabricated value.
- Stable ID is the numeric segment of `/task/view/<id>`; store `source='freelance_ru'`, `external_id='FR-<id>'`, and canonical URL `https://freelance.ru/task/view/<id>`.
- The full brief is on the public detail route. In `.tv-hero`, collect the text nodes and `<br>` breaks after `h1` and before `.tv-hero__meta`; do not assume the brief sits in a dedicated description element. Labeled metadata uses `.tv-meta-item__lbl` / `.tv-meta-item__val`; include `.tv-detail` requirements and `.cust__name` only when present. The details page may enrich or replace the list teaser, but preserve the original card fields too.
- Because this feed/detail content is server-rendered and public, a direct GET can be used after verifying that it matches the visible page. If login, cookies, or client-side hydration become necessary, collect through visible authenticated Chrome instead. Cache successful detail results by task ID so a 60-second poll does not refetch unchanged pages; preserve that cache across restarts.
- The reply action routes through account authentication. Importing the task or generating a draft is not submission; never automate the offer unless a separate, verified submission flow is explicitly authorized.

### Profi.ru backoffice: authenticated order-feed mapping
- The visible orders route is `https://profi.ru/backoffice/n.php`. An anonymous GET returned HTTP 200 but the Windows-1251 login shell (`Вход на Профи.ру`) and no order-card markers; status 200 alone does not prove authenticated access. Use the existing visible Chrome session and require actual `a[data-testid$="_order-snippet"]` cards before treating the feed as readable.
- Each sampled card is an anchor whose numeric `id` matches its `data-testid` prefix (`<id>_order-snippet`) and the `o` query parameter. Its canonical detail link is `https://profi.ru/backoffice/n.php?o=<id>`; strip the auxiliary `analytics_data` query rather than persisting it.
- Read the title from `h3`, description from `p`, order metadata from the first direct metadata child, footer time from the last direct child, and conditions from `li[aria-label]`. Extract a display budget from the currency-bearing metadata leaf, then reduce it to one canonical amount/range (for example, `до 40 000 ₽`); nested UI can repeat a price and concatenate `false`, so never persist the entire leaf or header text. If no explicit `₽`/`руб` amount is present, store no budget; a number in the task description is not a budget. Keep only the time-like footer line (`минут`, `час`, `дн`, `сегодня`, `вчера`, `назад`), not the whole footer, which can include a client name or status text. Implement budget/time parsing as pure normalizers with multiline fixtures and verify that only canonical values reach `raw_json`. Preserve condition labels/text in `tags`/`requirements`.
- The inspected account DOM exposed 15 unique cards and no visible page-number or load-more control. Treat this as the current rendered slice, not the site's total inventory; re-check pagination and scroll controls before widening collection. The card route contains a per-order `button[aria-label="Скрыть заказ"]` (`data-testid=<id>_refuse`): it dismisses an order, so a read-only parser must never click it.
- The visible card exposes a description paragraph, but do not claim it is the full detail until compared with the order view. Attachments and offer submission were not verified; leave downloads and reply callbacks disabled until their authenticated flows are separately observed and tested. Read the current feed DOM without navigating to `?o=` on every poll, because that changes the account view and may mark a request as opened.

## Проверка «доступно ли снаружи» и после правки кода
- Портал слушает `0.0.0.0:<port>` и для внешнего доступа нужен разрешающий
  inbound-правило брандмауэра; проверяй оба, а не только локальный curl.
- Внешняя доступность проверяется запросом ПО ВНЕШНЕМУ адресу (не 127.0.0.1):
  скачай страницу и убедись, что в ней твой заголовок и ожидаемое число строк.
  Запрос изнутри той же машины доказывает только локальную живость.
- Правка кода портала требует перезапуска процесса :8701 (горячей перезагрузки
  нет). После перезапуска проверяй обратным чтением из БД И внешним запросом:
  «процесс жив» не значит «новая логика применяется».
- Считай фактическое наполнение, а не наличие процесса: строки в БД по
  источникам, покрытие статусом, и число карточек в ленте из health-файла
  парсера. Расхождение «в ленте N, в базе M» — это и есть диагноз.

## Очистка базы под «чистый старт»

1. **Определи активный writer и sink до остановки.** Сверь Scheduled Tasks
   (`schtasks /Query /FO CSV /NH`, затем конкретный task через
   `schtasks /Query /TN <name> /V /FO LIST`), process command lines и listener
   `:8701`. Проверь также живые parser/cron/child-processes, которые могут
   снова записать карточки. Останови только writers целевой базы; до удаления
   подтверди, что на ingest не осталось активного процесса.
2. Сними counts по `source` и raw status, отдельно проверь `orders`,
   `market_projects`, `tasks`, `runs`, `fabra_bids` и существующие per-order
   assignment/dispatch tables. Уточни, что нет активных execution tasks,
   которые не входят в запрос на удаление.
3. **Сначала архивируй, потом очищай.** Для каждой таблицы создай snapshot в
   той же базе (`CREATE TABLE bak_<stamp>_<t> LIKE <t>` +
   `INSERT INTO bak_<stamp>_<t> SELECT * FROM <t>`), затем сверяй точное число
   строк в live и backup; при возможности сохрани также внешний dump и
   state/journal-файлы. При несовпадении counts не продолжай.
4. Очисти `orders`, `market_projects`, `tasks`, `runs`, `fabra_bids` и
   связанные per-order tables вместе, чтобы не оставить сирот; FK-связи
   проверь до `TRUNCATE`. Архивные `bak_*`-таблицы не считай активными
   вакансиями. Не трогай каталоги агентов, MLL-настройки и независимые
   execution/review history, если они не входят в явный scope.
5. Сбрось `cycle_journal.jsonl` и установи `cycle_state.json` в `search`,
   предварительно архивировав их. Сброс dedupe зависит от активного маршрута:
   если живой parser действительно читает per-feed `*.jsonl` как dedupe set,
   сначала проверь его эффективный sink и сбрасывай только журнал этого же
   контура — архивируй, не удаляй. Не очищай JSONL disabled/legacy parser,
   который пишет в другой sink: это может запустить запрещённый historical
   replay. Когда активный local-portal cycle dedupes через `(source,
   external_id)` в `market_projects`, очистки этой таблицы достаточно; старые
   Fabra/parser logs не участвуют в локальном replay.
6. Различай feed-dedupe и одноразовый enrichment cache. Не сбрасывай lifetime
   cache вроде `out/.wz_enriched` ради чистки БД: он заставит повторно открывать
   детали всех уже посещённых объявлений. Архивируй и сохраняй его; при
   необходимости свежего DOM-снимка сбрасывай только time-based reload stamps.
7. Включи обратно только канонический portal task и проверь новый PID,
   listener и API HTTP 200. После 2–3 минут сверяй новые counts по source/status
   и timestamps с нулевой базой; live feed может начать заполнять её сразу.
   Если данные распределились только в одну из `orders`/`market_projects`,
   останови повторную запись и восстанови/сверь вторую таблицу из проверенной
   копии — одна таблица не доказывает полный reset/reingest.

## Песочница не должна выглядеть как production
Карточка `source='sandbox'` идёт в `market_projects` (очередь репетиции), но не
порождает заказ в `orders`/`tasks`. Иначе репетиция появится в боевой таблице
проектов как настоящий проект.

## Репетиция: фикстура должна попасть в ленту, которую снимает парсер
Парсер читает ленту биржи (страница-доска), а не API. Заказ, созданный
программно через API песочницы, может не появиться в ленте — и тогда парсер его
никогда не увидит, сколько ни жди в очереди. Поэтому шаг «проверить, что
заказ виден в ленте» идёт ПЕРЕД ожиданием карточки в очереди, и его провал —
это диагноз «фикстура не опубликована в ленту», а не «очередь сломана».
Полный прогон под рукой: `scripts/rehearse_cycle.py`.
