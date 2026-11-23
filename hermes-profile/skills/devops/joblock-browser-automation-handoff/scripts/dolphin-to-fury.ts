// Разовый мост Dolphin → Fury CSV. Секреты не печатает — только в выходной CSV.
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = readFileSync(`${import.meta.dir}/dolphin.env`, "utf8")
  .split(/\r?\n/).map(s => s.match(/^\s*DOLPHIN_API_KEY\s*=\s*(.+?)\s*$/)?.[1]?.replace(/^["']|["']$/g, ""))
  .find(Boolean) ?? "";
if (!TOKEN) throw new Error("нет DOLPHIN_API_KEY");

async function api(path: string, method = "GET") {
  const local = path.startsWith("/v1.0/");
  const host = local ? "http://localhost:3001" : "https://dolphin-anty-api.com";
  const r = await fetch(host + path, { method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

await api("/v1.0/auth/login-with-token", "POST", undefined).catch(async () => {
  // локальный логин требует тело — делаем отдельно ниже
});

const login = await fetch("http://localhost:3001/v1.0/auth/login-with-token", {
  method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ token: TOKEN }), signal: AbortSignal.timeout(40000) });
if (!login.ok) throw new Error(`Dolphin login HTTP ${login.status}: ${(await login.text()).slice(0, 200)}`);

const prof = (await api("/browser_profiles")).data ?? [];
const proxies = (await api("/proxy"));
const plist = Array.isArray(proxies) ? proxies : proxies.data ?? [];
const byId = new Map(plist.map((p: any) => [String(p.id), p]));

function proxyLine(p: any): string {
  if (!p) return "";
  const host = String(p.host ?? p.hostName ?? "");
  const port = String(p.port ?? "");
  const user = String(p.login ?? "");
  const pass = String(p.password ?? "");
  const type = String(p.type ?? "http").toLowerCase();
  const scheme = type === "socks5" ? "socks5" : "http";
  const auth = user ? (pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : `${encodeURIComponent(user)}@`) : "";
  return `${scheme}://${auth}${host}:${port}`;
}

const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const rows = ["name,proxy,tags,notes"];
for (const p of prof) {
  const pr = byId.get(String(p.proxyId ?? ""));
  rows.push([esc(String(p.name ?? "")), esc(proxyLine(pr)), esc("dolphin"), esc(`dolphin_id=${p.id}`)].join(","));
}
const out = `${import.meta.dir}/dolphin-to-fury.csv`;
writeFileSync(out, rows.join("\n") + "\n", "utf8");
console.log(`CSV rows: ${prof.length}, proxies matched: ${prof.filter((p:any)=>byId.has(String(p.proxyId))).length}`);
