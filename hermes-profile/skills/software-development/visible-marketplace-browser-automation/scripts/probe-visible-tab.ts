// Read what a visible Chrome tab ACTUALLY shows, over raw CDP.
//
// Use when a connector reports "no cards in DOM", "selector not found" or a
// timeout but the tab exists and looks logged in: this prints the URL, title,
// readyState, a count of candidate cards and the first slice of visible text —
// enough to tell a block/challenge page from a real empty feed without guessing.
//
//   bun scripts/probe-visible-tab.ts "profi.ru/backoffice"
//   bun scripts/probe-visible-tab.ts "work-zilla.com"
//
// Read-only: it evaluates JS and never clicks, navigates, reloads or closes.
// Requires Chrome with --remote-debugging-port=9222.

const needle = process.argv[2] || "";
if (!needle) {
  console.error("usage: bun scripts/probe-visible-tab.ts <url-substring>");
  process.exit(2);
}

const CDP = "http://127.0.0.1:9222";

let list: any[];
try {
  const r = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  list = (await r.json()) as any[];
} catch (e: any) {
  console.log(JSON.stringify({ ok: false, error: `CDP unavailable: ${e?.message || e}` }));
  process.exit(1);
}

const targets = list.filter(
  (t) => t.type === "page" && String(t.url || "").includes(needle),
);
if (!targets.length) {
  console.log(
    JSON.stringify({
      ok: false,
      error: `no page tab matching ${JSON.stringify(needle)}`,
      open: list.filter((t) => t.type === "page").map((t) => String(t.url).slice(0, 90)),
    }),
  );
  process.exit(1);
}

for (const t of targets) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) pending.get(m.id)!(m);
  };
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("websocket error"));
  });
  const ev = async (expression: string) => {
    const my = ++id;
    ws.send(
      JSON.stringify({
        id: my,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
    const r: any = await new Promise((res) => pending.set(my, res));
    return r?.result?.result?.value;
  };
  const out = {
    url: await ev("location.href"),
    title: await ev("document.title"),
    readyState: await ev("document.readyState"),
    bodyLength: await ev("document.body ? document.body.innerText.length : 0"),
    textHead: String(await ev("document.body ? document.body.innerText.slice(0,600) : ''")),
    links: await ev("document.querySelectorAll('a[href]').length"),
  };
  ws.close();
  console.log(JSON.stringify({ ok: true, target: t.id, ...out }, null, 1));
}
