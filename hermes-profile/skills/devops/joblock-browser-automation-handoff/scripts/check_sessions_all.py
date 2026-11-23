"""Проверка живой сессии Яндекса во всех 9 профилях через id.yandex.ru."""
import json, time
from mcp_client import MCP

NAMES = [f"rev_yandex_{n}" for n in (2, 3, 4, 15, 16, 17, 18, 19, 20)]
OUT = "C:/Users/Administrator/AppData/Local/Temp/fury-install/session_check.jsonl"
m = MCP()
m.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                      "clientInfo": {"name": "hermes", "version": "1"}})
m.call("notifications/initialized", {}, wait=False)


def tool(n, a=None):
    err, txt = m.tool(n, a or {})
    if err:
        raise RuntimeError(f"{n}: {txt[:200]}")
    return txt


with open(OUT, "w", encoding="utf-8") as f:
    for name in NAMES:
        row = {"profile": name}
        try:
            p = json.loads(tool("fury_list_profiles", {"query": name}))["profiles"][0]
            if p.get("open"):
                tool("fury_stop_profile", {"profile": name}); time.sleep(2)
            tool("fury_start_profile", {"profile": name, "background": True}); time.sleep(4)
            tool("fury_open_url", {"profile": name, "url": "https://id.yandex.ru/profile"})
            time.sleep(8)
            page = json.loads(tool("fury_read_page", {"profile": name, "max_chars": 4000}))
            url, text = page.get("url", ""), page.get("text", "")
            row["url"], row["head"] = url, text[:220]
            row["logged_in"] = ("passport.yandex" not in url and "auth" not in url
                                and "Войти" not in text[:300] and "Пароль" not in text[:300])
        except Exception as e:
            row["logged_in"] = False; row["error"] = str(e)[:250]
        f.write(json.dumps(row, ensure_ascii=False) + "\n"); f.flush()
        print(name, "SESSION_OK" if row.get("logged_in") else "NO_SESSION",
              row.get("url", "")[:70], row.get("error", "")[:80], flush=True)
        try: tool("fury_stop_profile", {"profile": name})
        except Exception: pass
        time.sleep(2)
m.close()
