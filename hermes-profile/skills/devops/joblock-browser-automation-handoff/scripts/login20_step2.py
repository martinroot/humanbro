"""#20: ввести логин/пароль из локального файла, не печатая значения."""
import json, re, time
from pathlib import Path
from mcp_client import MCP

TEXT = Path('C:/Users/Administrator/AppData/Local/Temp/fury-install/failed_accounts_creds.txt').read_text(encoding='utf-8')
block = TEXT.split('аккаунт #20')[1]
def get(label):
    m = re.search(label + r'\s*:\s*(.+)', block)
    return m.group(1).strip() if m else None
login, password, answer = get('Логин'), get('Пароль'), get('Ответ на контрольный вопрос')
assert login and password, ' creds missing'

m=MCP(); m.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'hermes','version':'1'}}); m.call('notifications/initialized',{},wait=False)
def tool(n,a=None):
    e,x=m.tool(n,a or {})
    if e: raise RuntimeError(x[:200])
    return x

def read():
    return json.loads(tool('fury_read_page',{'profile':'rev_yandex_20','max_chars':5000}))

page=read()
field=next(e['n'] for e in page['elements'] if 'огин' in e.get('label','') or 'email' in e.get('label','').lower())
print('login_field',field,'login_len',len(login),flush=True)
tool('fury_type',{'profile':'rev_yandex_20','element':field,'text':login,'submit':True})
time.sleep(8)
page=read()
print('URL',page.get('url'),flush=True)
print('TEXT',repr((page.get('text') or '')[:500]),flush=True)
for e in page.get('elements',[])[:30]:
    print(e.get('n'),e.get('role',''),repr(e.get('label',''))[:55],e.get('type',''),flush=True)
m.close()
