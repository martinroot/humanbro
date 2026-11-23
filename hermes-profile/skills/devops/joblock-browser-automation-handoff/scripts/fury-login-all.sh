#!/usr/bin/env bash
# Логиним активные Яндекс-аккаунты в профили Fury по одному, последовательно.
# Секреты не печатаем: yandex-login.ts берёт их из registry.py.
set -u
TOKEN=$(cat C:/Users/Administrator/AppData/Roaming/Fury/api-token | tr -d '[:space:]')
API=http://127.0.0.1:35000/v1
API_AUTH="Authorization: Bearer $TOKEN"

for pair in "rev_yandex_3:3" "rev_yandex_4:4" "rev_yandex_15:15" "rev_yandex_16:16" "rev_yandex_17:17" "rev_yandex_18:18" "rev_yandex_19:19" "rev_yandex_20:20"; do
  NAME=${pair%%:*}
  ACC=${pair##*:}
  ID=$(curl -s -m 10 -H "$API_AUTH" $API/profiles | python -c "
import sys,json
for p in json.load(sys.stdin)['data']:
 if p['name']=='$NAME': print(p['id']);break
")
  if [ -z "$ID" ]; then echo "=== $NAME: НЕТ В FURY"; continue; fi
  START=$(curl -s -m 90 -X POST -H "$API_AUTH" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$ID\",\"cdp\":true}" $API/profiles/start)
  PORT=$(echo "$START" | python -c "
import sys,json
try: print(json.load(sys.stdin)['data'].get('debug_port') or '')
except: print('')
")
  echo "=== $NAME (аккаунт #$ACC) port=$PORT"
  if [ -n "$PORT" ]; then
    timeout 200 bun yandex-login.ts $PORT $ACC 2>&1 | grep -E "^логин на странице|^url:|^=== итог|контрольный вопрос|webauthn|Ошибка|error" | tail -6 | cut -c1-160
  fi
  curl -s -m 30 -X POST -H "$API_AUTH" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$ID\"}" $API/profiles/stop >/dev/null
  sleep 2
done
echo ALL_DONE
