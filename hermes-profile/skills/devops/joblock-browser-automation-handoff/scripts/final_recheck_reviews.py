"""Финальный чекап reviews.yandex.ru для #15/#16/#18/#20."""
import json, time
from mcp_client import MCP
NAMES=['rev_yandex_15','rev_yandex_16','rev_yandex_18','rev_yandex_20']
m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
 e,x=m.tool(n,a or {})
 if e: raise RuntimeError(x[:200])
 return x
for name in NAMES:
    p=json.loads(tool('fury_list_profiles',{'query':name}))['profiles'][0]
    if not p.get('open'):
        tool('fury_start_profile',{'profile':name,'background':True}); time.sleep(4)
    tool('fury_open_url',{'profile':name,'url':'https://reviews.yandex.ru/'})
    ok=False
    for _ in range(5):
        time.sleep(5)
        page=json.loads(tool('fury_read_page',{'profile':name,'max_chars':5000}))
        url=page.get('url',''); text=page.get('text','')
        if '/ugcpub/cabinet' in url and ('Оценки и отзывы' in text or 'Задания' in text):
            ok=True; break
        if 'passport.yandex' in url or 'Введите номер телефона' in text:
            break
    orgs=sum(1 for e in page.get('elements',[]) if 'yandex.ru/profile/' in (e.get('href') or ''))
    print(name,'OK' if ok else 'PARTIAL',url[:80],'orgs',orgs,flush=True)
m.close()
