"""Открыть #20 и показать элементы страницы авторизации (без секретов)."""
import json, time
from mcp_client import MCP
m = MCP()
m.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                      "clientInfo": {"name": "hermes", "version": "1"}})
m.call("notifications/initialized", {}, wait=False)
def t(n,a=None):
 e,x=m.tool(n,a or {})
 print('TOOL',n,'err',e,flush=True)
 return x
print(t('fury_start_profile',{'profile':'rev_yandex_20','background':True})[:200],flush=True)
time.sleep(4)
print(t('fury_open_url',{'profile':'rev_yandex_20','url':'https://reviews.yandex.ru/'})[:300],flush=True)
time.sleep(8)
txt=t('fury_read_page',{'profile':'rev_yandex_20','max_chars':5000})
page=json.loads(txt)
print('URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:900]),flush=True)
for e in page.get('elements',[])[:60]:
 print(e.get('n'),e.get('role',''),repr(e.get('label',''))[:70],e.get('href','')[:60],flush=True)
m.close()
