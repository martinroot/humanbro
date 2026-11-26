# Учёт токенов в каждом сообщении шлюза Hermes

Пакет ставит **футер с расходом токенов в конец каждого ответа** мессенджер-агента и **JSONL-сайдкар** для загрузки в БД. Плюс открывает доступ всем пользователям в группах.

## Установка (одна команда)

```bash
sudo /opt/hermes-usage-footer/scripts/install.sh --user main
```

Скрипт идемпотентный — можно запускать повторно. Что делает:

1. кладёт плагин в `<HERMES_HOME>/plugins/token-usage-footer/`
2. правит `config.yaml` (с бэкапом): `plugins.enabled += token-usage-footer`, `gateway.allow_all_users: true`, `display.runtime_footer.enabled: false`
3. валидирует плагин (`hermes plugins doctor`)
4. перезапускает `hermes-gateway.service`
5. печатает статус шлюза и путь к JSONL

Флаги: `--user <имя>` (профиль), `--home <HERMES_HOME>`, `--no-open-all`, `--no-footer`.

## Что появляется в сообщении

Одна строка в конце, `KEY=VALUE` через `|`, сырые числа, в конце `|`:

```
⚙️ IN=15556|OUT=9|CACHE_R=0|CACHE_W=0|THINK=6|CALLS=1|MS=2640|USD=0.006857|MODEL=deepseek/deepseek-v4-flash-0731|SESS=20261022_090341_6dfdd1|TURN=20261022_090341_6dfdd1:dddb9575-…|
```

| Поле | Что это |
|---|---|
| `IN` | некэшированный вход, токены |
| `OUT` | выход, токены |
| `CACHE_R` / `CACHE_W` | чтение / запись кэша промпта |
| `THINK` | reasoning-токены |
| `CALLS` | число вызовов API в ходе |
| `MS` | длительность хода, мс |
| `USD` | оценка стоимости, 6 знаков (пусто, если тарифа нет) |
| `MODEL` | модель |
| `SESS` / `TURN` | id сессии и хода |

## JSONL для базы (рекомендуется)

`<HERMES_HOME>/plugins/token-usage-footer/usage.jsonl` — по объекту на ход, дописывается автоматически:

```json
{"ts": 1792659825, "session_id": "20261022_090341_6dfdd1", "turn_id": "…", "model": "deepseek/deepseek-v4-flash-0731", "provider": "openrouter", "in": 15556, "out": 9, "cache_read": 0, "cache_write": 0, "reasoning": 6, "calls": 1, "usd": "0.006857"}
```

Разбор:

```bash
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --json          # массив
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --csv           # CSV
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --sql           # INSERT'ы
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --totals        # суммы по модели
python3 /opt/hermes-usage-footer/scripts/parse_usage.py --since 2026-10-22
```

Парсер строки из сообщения, если тянешь из мессенджера:

```python
import re
def parse_footer(text):
    m = re.search(r'⚙️\s*(.+)$', text, re.M)
    return dict(p.split('=', 1) for p in m.group(1).split('|') if '=' in p) if m else {}
```

## Проверка

```bash
sudo -u main env HOME=/home/main HERMES_HOME=/home/main/.hermes \
  /home/main/.hermes/hermes-agent/venv/bin/hermes plugins doctor \
  /home/main/.hermes/plugins/token-usage-footer
# ожидаем: OK: runtime discovery, manifest parsing, import, and registration passed
#          registrations: 0 tool(s), 2 hook(s)

grep "stamped turn" /home/main/.hermes/logs/agent.log | tail -1
tail -1 /home/main/.hermes/plugins/token-usage-footer/usage.jsonl
```

Быстрый тест без мессенджера (одноразовый агентский ход, футер форсируется на CLI):

```bash
sudo -u main env HOME=/home/main HERMES_HOME=/home/main/.hermes \
  HERMES_TOKEN_USAGE_FOOTER_ALL=1 \
  /home/main/.hermes/hermes-agent/venv/bin/hermes -z "Ответь одним словом: ок"
```

## Перезапуск шлюза (важно)

Плагин читается только при старте шлюза, поэтому после правки кода нужен перезапуск. Три штатных пути:

| Способ | Откуда | Что делает |
|---|---|---|
| команда `/restart` в чате | бот | дренирует активные ходы (до 30 мин), затем перезапуск. Дубликаты от Telegram распознаёт — цикла нет |
| сигнал `USR1` процессу шлюза | шелл снаружи | то же самое; в systemd-юните это `ExecReload` |
| control socket, глагол `pause-for-update` | апдейтер | дренирует и выходит, служба поднимает заново |

Служба поднимает процесс сама: `Restart=always`, `RestartSec=5`.

**Граница:** изнутри процесса шлюза перезапуск заблокирован — Hermes режет такие команды
(`tools/code_execution_tool.py`): «cannot restart or stop the gateway from inside the gateway process…
Run the lifecycle command from a shell outside the gateway». То есть **агент не может перезапустить свой шлюз
через шелл** — процесс убьёт сам себя на середине команды. Поэтому `install.sh` запускай **извне**
(root по SSH), а не из агента внутри шлюза. Агенту для этого доступна только команда `/restart` в чате.

## Важно

- **Плагин подхватывается только при старте шлюза.** Поменял код плагина → перезапусти `hermes-gateway.service`.
- Плагин пишет **только финальный ответ хода**; промежуточные сообщения прогресса и вызовы инструментов строки не получают.
- Плагин **не влияет на кэш промпта**: строка дописывается после цикла, модель её не видит.
- Стоимость — **оценка**, не биллинг. На бесплатных моделях `USD` пусто.
- `allow_all_users: true` открывает доступ **всем** пользователям, которые пишут боту, включая группы.

## Откат

```bash
sudo -u main env HOME=/home/main HERMES_HOME=/home/main/.hermes \
  /home/main/.hermes/hermes-agent/venv/bin/hermes config set display.runtime_footer.enabled true
# полное выключение:
sudo -u main env HOME=/home/main HERMES_HOME=/home/main/.hermes \
  /home/main/.hermes/hermes-agent/venv/bin/hermes plugins disable token-usage-footer
sudo systemctl restart 'user@1000.service'   # или перезапустить hermes-gateway.service
```

Конфиг можно вернуть из бэкапа: `config.yaml.bak-<дата>-<время>` рядом с `config.yaml`.

## Накат на другой сервер

```bash
tar czf hermes-usage-footer.tgz -C /opt hermes-usage-footer
scp hermes-usage-footer.tgz root@<host>:/opt/
ssh root@<host> 'tar xzf /opt/hermes-usage-footer.tgz -C /opt && \
  sudo /opt/hermes-usage-footer/scripts/install.sh --user main'
```
