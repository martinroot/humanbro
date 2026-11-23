"""#20: пароль → контрольный вопрос → проверка кабинета."""
import json, re, time
from pathlib import Path
from mcp_client import MCP

TEXT = Path('C:/Users/Administrator/AppData/Local/Temp/fury-install/failed_accounts_creds.txt').read_text(encoding='utf-8')
block = TEXT.split('аккаунт #20')[1]
def get(label):
    m = re.search(label + r'\s*:\s*(.+)', block)
    return m.group(1).strip() if m else None
password, answer = get('Пароль'), get('Ответ на контрольный вопрос')

m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
    e,x=m.tool(n,a or {})
    if e: raise RuntimeError(x[:200])
    return x
def read():
    return json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':6000}))

page=read()
pw=next(e['n'] for e in page['elements'] if e.get('type')=='password')
tool('fury_type',{'profile':'rev_yandex_20','element':pw,'text':password,'submit':True})
time.sleep(10)
page=read()
print('URL1',page.get('url'),flush=True)
print('TEXT1',repr((page.get('text') or '')[:600]),flush=True)
for e in page.get('elements',[])[:30]:
    print('E',e.get('n'),e.get('role',''),repr(e.get('label',''))[:55],e.get('type',''),flush=True)

# контрольный вопрос: ищем текстовое поле, если оно есть
if answer and page.get('elements'):
    fields=[e for e in page['elements'] if e.get('type') in ('text','') and e.get('role') in ('textbox',None,'', 'input')]
    # безопаснее: по метке, содержащей вопрос/ответ
    q=next((e for e in page['elements'] if any(k in e.get('label','').lower() for k in ('вопрос','ответ','контрол'))),None)
    if q:
        print('ANSWER_FIELD',q['n'],flush=True)
        tool('fury_type',{'profile':'rev_yandex_20','element':q['n'],'text':answer,'submit':True})
        time.sleep(10)
        page=read()
        print('URL2',page.get('url'),flush=True)
        print('TEXT2',repr((page.get('text') or '')[:600]),flush=True)
m.close()
