# Учёт токенов + доступы в группе

## Установка (извне, по SSH)
```
sudo /opt/hermes-usage-footer/scripts/install.sh --user main
```

## 1. Доступы в группе
`config.yaml`:
```
gateway:
  allow_all_users: true
```
Ставит `install.sh`. Проверка — строка в логе при старте шлюза:
```
config.yaml allow_all_users: true grants every sender on every platform access
```

## 2. Учёт токенов в конце сообщения
Плагин `token-usage-footer`. В каждом ответе — одна строка:
```
⚙️ IN=15603|OUT=17|CACHE_R=0|CACHE_W=0|THINK=14|CALLS=1|MS=2496|USD=0.006888|MODEL=deepseek/deepseek-v4-flash-0731|SESS=20261022_093640_03e6a1|TURN=…|
```

| Поле | Значение |
|---|---|
| `IN` / `OUT` | вход / выход, токены |
| `CACHE_R` / `CACHE_W` | чтение / запись кэша промпта |
| `THINK` | reasoning-токены |
| `CALLS` | вызовов API за ход |
| `MS` | длительность хода, мс |
| `USD` | стоимость, 6 знаков (пусто на free-моделях) |
| `MODEL` / `SESS` / `TURN` | модель, id сессии, id хода |

JSONL по ходу на строку: `/home/main/.hermes/plugins/token-usage-footer/usage.jsonl`

Разбор в базу:
```
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --json    # массив
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --csv     # CSV
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --sql     # INSERT'ы
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --totals  # суммы по модели
```

## Перезапуск
Отправь **`/restart`** в чате. Дренирует активные ходы и поднимается сам.

## Проверка
```
grep "stamped turn" /home/main/.hermes/logs/agent.log | tail -1
tail -1 /home/main/.hermes/plugins/token-usage-footer/usage.jsonl
```

## Важно
- Правки плагина применяются только после перезапуска.
- Строка ставится только на финальный ответ хода; прогресс и вызовы инструментов — без неё.
- На кэш промпта не влияет: строка дописывается после цикла, модель её не видит.
- `USD` — оценка, не биллинг.
- Из агента внутри шлюза перезапуск шеллом заблокирован. Агенту — только `/restart`.

## На другой сервер
```
scp hermes-usage-footer.tgz root@<host>:/opt/ && ssh root@<host> \
  'tar xzf /opt/hermes-usage-footer.tgz -C /opt && /opt/hermes-usage-footer/scripts/install.sh --user main'
```
