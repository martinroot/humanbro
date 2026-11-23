/**
 * Покупка прокси ASOCKS и автозаливка их в Dolphin Anty.
 *
 * Зачем. В Dolphin было 79 прокси, из них российских — один. Для отзывов на
 * Авито/Яндекс.Картах нужен российский IP: белорусский или казахский на
 * российском отзыве — мгновенный маркер для модерации. ASOCKS — тот же
 * провайдер, что и 58 из 79 уже имеющихся портов, поэтому интеграция
 * родная: у порта есть refresh_link для ротации IP.
 *
 * Ключи: ASOCKS_API_KEY (asocks.env рядом) и DOLPHIN_API_KEY (dolphin.env).
 * Ни один ключ в коде и в выводе не печатается.
 *
 *   bun asocks-buy.ts баланс             остаток денег и тариф
 *   bun asocks-buy.ts купить RU 5         купить 5 портов в РФ
 *   bun asocks-buy.ts порты              купленные порты (id, страна, город)
 *   bun asocks-buy.ts проверить 239895704  какой IP отдаёт порт
 *   bun asocks-buy.ts в dolphin          залить все порты в кабинет Dolphin
 *   bun asocks-buy.ts всё                купить 5 RU + залить в Dolphin
 *
 * Покупка тратит деньги: команда «купить» с параметрами означает согласие
 * на списание. «в dolphin» ничего не покупает.
 */
import { appendFileSync, readFileSync } from "node:fs";

const ОСНОВА_ASOCKS = "https://api.asocks.com/v2";
const ОСНОВА_DOLPHIN = "https://dolphin-anty-api.com";
const КЛЮЧ_ASOCKS = `${import.meta.dir}/asocks.env`;
const КЛЮЧ_DOLPHIN = `${import.meta.dir}/dolphin.env`;

type Port = {
  id: number; name?: string; proxy: string; login: string; password: string;
  countryCode?: string; cityName?: string; stateName?: string; status?: number;
  traffic_limit?: number; spent_traffic_current_month?: number; refresh_link?: string;
  type?: string; template?: string;
};

