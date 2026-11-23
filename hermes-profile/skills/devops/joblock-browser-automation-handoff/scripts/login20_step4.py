"""#20: пропустить WebAuthn и подтвердить вход в reviews."""
import json, time
from mcp_client import MCP
m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
 e,x=m.tool(n,a or {})
 if e: raise RuntimeError(x[:200])
 return x
def read(): return json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':6000}))
page=read()
print('BEFORE',page.get('url'),flush=True)
skip=next((e['n'] for e in page['elements'] if 'позже' in e.get('label','').lower()),None)
if skip is not None:
 tool('fury_click',{'profile':'rev_yandex_20','element':skip})
 time.sleep(10)
page=read()
print('AFTER_URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:700]),flush=True)
print('ORG_LINKS',sum(1 for e in page.get('elements',[]) if 'yandex.ru/profile/' in (e.get('href') or '')),flush=True)
m.close()
