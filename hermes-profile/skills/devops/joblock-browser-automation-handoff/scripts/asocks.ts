/**
 * Клиент ASOCKS — мобильных резидентных прокси (api.asocks.com, API v2).
 *
 * Зачем: с нашего IP половина площадок не открывается, и весь конвейер
 * упирается в геолокацию исходящего адреса. Резидентный мобильный IP решает
 * это: адрес стабильный между сессиями, его не банят агрессивно.
 *
 * Ключ НЕ хранится в коде и никогда не печатается: берётся из ASOCKS_API_KEY
 * или из asocks.env рядом со скриптом. В вывод идут только те поля, которые
 * нужны для выбора прокси; пароль всегда скрыт.
 *
 *   bun asocks.ts порты                 список прокси (страна, город, трафик)
 *   bun asocks.ts трафик                израсходовано всего
 *   bun asocks.ts проверить [id]        какой IP отдаёт прокси и рабочий ли он
 *   bun asocks.ts чекнуть               готовый HTTP-прокси для Chrome/Bun
 *   bun asocks.ts обновить <id>         сменить внешний IP (refresh_link)
 *   bun asocks.ts страна RU             доступные страны и их id
 *
 * Примеры:
 *   bun asocks.ts порты
 *   bun asocks.ts проверить 239895704
 *   bun asocks.ts чекнуть
 */

const ОСНОВА = "https://api.asocks.com/v2";
const КЛЮЧ_ФАЙЛ = `${import.meta.dir}/asocks.env`;

type Port = {
  id: number; name: string; proxy: string; login: string; password: string;
  countryCode?: string; cityName?: string; stateName?: string;
  status?: number; traffic_limit?: number;
  spent_traffic_month?: number; spent_traffic_current_month?: number;
  spent_money_month?: number; refresh_link?: string; template?: string;
};

