"""Финальный чекап 9 профилей: логин + https://reviews.yandex.ru/ + отзывы."""
import json, time, sys
from mcp_client import MCP

NAMES = [f"rev_yandex_{n}" for n in (2, 3, 4, 15, 16, 17, 18, 19, 20)]
OUT = "C:/Users/Administrator/AppData/Local/Temp/fury-install/reviews_check.jsonl"
URL = "https://reviews.yandex.ru/"

m = MCP()
m.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                      "clientInfo": {"name": "hermes", "version": "1"}})
m.call("notifications/initialized", {}, wait=False)


def tool(name, args=None):
    err, txt = m.tool(name, args or {})
    if err:
        raise RuntimeError(f"{name}: {txt[:300]}")
    return txt


with open(OUT, "w", encoding="utf-8") as f:
    for name in NAMES:
        row = {"profile": name}
        try:
            profiles = json.loads(tool("fury_list_profiles", {"query": name}))["profiles"]
            p = profiles[0]
            row["proxy"] = (p.get("proxy") or {}).get("name")
            if p.get("open"):
                tool("fury_stop_profile", {"profile": name})
                time.sleep(2)
            started = json.loads(tool("fury_start_profile", {"profile": name, "background": True}))
            row["page_tools"] = started.get("page_tools")
            time.sleep(4)
            opened = json.loads(tool("fury_open_url", {"profile": name, "url": URL}))
            row["url_after_open"] = opened.get("url")
            row["title"] = opened.get("title")
            ok = False
            for attempt in range(6):
                time.sleep(5)
                page = json.loads(tool("fury_read_page", {"profile": name, "max_chars": 12000}))
                url = page.get("url") or page.get("address") or ""
                text = page.get("text") or ""
                row["url"] = url
                row["text_head"] = text[:300]
                if "/ugcpub/cabinet" in url and ("Оценки и отзывы" in text or "Ваш профиль" in text):
                    ok = True
                    row["reviews_visible"] = "Оценки и отзывы" in text
                    row["organizations"] = sum(1 for e in page.get("elements", [])
                                               if "yandex.ru/profile/" in (e.get("href") or ""))
                    break
                if any(x in url for x in ("passport.yandex", "auth", "login")) or "Войти" in text[:500]:
                    row["auth_wall"] = True
                    break
            row["ok"] = ok
        except Exception as e:
            row["ok"] = False
            row["error"] = str(e)[:400]
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        print(name, "OK" if row.get("ok") else "FAIL", row.get("url", row.get("url_after_open", ""))[:90],
              "orgs", row.get("organizations", 0), row.get("error", "")[:100], flush=True)
        try:
            tool("fury_stop_profile", {"profile": name})
        except Exception:
            pass
        time.sleep(2)
m.close()
print("WROTE", OUT)