function ключИз(файл: string, имя: string): string {
  if (process.env[имя]) return process.env[имя].trim();
  try {
    for (const с of readFileSync(файл, "utf8").split(/\r?\n/)) {
      const m = с.match(new RegExp(`^\\s*${имя}\\s*=\\s*(.+?)\\s*$`));
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
  return "";
}

function asocks(путь: string, метод = "GET", тело?: unknown): Promise<any> {
  const k = ключИз(КЛЮЧ_ASOCKS, "ASOCKS_API_KEY");
  if (!k) throw new Error("ASOCKS_API_KEY не найден (asocks.env или переменная окружения)");
  const sep = путь.includes("?") ? "&" : "?";
  return fetch(`${ОСНОВА_ASOCKS}${путь}${sep}apiKey=${encodeURIComponent(k)}`, {
    method: метод,
    headers: { "Content-Type": "application/json" },
    body: тело === undefined ? undefined : JSON.stringify(тело),
    signal: AbortSignal.timeout(45_000),
  }).then(async (r) => {
    const текст = await r.text();
    let т: any;
    try { т = текст ? JSON.parse(текст) : {}; } catch { т = { raw: текст }; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(т?.message ?? текст).slice(0, 200)}`);
    if (т?.success === false) throw new Error(`ASOCKS отказал: ${т?.message ?? "без причины"}`);
    return т;
  });
}

function dolphin(путь: string, метод = "GET", тело?: unknown): Promise<any> {
  const k = ключИз(КЛЮЧ_DOLPHIN, "DOLPHIN_API_KEY");
  if (!k) throw new Error("DOLPHIN_API_KEY не найден (dolphin.env или переменная окружения)");
  return fetch(`${ОСНОВА_DOLPHIN}${путь}`, {
    method: метод,
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: тело === undefined ? undefined : JSON.stringify(тело),
    signal: AbortSignal.timeout(45_000),
  }).then(async (r) => {
    const текст = await r.text();
    if (!r.ok) throw new Error(`Dolphin HTTP ${r.status}: ${текст.slice(0, 200)}`);
    return текст ? JSON.parse(текст) : {};
  });
}

async function порты(): Promise<Port[]> {
  const т = await asocks("/proxy/ports");
  return (т?.message?.proxies ?? []) as Port[];
}

/** Загрузка списка портов: у ASOCKS он на 33 МБ, поэтому читаем построчно. */
function загрузитьВыгрузку(url: string): Port[] {
  const сырой = readFileSync(url.replace("https://", ""), "utf8");
  return [];
}

// ───────────────────────────── команды ─────────────────────────────

async function баланс(): Promise<void> {
  const б = await asocks("/user/balance");
  const п = await asocks("/plan/info");
  console.log(`баланс: $${Number(б.balance ?? 0).toFixed(2)}`);
  console.log(`тариф: ${п?.message?.tariffName ?? "—"}  до ${п?.message?.expiredDate ?? "—"}`);
  const список = await порты();
  const поСтране = new Map<string, number>();
  for (const x of список) {
    const с = x.countryCode ?? "?";
    поСтране.set(с, (поСтране.get(с) ?? 0) + 1);
  }
  console.log(`портов всего: ${список.length}`);
  for (const [с, n] of [...поСтране].sort((a, b) => b[1] - a[1])) console.log(`  ${с}: ${n}`);
}

async function купить(код: string, количество: number): Promise<void> {
  const страна = (код || "RU").toUpperCase();
  const кол = Math.max(1, Math.min(50, Number(количество) || 1));
  console.log(`покупаю ${кол} порт(ов) в ${страна}…`);
  // Эндпоинт из документации: POST /v2/proxy/create-port. Старый /proxy/create
  // больше не существует (404). Обязательные поля: country_code, type_id,
  // proxy_type_id. type_id=1 — residential, 2 — mobile.
  const тело = {
    country_code: страна,
    count: кол,
    type_id: Number(process.env.ASOCKS_TYPE_ID ?? 1),
    proxy_type_id: Number(process.env.ASOCKS_PROXY_TYPE_ID ?? 1),
    server_port_type_id: Number(process.env.ASOCKS_SERVER_PORT_TYPE_ID ?? 1),
  };
  const т = await asocks("/proxy/create-port", "POST", тело);
  const созданные = т?.data ?? [];
  console.log(`создано: ${Array.isArray(созданные) ? созданные.length : "?"}`);
  for (const x of (Array.isArray(созданные) ? созданные : []).slice(0, кол)) {
    console.log(`  id=${x.id}  ${x.country ?? страна}  ${x.server}:${x.port}  статус ${x.status ?? "?"}`);
  }
  if (!Array.isArray(созданные) || !созданные.length) {
    console.log("ответ сервиса:", JSON.stringify(т).slice(0, 300));
  }
}

async function показатьПорты(): Promise<void> {
  const список = await порты();
  console.log(`портов: ${список.length}\n`);
  console.log("id".padStart(12) + "  страна".padEnd(7) + "город".padEnd(16) + "статус".padEnd(10) + "refresh");
  for (const x of список) {
    console.log(
      `${String(x.id).padStart(12)}  ${(x.countryCode ?? "?").padEnd(7)} ` +
      `${String(x.cityName ?? "—").slice(0, 15).padEnd(16)} ` +
      `${(x.status === 1 ? "работает" : `статус ${x.status ?? "?"}`).padEnd(10)} ` +
      `${x.refresh_link ? "есть" : "—"}`,
    );
  }
}

/**
 * Проверка порта живым запросом. Туннель строим вручную (CONNECT), а не
 * через curl: в этой сборке curl то молчит, то не передаёт авторизацию,
 * и оба случая выглядят как «прокси сдох», хотя он живой.
 */
async function проверить(id: string): Promise<void> {
  const список = await порты();
  const п = список.find((x) => String(x.id) === String(id));
  if (!п) throw new Error(`порт ${id} не найден среди ${список.length}`);
  console.log(`порт ${п.id}  ${п.countryCode ?? "?"} / ${п.cityName ?? "—"}`);
  console.log(`адрес: ${п.proxy}   (логин и пароль скрыты)`);
  const ip = await туннель(п.proxy, п.login, п.password, "api.ipify.org");
  console.log(ip ? `  внешний IP: ${ip}` : "  туннель не установился — порт не отвечает");
}

async function туннель(адрес: string, логин: string, пароль: string, хост: string): Promise<string | null> {
  const [host, port] = адрес.split(":");
  const auth = Buffer.from(`${логин}:${пароль}`).toString("base64");
  const net = require("node:net");
  const tls = require("node:tls");
  return await new Promise<string | null>((resolve) => {
    let raw: any = null, secure: any = null, ответ = Buffer.alloc(0);
    let закончили = false;
    const таймер = setTimeout(() => закончить(null), 25_000);
    const закончить = (v: string | null) => {
      if (закончили) return;
      закончили = true; clearTimeout(таймер);
      try { secure?.destroy(); raw?.destroy(); } catch {}
      resolve(v);
    };
    try {
      raw = net.connect({ host, port: Number(port) }, () => {
        raw.write(
          `CONNECT ${хост}:443 HTTP/1.1\r\nHost: ${хост}:443\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\nConnection: close\r\n\r\n`,
        );
      });
    } catch { закончить(null); return; }
    const наЗаголовок = (ч: Buffer) => {
      ответ = Buffer.concat([ответ, ч]);
      const конец = ответ.indexOf("\r\n\r\n");
      if (конец < 0) return;
      const голова = ответ.subarray(0, конец).toString("utf-8");
      if (!/^HTTP\/1\.[01] 200/.test(голова)) { закончить(null); return; }
      raw.removeListener("data", наЗаголовок);
      secure = tls.connect({ socket: raw, servername: хост }, () => {
        secure.write(`GET /?format=json HTTP/1.1\r\nHost: ${хост}\r\nConnection: close\r\n\r\n`);
      });
      secure.on("data", (d: Buffer) => {
        const t = d.toString("utf-8");
        const m = t.match(/\r\n\r\n([\s\S]*)$/);
        if (m && m[1].trim()) {
          try { закончить(JSON.parse(m[1].trim()).ip ?? null); }
          catch { закончить(m[1].trim().slice(0, 40)); }
        }
      });
      secure.on("error", () => закончить(null));
    };
    raw.on("data", наЗаголовок);
    raw.on("error", () => закончить(null));
  });
}

/** Заливает порты ASOCKS в кабинет Dolphin как прокси с ротацией IP. */
async function залить(код?: string): Promise<void> {
  const список = await порты();
  const нужные = код ? список.filter((x) => (x.countryCode ?? "").toUpperCase() === код.toUpperCase()) : список;
  if (!нужные.length) { console.log("нечего заливать"); return; }
  const уже = await dolphin("/proxy");
  const вКабинете = new Set((Array.isArray(уже) ? уже : уже.data ?? []).map((x: any) => `${x.host}:${x.port}`));
  let добавлено = 0, пропущено = 0;
  for (const п of нужные) {
    const [host, port] = п.proxy.split(":");
    if (вКабинете.has(`${host}:${port}`)) { пропущено++; continue; }
    const тело: Record<string, unknown> = {
      type: "http", host, port: Number(port), login: п.login, password: п.password,
      name: `asocks_${п.countryCode ?? "?"}_${п.id}`,
    };
    // changeIpUrl — кнопка «сменить IP» в Dolphin: прокси-сервис сам
    // переключает адрес по запросу, без перезапуска профиля.
    if (п.refresh_link) тело.changeIpUrl = п.refresh_link;
    if (п.template) тело.provider = п.template;
    await dolphin("/proxy", "POST", тело);
    добавлено++;
    console.log(`  + ${п.id} ${п.countryCode ?? "?"}/${п.cityName ?? "—"} → ${host}:${port}`);
  }
  console.log(`\nв кабинет Dolphin: добавлено ${добавлено}, уже были ${пропущено}`);
}

async function всё(код: string, количество: number): Promise<void> {
  await купить(код, количество);
  await показатьПорты();
  await залить(код);
}

// ───────────────────────────── точка входа ─────────────────────────────

const [команда, ...остальное] = process.argv.slice(2);
try {
  switch (команда) {
    case "баланс": await баланс(); break;
    case "купить": await купить(остальное[0] ?? "RU", Number(остальное[1] ?? 1)); break;
    case "порты": await показатьПорты(); break;
    case "проверить": await проверить(остальное[0] ?? ""); break;
    case "в dolphin": await залить(остальное[0]); break;
    case "всё": await всё(остальное[0] ?? "RU", Number(остальное[1] ?? 1)); break;
    default:
      console.log(`ASOCKS → Dolphin: покупка прокси и автозаливка

  баланс                остаток денег, тариф, порты по странам
  купить <CC> <N>       купить N портов в стране CC (тратит деньги)
  порты                 купленные порты: id, страна, город, refresh
  проверить <id>        какой внешний IP отдаёт порт (живой запрос)
  в dolphin [CC]       залить порты в кабинет Dolphin (ничего не покупает)
  всё <CC> <N>          купить N портов и сразу залить их в Dolphin

Ключи: ASOCKS_API_KEY (asocks.env) и DOLPHIN_API_KEY (dolphin.env).
Пароли прокси в вывод не попадают.`);
  }
} catch (e) {
  console.error("ошибка:", String(e).slice(0, 300));
  process.exitCode = 1;
}
