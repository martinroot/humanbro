"""Заменить мёртвые прокси в Fury на новые ASOCKS RU mobile и проверить."""
import json, subprocess, urllib.request

NEW = "C:/Users/Administrator/AppData/Local/Temp/fury-install/new-proxies.json"
TOKEN_FILE = "C:/Users/Administrator/AppData/Roaming/Fury/api-token"
API = "http://127.0.0.1:35000/v1"
TARGETS = {"rev_yandex_16": 247714228, "rev_yandex_20": 247714263}

token = open(TOKEN_FILE, encoding='utf-8').read().strip()
ports = {p['id']: p for p in json.load(open(NEW, encoding='utf-8'))}
profiles = json.load(urllib.request.urlopen(urllib.request.Request(
    API + '/profiles', headers={'Authorization': 'Bearer ' + token})))['data']

def api(path, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=60))

for name, port_id in TARGETS.items():
    p = ports[port_id]
    prof = next(x for x in profiles if x['name'] == name)
    host, port = p['proxy'].split(':')
    # сначала создаём новый прокси, затем привязываем к профилю
    made = api('/proxies', 'POST', {
        'name': 'ASOCKS RU mobile %s' % port_id,
        'kind': 'http', 'host': host, 'port': int(port),
        'username': p['login'], 'password': p['password'],
        'rotate_url': p.get('refresh_link') or '',
    })
    pid = made.get('data', {}).get('id')
    if not pid:
        print(name, 'CREATE_FAIL', str(made)[:120]); continue
    # привязка:8080 профиля — смотрим поддерживаемый формат через PUT/PATCH
    bound = api('/profiles/' + prof['id'] + '/proxy', 'POST', {'proxy_id': pid})
    print(name, 'created', pid, 'bound', bool(bound.get('ok')))
