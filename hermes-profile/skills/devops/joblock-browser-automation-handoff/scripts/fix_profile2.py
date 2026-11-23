"""Заменить прокси #2 через MCP и проверить сессию/кабинет."""
import json, time
from pathlib import Path
from mcp_client import MCP

p = json.loads(Path('C:/Users/Administrator/AppData/Local/Temp/fury-install/px_2.json').read_text(encoding='utf-8'))
line = f"http://{p['login']}:{p['password']}@{p['proxy']}"  # proxy = host:port

m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
    e,x=m.tool(n,a or {})
    if e: raise RuntimeError(x[:200])
    return x

print('ADD', tool('fury_add_proxies', {'lines': line, 'name_prefix':'ASOCKS-RU'})[:300], flush=True)
time.sleep(2)
proxies = json.loads(tool('fury_list_proxies'))['proxies']
host, port = p['proxy'].split(':')
newid = next(x['id'] for x in proxies if x['host']==host and str(x['port'])==port)
print('NEW_ID', newid, 'proxy', host, port, flush=True)

prof = json.loads(tool('fury_list_profiles', {'query':'rev_yandex_2'}))['profiles'][0]
if prof.get('open'):
    tool('fury_stop_profile', {'profile':'rev_yandex_2'}); time.sleep(2)
tool('fury_update_profile', {'profile':'rev_yandex_2','proxy':newid})
tool('fury_start_profile', {'profile':'rev_yandex_2','background':True}); time.sleep(5)
tool('fury_open_url', {'profile':'rev_yandex_2','url':'https://reviews.yandex.ru/'})
time.sleep(9)
page=json.loads(tool('fury_read_page',{'profile':'rev_yandex_2','max_chars':4000}))
print('URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:280]),flush=True)
print('ORGS',sum(1 for e in page.get('elements',[]) if 'yandex.ru/profile/' in (e.get('href') or '')),flush=True)
m.close()
