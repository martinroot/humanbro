---
name: joblock-bidloop-heal
description: Use when JobLock bid-loop smoke feed errors. Heal parser.
---

# JobLock bid-loop heal

Сторож контура JobLock/Fabra. Main tool: `python smoke_bid_cycle.py` (cwd `C:/Users/Administrator/browser-automation`). Exit 0 = green, 1 = problems.

## Питфолл: ленты «Target page, context or browser has been closed»

Симптом: одна или ВСЕ ленты падают с "Target page, context or browser has been closed" (evaluate/reload). Услуги при этом 200 (sandbox/portal/cdp), процессы на месте.

Корень: `keeper.ts` перезапускает parser ТОЛЬКО если процесс отсутствует (`processes.includes("parser.ts")`). Но `closeInactiveTabs` (вызов из keeper раз в 60с) закрывает вкладки/контекст парсера, при этом процесс bun parser.ts живёт. Парсер выглядит здоровым для keeper, а все его CDP-ленты мертвы.

Фикс в ОДИН шаг — убить парсер, keeper сам поднимет свежий (ре-аквайр вкладок):
```
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'bun.exe' -and \$_.CommandLine -like '*parser.ts*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```
Затем подождать 60с на перезапуск, прогнать smoke. Восстановление лент не мгновенное: часть вкладок ре-апенится за один проход, может потребоваться 2-й прогон через ~40-60с. Бывает дублирующий parser.ts (2 инстанса) — оба бьются сразу.

симптом: очередь пуста (`очередь: 0 из ...`) каждый тик, карточки в market_projects есть (status='new', analysis вердикт yes), но в fabra_bids скапливается state='failed'.

Корень: Windows-таск FabraBidSender раз в ~20 мин гоняет bid-sender.ts против ЛОКАЛЬНОГО портала (fabraBaseUrl=http://127.0.0.1:8701). Для source=sandbox bid-sender постил bid-failed: win_bid_failed кладёт строку в fabra_bids, а очередь отдаёт только карточки БЕЗ строки (NOT EXISTS). Один ретрай — карточка навсегда спрятана от смоука.

Фикс: в bid-sender.ts ветка БЕЗ_ФОРМЫ (sandbox/wallet/avito/test) теперь просто `continue` без POST bid-failed — карта остаётся в очереди для смоука. Старые блокирующие `DELETE FROM fabra_bids WHERE state='failed'` (только после того, как bid-sender перестал их плодить, иначе вернутся).

## Не путать
- `failed: N` в сводке бид-записей — это НЕ проблема, smoke её не считает ошибкой.
- ЗАКАЗЫ в needinfo (живые биржи) — НЕ двигать без прямого приказа по конкретному ID. Наружу отклики только тестовые (FABRA_BID_MODE=test), песочница (source='sandbox') свободно.
- Не печатать FABRA_PARSER_TOKEN и т.п.; не подтверждать результат, который не проверил.
