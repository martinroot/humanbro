"""Минимальный MCP-клиент для fury-agent (stdio JSON-RPC 2.0)."""
import json, subprocess, sys, threading, queue, time

EXE = "C:/Users/Administrator/AppData/Local/Fury/fury-agent.exe"

class MCP:
    def __init__(self):
        self.p = subprocess.Popen([EXE, "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1, encoding="utf-8")
        self.q = queue.Queue()
        threading.Thread(target=self._reader, daemon=True).start()
        self.id = 0

    def _reader(self):
        for line in self.p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                self.q.put(json.loads(line))
            except Exception:
                pass

    def call(self, method, params=None, wait=True):
        self.id += 1
        mid = self.id
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": mid, "method": method,
                                       "params": params or {}}) + "\n")
        self.p.stdin.flush()
        if not wait:
            return None
        end = time.time() + 45
        while time.time() < end:
            try:
                m = self.q.get(timeout=2)
            except queue.Empty:
                continue
            if m.get("id") == mid:
                return m
        raise TimeoutError(method)

    def tool(self, name, args=None):
        r = self.call("tools/call", {"name": name, "arguments": args or {}})
        res = r.get("result", {})
        parts = res.get("content", [])
        texts = [x.get("text", "") for x in parts if x.get("type") == "text"]
        return res.get("isError", False), "\n".join(texts)

    def close(self):
        self.p.terminate()

if __name__ == "__main__":
    m = MCP()
    ini = m.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                "clientInfo": {"name": "hermes", "version": "1"}})
    print("initialize:", json.dumps(ini.get("result", {}))[:200])
    m.call("notifications/initialized", {}, wait=False)
    tl = m.call("tools/list")
    tools = [t["name"] for t in tl.get("result", {}).get("tools", [])]
    print("TOOLS", len(tools), tools)
    for name, args in [("fury_status", {}),
                       ("fury_list_profiles", {"query": "rev_yandex_16"}),
                       ("fury_list_proxies", {})]:
        err, txt = m.tool(name, args)
        print("===", name, "isError", err)
        print(txt[:1200])
    m.close()
