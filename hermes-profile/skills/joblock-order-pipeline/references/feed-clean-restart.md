# Чистый перезапуск ленты заказов

Когда владелец говорит «удали все заказы, начнём с нуля» или включает/выключает биржи.
Порядок важен: сначала бэкап, потом очистка БД, потом настройки, потом ПЕРЕЗАПУСК парсера.

## 1. Бэкап до очистки

Если `mysqldump` недоступен, выгружай строки через pymysql в JSON — это рабочий
вариант, а не «бэкап на потом»:

```bash
cd C:/sites/joblock/portal
mkdir -p backups/joblock_before_full_reset_$(date +%Y%m%d_%H%M%S)
python - <<'PY'
import pymysql, json, glob
from pathlib import Path
c = pymysql.connect(host='127.0.0.1', user='root', password='',
                    database='joblock', charset='utf8mb4',
                    cursorclass=pymysql.cursors.DictCursor)
cur = c.cursor(); out = {}
for t in ('market_projects','orders','market_bid_drafts','order_profiles',
          'market_project_customers','marketplace_customers'):
    cur.execute(f"SELECT * FROM {t}"); out[t] = cur.fetchall()
c.close()
b = sorted(glob.glob('backups/joblock_before_full_reset_*'))[-1]
Path(b, 'full_data.json').write_text(json.dumps(out, ensure_ascii=False, default=str), encoding='utf-8')
print({k: len(v) for k, v in out.items()})
PY
```

## 2. Очистка таблиц

`market_projects` не даёт `TRUNCATE` — на него ссылается внешний ключ. Сначала
чисти дочерние таблицы, потом `DELETE` с отключённой проверкой ключей:

```python
cur.execute("SET FOREIGN_KEY_CHECKS=0")
cur.execute("DELETE FROM market_projects")
cur.execute("SET FOREIGN_KEY_CHECKS=1")
c.commit()
```

Чистить также: `orders`, `market_bid_drafts`, `order_profiles`, `profile_sessions`,
`chat_topics`, `hermes_order_assignments`, `market_project_customers`.
Сверь `SELECT COUNT(*) FROM market_projects` → 0.

## 3. Настройки бирж

Владелец может оставить только часть бирж. Источник истины — `mll_settings.json →
биржи`; адаптер `marketplace_adapter.active_markets()` читает его, hardcode списка
нельзя. Для каждой неактивной биржи поставить `false` и перевести её
`responses.<source>.mode` в `off`.

## 4. ПЕРЕЗАПУСК парсера (обязательно)

Старый процесс продолжает находить карточки и писать их в лог, но опустошённую
таблицу не наполняет. Убей все процессы с `parser.ts` в командной строке и
подними заново с явным списком рынков:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'parser.ts' -and \$_.CommandLine -notmatch 'Get-CimInstance' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

```bash
# terminal(background=true), каталог C:/Users/Administrator/browser-automation
PARSER_MARKETS=wz bun parser.ts > C:/Users/Administrator/AppData/Local/Temp/parser_clean_start.log 2>&1
```

Закрой в видимом Chrome вкладки отключённых бирж через `http://127.0.0.1:9222/json/close/<id>`
(авторизованную вкладку нужной биржи НЕ трогать).

## 5. Проверка

Через 25–35 секунд:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8701/api/unified-orders?state=all
# и PYTHONPATH=. python: SELECT COUNT(*), MAX(created_at), source FROM market_projects GROUP BY source
```

Ожидаемо: COUNT растёт, `source` только разрешённой биржи, `MAX(created_at)` —
сегодняшнее время, эндпоинты портала 200, тесты зелёные.

## Кнопка полной очистки воронки

На `/mll` оператору нужна одна кнопка без поля подтверждения: он явно просил
убрать дополнительные проверки. Кнопка вызывает POST `/api/mll2/db/reset`, НЕ
`/api/db/reset`: страничный JS строит путь с префиксом `/api/mll2`, nginx
добавляет `/portal`. Проверяй фактический URL из отрендеренной разметки, а не
только внутренний `:8701` — иначе curl зелёный, а в UI «Ошибка: не удалось».

`db_reset.py` перед удалением пишет JSON-бэкап таблиц в `portal/backups/`,
затем чистит только таблицы воронки (`market_projects`, `orders`,
`market_bid_drafts`, чаты/топики, сессии, тесты). `skill_catalog`, `skill_tags`,
`profile_templates`, `profile_skills` и настройки сохраняются — это фундамент,
а не воронка. Проверь `cleared` в ответе и нули в БД.

## Восстановление после очистки

Чтобы вернуть данные из `backups/funnel_before_reset_*.json`, прочитай JSON,
сразу перед вставкой снова очисти целевые таблицы и вставляй через
`INSERT IGNORE`: живой парсер может добавить строку между clears и restore.
Сверь количество и статусы поключевыми таблицами после вставки.

## Pitfalls

- **`app.DB` задаёт DictCursor глобально**: `conn.cursor()` возвращает строки-словари, поэтому `fetchone()[0]` даёт KeyError. Когда нужен индекс — `conn.cursor(pymysql.cursors.Cursor)`; иначе `COUNT(*) AS n` и доступ по ключу.
- **Удалённый DOM-элемент оставляет мёртвые ссылки в JS**: `inp.value=''` после успешного ответа кидает ReferenceError, и оператор видит «не удалось», хотя БД уже очищена. Удаляй все использования переменной и гони `node --check` на извлечённом из HTML скрипте.
- **Лог парсера — не доказательство ingest.** Строки «Workzilla …» в логе значат только, что карточки найдены. Истина — рост `COUNT(*)` в `market_projects`; проверяй её, а не процесс и не лог.
- **Парсер, запущенный до очистки, не перезаполняет таблицу.** После очистки таблицы всегда перезапускай процесс с явным `PARSER_MARKETS` — иначе лента останется пустой при живом логе.
- **Не чистить `profiles/` при очистке заказов.** Профили и шаблоны — отдельная сущность; удаление заказов не должно трогать `empty`, `video-shorts`, `pdf-edit-pro` или их скиллы.
- **Старые вкладки отключённых бирж мешают диагнозу.** CDP показывает их в списке и создаёт впечатление, что парсер ходит на все рынки, хотя `PARSER_MARKETS` уже сузил выборку.