/** Ключ из окружения, иначе из asocks.env. В коде его нет. */
function ключ(): string {
  const изОкружения = (process.env.ASOCKS_API_KEY ?? "").trim();
  if (изОкружения) return изОкружения;
  try {
    for (const с of require("node:fs").readFileSync(КЛЮЧ_ФАЙЛ, "utf8").split(/\r?\n/)) {
      const m = с.match(/^\s*ASOCKS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

async function api(путь: string): Promise<any> {
  const k = ключ();
  if (!k) throw new Error("ASOCKS_API_KEY не задан: переменная окружения или asocks.env");
  const r = await fetch(`${ОСНОВА}${путь}${путь.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(k)}`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const текст = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${текст.slice(0, 200)}`);
  const т = JSON.parse(текст);
  // Поиск отдаёт массивом и без success — это нормально, не считаем ошибкой.
  if (т && т.success === false) throw new Error(`ASOCKS отказал: ${т.message ?? "без причины"}`);
  return т;
}

function гб(байт?: number): string {
  if (!байт) return "—";
  return `${(байт / 1_000_000_000).toFixed(2)} ГБ`;
}

/**
 * Строит CONNECT-туннель через прокси и спрашивает ipify по нему.
 * Возвращает внешний IP или null.
 *
 * Порядок обязателен: сначала обычный сокет до прокси, затем CONNECT с
 * авторизацией, и только после «200 Connection Established» — TLS к цели.
 * Если подключиться по TLS сразу, Talk начнём с прокси-сервером, а не с сайта.
 */
async function туннель(адрес: string, логин: string, пароль: string, хост: string): Promise<string | null> {
  const [host, port] = адрес.split(":");
  const auth = Buffer.from(`${логин}:${пароль}`).toString("base64");
  const net = require("node:net");
  const tls = require("node:tls");
  return await new Promise<string | null>((resolve) => {
    let raw: any = null;
    let secure: any = null;
    let ответ = Buffer.alloc(0);
    let закончили = false;
    const таймер = setTimeout(() => закончить(null), 25_000);
    const закончить = (v: string | null) => {
      if (закончили) return;
      закончили = true;
      clearTimeout(таймер);
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
    } catch {
      закончить(null);
      return;
    }

    // Фаза 1: читаем заголовок ответа CONNECT.
    const наЗаголовок = (ч: Buffer) => {
      ответ = Buffer.concat([ответ, ч]);
      const конец = ответ.indexOf("\r\n\r\n");
      if (конец < 0) return;
      const голова = ответ.subarray(0, конец).toString("utf-8");
      if (!/^HTTP\/1\.[01] 200/.test(голова)) {
        закончить(null);
        return;
      }
      // Фаза 2: туннель есть — оборачиваем его в TLS и говорим с сайтом.
      raw.removeListener("data", наЗаголовок);
      secure = tls.connect({ socket: raw, servername: хост }, () => {
        secure.write(`GET /?format=json HTTP/1.1\r\nHost: ${хост}\r\nConnection: close\r\n\r\n`);
      });
      secure.on("data", (d: Buffer) => {
        const текст = d.toString("utf-8");
        const m = текст.match(/\r\n\r\n([\s\S]*)$/);
        if (m && m[1].trim()) {
          try {
            закончить(JSON.parse(m[1].trim()).ip ?? null);
          } catch {
            закончить(m[1].trim().slice(0, 40));
          }
        }
      });
      secure.on("error", () => закончить(null));
    };
    raw.on("data", наЗаголовок);
    raw.on("error", () => закончить(null));
  });
}

/** Полный прокси для инструментов. Только по прямой просьбе пользователя. */
function полный(п: Port): string {
  return `http://${п.login}:${п.password}@${п.proxy}`;
}

// ───────────────────────────── команды ─────────────────────────────

async function порты(): Promise<void> {
  const т = await api("/proxy/ports");
  const список: Port[] = т.message?.proxies ?? [];
  console.log(`прокси-портов: ${т.message?.countProxies ?? список.length}\n`);
  console.log("id".padStart(12) + "  страна".padEnd(8) + "город".padEnd(18) + "лимит".padStart(10) + "израсход".padStart(10) + "  статус");
  for (const п of список) {
    const статус = п.status === 1 ? "работает" : `статус ${п.status ?? "?"}`;
    console.log(
      `${String(п.id).padStart(12)}  ${(п.countryCode ?? "?").padEnd(8)} ` +
      `${String(п.cityName ?? "—").slice(0, 17).padEnd(18)} ` +
      `${гб(п.traffic_limit).padStart(10)} ${гб(п.spent_traffic_current_month ?? п.spent_traffic_month).padStart(10)}  ${статус}`,
    );
  }
}

async function трафик(): Promise<void> {
  const т = await api("/proxy/total-spent-traffic");
  const б = Number(т.total_spent_traffic ?? 0);
  console.log(`израсходовано всего: ${гб(б)} (${б} байт)`);
}

async function страна(код?: string): Promise<void> {
  const т = await api("/dir/countries");
  const страны: any[] = т.countries ?? [];
  if (!код) {
    console.log(`стран в каталоге: ${страны.length}\n`);
    for (const с of страны.slice(0, 40)) console.log(`  ${с.code}  ${с.name}`);
    return;
  }
  const наш = страны.filter((с) => с.code === код.toUpperCase());
  console.log(наш.length ? JSON.stringify(наш, null, 2) : `страна ${код} не найдена`);
}

async function найти(id?: string): Promise<Port> {
  const т = await api("/proxy/ports");
  const список: Port[] = т.message?.proxies ?? [];
  const п = id ? список.find((x) => String(x.id) === String(id)) : список[0];
  if (!п) throw new Error(`порт ${id ?? "(первый)"} не найден среди ${список.length}`);
  return п;
}

async function проверить(id?: string): Promise<void> {
  const п = await найти(id);
  console.log(`порт ${п.id}  ${п.countryCode ?? "?"} / ${п.cityName ?? "—"}`);
  console.log(`адрес: ${п.proxy}   (логин и пароль скрыты)`);
  // Реальная проверка: спрашиваем ipify, но с указанием прокси в URL.
  // undici/Node не берёт прокси из URL, поэтому проверяем через curl,
  // который у нас есть на машине и который прокси понимает штатно.
  const логин = encodeURIComponent(п.login);
  const пароль = encodeURIComponent(п.password);
  const url = `http://${логин}:${пароль}@${п.proxy}`;
  // Проверяем туннель вручную, через сокет. Так надёжнее, чем curl: в этой
  // сборке curl то молчит, то не передаёт авторизацию в CONNECT, и оба
  // варианта выглядят как «прокси сдох», хотя он живой. Ручной CONNECT
  // даёт однозначный ответ: 200 Connection Established — прокси работает.
  const ip = await туннель(п.proxy, п.login, п.password, "api.ipify.org");
  if (ip) {
    console.log(`  IP через прокси: ${ip}`);
  } else {
    console.log("  туннель не установился — прокси не отвечает или не создан");
  }
}

async function чекнуть(): Promise<void> {
  const п = await найти();
  const url = полный(п);
  console.log("Готовые параметры для Chrome/Bun (пароль в выводе — не для показа, скопируй строку целиком):");
  console.log(`  HTTP_PROXY=${url}`);
  console.log(`  порт=${п.id}  страна=${п.countryCode ?? "?"}  город=${п.cityName ?? "—"}`);
  console.log("\nДля Chrome:");
  console.log(`  --proxy-server=http://${п.proxy}`);
  console.log(`  (логин/пароль задаются в расширении или через прокси-аутентификацию)`);
}

async function обновить(id: string): Promise<void> {
  const т = await api(`/proxy/refresh/${id}`);
  console.log(`порт ${id} обновлён:`, JSON.stringify(т).slice(0, 200));
}

// ───────────────────────────── точка входа ─────────────────────────────

const [команда, ...остальное] = process.argv.slice(2);
try {
  switch (команда) {
    case "порты": await порты(); break;
    case "трафик": await трафик(); break;
    case "страна": await страна(остальное[0]); break;
    case "проверить": await проверить(остальное[0]); break;
    case "чекнуть": await чекнуть(); break;
    case "обновить": await обновить(остальное[0] ?? ""); break;
    default:
      console.log(`ASOCKS — клиент мобильных прокси (api v2)

  порты                 список прокси: id, страна, город, лимит, израсходовано
  трафик                израсходовано всего
  страна [CC]           каталог стран или одна по коду
  проверить [id]        какой IP отдаёт прокси (живой запрос через него)
  чекнуть               готовые параметры прокси для Chrome/Bun
  обновить <id>         сменить внешний IP прокси (refresh_link)

Ключ: ASOCKS_API_KEY или asocks.env рядом со скриптом. В коде его нет,
в вывод не попадает. Пароль прокси печатается только командой «чекнуть».`);
  }
} catch (e) {
  console.error("ошибка:", String(e).slice(0, 300));
  process.exitCode = 1;
}
