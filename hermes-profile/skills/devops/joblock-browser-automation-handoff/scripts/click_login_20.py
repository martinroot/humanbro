"""Клик «Войти» в #20 и осмотр формы авторизации."""
import json, time
from mcp_client import MCP
m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
 e,x=m.tool(n,a or {})
 return x
print('CLICK',tool('fury_click',{'profile':'rev_yandex_20','element':4})[:300],flush=True)
time.sleep(8)
page=json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':5000}))
print('URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:1000]),flush=True)
for e in page.get('elements',[])[:50]: print(e.get('n'),e.get('role',''),repr(e.get('label',''))[:70],e.get('href','')[:60],flush=True)
m.close()
