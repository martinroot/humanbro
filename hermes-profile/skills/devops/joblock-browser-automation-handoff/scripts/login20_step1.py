"""#20: выбрать «Войти по логину» и показать форму."""
import json, time
from mcp_client import MCP
m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
 e,x=m.tool(n,a or {})
 if e: raise RuntimeError(x[:200])
 return x
page=json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':5000}))
target=next(e['n'] for e in page['elements'] if ' Hillary' not in e.get('label','') and 'логину' in e.get('label','').lower())
print('CLICK_ELEM',target,flush=True)
tool('fury_click',{'profile':'rev_yandex_20','element':target})
time.sleep(7)
page=json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':5000}))
print('URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:700]),flush=True)
for e in page.get('elements',[])[:40]:
 print(e.get('n'),e.get('role',''),repr(e.get('label',''))[:60],e.get('type',''),flush=True)
m.close()
