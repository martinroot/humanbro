import csv, json
ports = json.load(open('C:/Users/Administrator/AppData/Local/Temp/fury-install/new-proxies.json', encoding='utf-8'))
by_id = {p['id']: p for p in ports}
rows = [['name', 'proxy', 'tags', 'notes']]
for name, pid in [('rev_yandex_16', 247714228), ('rev_yandex_20', 247714263)]:
    p = by_id[pid]
    line = 'http://%s:%s@%s' % (p['login'], p['password'], p['proxy'])
    rows.append([name, line, 'dolphin,asocks-ru-mobile', 'dolphin_id=%s; asocks_port=%s' % (
        {'rev_yandex_16': 900509437, 'rev_yandex_20': 900509445}[name], pid)])
out = 'C:/Users/Administrator/AppData/Local/Temp/fury-install/new-proxies.csv'
with open(out, 'w', encoding='utf-8', newline='') as f:
    csv.writer(f).writerows(rows)
print('csv rows', len(rows) - 1)
