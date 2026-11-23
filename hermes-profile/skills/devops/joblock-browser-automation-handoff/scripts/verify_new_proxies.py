"""Запустить профиль Fury по API и проверить IP/Yandex через CDP."""
import json, os, subprocess, sys, time, urllib.request

ROOT = "C:/Users/Administrator/browser-automation"
TOKEN = open("C:/Users/Administrator/AppData/Roaming/Fury/api-token", encoding="utf-8").read().strip()
API = "http://127.0.0.1:35000/v1"

def req(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(API + path, data=body, method=method or ("POST" if data else "GET"),
                               headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())

profiles = req("/profiles")["data"]
ids = {p["name"]: p["id"] for p in profiles}

for n in ("rev_yandex_16", "rev_yandex_20"):
    pid = ids[n]
    r = req("/profile/start", {"profile_id": pid})
    cdp = r.get("cdp_port") or r.get("port") or (r.get("data") or {}).get("cdp_port")
    print("START", n, "cdp", cdp, flush=True)
    if not cdp:
        print("  НЕТ CDP:", str(r)[:200], flush=True)
        continue
    time.sleep(4)
    out = subprocess.run(
        ["bun", "check-auth.ts", str(cdp)], cwd="C:/Users/Administrator/AppData/Local/Temp/fury-install",
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    print("  CHECK:", (out.stdout or out.stderr)[:300].strip(), flush=True)
