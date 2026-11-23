# Выпуск шаблона из выполненного заказа

Механизм превращения отработанного заказа в переиспользуемый профиль-шаблон.
Модули: `portal/session_distill.py` (сессия → дистиллят) и
`portal/profile_graduation.py` (дистиллят → профиль Hermes + реестр).

## Контракты

`session_distill`
- `find_session(topic_id) -> str` — id сессии по номеру топика. База сессий —
  `state.db` АКТИВНОГО ШЛЮЗА (`profiles/slug/state.db` на этой машине), не
  профиля заказа. Ключ `agent:main:telegram:group:<chat>:<topic_id>`.
- `transcript(session_id) -> [(role, content, tool_name), …]` — сообщения по порядку,
  только чтение (`file:...?mode=ro`).
- `has_work(rows) -> bool` — есть ли хоть один непустой ответ ассистента.
- `transcript_text(rows) -> str` — диалог + имена инструментов со счётчиками.
  Секреты → `[REDACTED]`; вывод инструментов не включается (только имя и первые
  ~200 символов как маркер).
- `distill(text, order) -> dict` — `{ok, skill:{name,description,body,kind},
  memory:[…], keywords, kind}`. `ok:false` + причина, если модель вернула
  `НЕТ-ПОВТОРЯЕМОЙ-РАБОТЫ`.
- `skill_slug(name) -> str` — латиница, ≤48, `^[a-z][a-z0-9-]*$`.

`profile_graduation`
- `KINDS = ("design","text","dev","browser","retouch","seo","manager")`.
- `ProfileFacade(create_runner=None, existing=None, profile_root=None)` —
  `create_from(source, name)` и `graduate(order_profile, *, template_name,
  chat_id, user_id, transcript_rows=None, session_id=None)`.
- `graduate()` порядок: проверка владельца → санитизация имени → проверка,
  что шаблона с таким именем нет → чтение сессии → `distill` →
  `hermes profile create <name> --clone-all --clone-from <ord-…> --no-alias` →
  `_clean_history` (`sessions/`, `plans/`, `pending_messages/`) →
  `write_skill` → `write_memory` → `register_template`.
- `write_skill(profile_dir, skill)` → `<profile>/skills/<slug>/SKILL.md` с
  frontmatter `name`/`description` и телом процедуры.
- `write_memory(profile_dir, memory, order)` → `memories/MEMORY.md`: только ОБЩИЕ
  факты + раздел «Правила шаблона» (не переносить номер заказа/заказчика/ссылки).
- `register_template({name,kind,keywords,skill,origin,from_profile})` →
  `portal/order_templates.json` (список; перезапись атомарная).
- `match_template(title, description) -> str` — сравнение ОСНОВ слов, не вхождений.

`start_order.pick_template(title, description)` сначала спрашивает
`profile_graduation.match_template`, и только потом идёт по статическим
`_TEMPLATE_HINTS`. Это ФОЛБЭК для неинтерактивных вызовов. Интерактивный путь
владельца — ручной выбор в Telegram, автоподбор там не участвует.

## Ручной выбор шаблона в Telegram

`templates_catalog.catalog_items()` отдаёт список для кнопок: `icon`, `color`,
`bg`, `kind_label` (по таблице `KINDS`, тип `video` — 🎬), `skills`,
`portfolio`, `orders`, `description`, `search`, `model`. В каталог попадают все
шаблоны кроме `retired`.

Поток callback'ов:
- `take:<pk>` → `tg_bot._меню_шаблонов(order)`: текст «🎯 Шаблон под заказ» +
  кнопки `takes:<pk>:<template>` (иконка, название, `· 🧩N`) + «⬅️ Назад» (`order:<pk>`).
- `takes:<pk>:<template>` → `_starter.dispatch(order, template=<выбранный>, ...)`.

Кнопки каталога в самом Telegram ограничены (до ~12 штук) — если шаблонов
больше, добавлять «Ещё…»/пагинацию, а не вываливать 40 рядов.

## Поиск по каталогу (веб-модалка, если она есть)

`templates_catalog._search_text(row)` собирает `title + description + keywords +
первые 60 непустых строк knowledge_md` и режет до ~1200 символов. Без MD
поиск не находит шаблон по слову, которого нет в коротком описании
(«шортс» при описании «Монтаж вертикальных роликов 9:16…»).

## Хранение сессии в БД

`profile_sessions` — одна строка на `(template_id, session_key)`, внутри
`transcript` (MEDIUMTEXT) + `meta_json`; `profile_session_messages` —
сообщения (`session_id, idx, role, tool_name, content`). Запись идёт
UPDATE-then-INSERT, сообщения перед вставкой удаляются целиком — иначе
повторный разбор той же сессии удваивает историю в базе.

## Кнопка

`tg_bot._кнопки_заказа` добавляет `graduate:<market_projects.id>` рядом с
«Создать профиль заказа». Обработчик `graduate:` → `graduation_command(order,
чат, user_id)`: только владелец в `ORDER_CHAT_ID`, дальше
`_start_profile_input(..., action='grad_name', source=<pk>)`. Ответ владельца
ловится в обработчике ForceReply (`action=='grad_name'`): имя шаблона →
`order_profiles.get(source, external_id)` → `profile_graduation.ProfileFacade().graduate(...)`.

## Смоук (без него выпуск не считать готовым)

```
PYTHONPATH=. python -c "import session_distill as sd; sid=sd.find_session(<topic>); \
  rows=sd.transcript(sid); print(len(rows), sd.has_work(rows), len(sd.transcript_text(rows)))"
PYTHONPATH=. python -c "import session_distill as sd; \
  print(sd.distill(sd.transcript_text(sd.transcript(sd.find_session(<topic>))),
        {'title':'…','description':'…'}))"
PYTHONPATH=. python -c "import profile_graduation as pg; \
  print(pg.ProfileFacade().graduate({...}, template_name='<slug>', chat_id=pg.ORDER_CHAT_ID, user_id=pg.OWNER_ID))"
ls <profile_root>/<slug>/skills/*/SKILL.md   # скилл на месте
ls <profile_root>/<slug>/sessions 2>&1       # истории быть НЕ должно
PYTHONPATH=. python -c "import profile_graduation as pg, start_order; \
  print(pg.match_template('<фраза из заказа>',''), start_order.pick_template('<фраза>',''))"
```

Юнит-тесты с мок-моделью не ловят: мусорный JSON в ответе, пустую сессию,
отсутствующий скилл в профиле. Дистилляция стоит один вызов модели (~минуту).
