"""Разовый чекап: открыть reviews.yandex.ru в одном профиле и прочитать страницу."""
import json, sys, time
from mcp_client import MCP

name = sys.argv[1] if len(sys.argv) > 1 else "rev_yandex_2"
m = MCP()
m.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                      "clientInfo": {"name": "hermes", "version": "1"}})
m.call("notifications/initialized", {}, wait=False)

def tool(n, a=None):
    err, txt = m.tool(n, a or {})
    return err, txt

_, txt = tool("fury_list_profiles", {"query": name})
obj = json.loads(txt)
print("PROFILE", json.dumps(obj["profiles"][0], ensure_ascii=False)[:400], flush=True)
if obj["profiles"][0].get("open"):
    print("STOP", tool("fury_stop_profile", {"profile": name})[1][:120], flush=True)
    time.sleep(2)
print("START", tool("fury_start_profile", {"profile": name, "background": True})[1][:200], flush=True)
time.sleep(5)
print("OPEN", tool("fury_open_url", {"profile": name, "url": "https://reviews.yandex.ru/"})[1][:300], flush=True)
time.sleep(10)
err, txt = tool("fury_read_page", {"profile": name, "max_chars": 6000})
print("READ err", err, flush=True)
print(txt[:6000], flush=True)
m.close()
