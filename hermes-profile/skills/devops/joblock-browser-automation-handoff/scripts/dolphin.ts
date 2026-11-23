/**
 * Клиент Dolphin Anty — антидетект-профили для браузера (dolphin-anty-api.com).
 *
 * Зачем. Сейчас вся автоматизация сидит в одном профиле Chrome
 * (C:\chrome-profile) и одном порту 9222: один логин на все биржи, одна
 * сессия на все вкладки. Dolphin даёт отдельные профили с отдельными куками,
 * отпечатками и прокси — и при этом отдаёт тот же CDP, к которому у нас уже
 * написан весь код (connectOverCDP). То есть изоляция добавляется без правок
 * в браузерной части.
 *
 * API облачный, авторизация Bearer JWT. Токен в dolphin.env рядом со
 * скриптом, в коде его нет и в вывод он не попадает.
 *
 *   bun dolphin.ts профили                 список профилей
 *   bun dolphin.ts прокси                  список прокси в кабинете
 *   bun dolphin.ts создать <имя> [proxyId] создать профиль
 *   bun dolphin.ts старт <id>              запустить, вернуть CDP-порт
 *   bun dolphin.ts стоп <id>               остановить
 *   bun dolphin.ts куки <id>               выгрузить куки профиля
 *   bun dolphin.ts доклад                  что делает сервис (все профили)
 */

const ОБЛАКО = "https://dolphin-anty-api.com";
const ЛОКАЛЬНЫЙ = "http://localhost:3001";
const КЛЮЧ_ФАЙЛ = `${import.meta.dir}/dolphin.env`;

/** Токен из окружения или из файла. Никогда не печатается. */
function токен(): string {
  const изОкружения = (process.env.DOLPHIN_API_KEY ?? "").trim();
  if (изОкружения) return изОкружения;
  try {
    for (const с of require("node:fs").readFileSync(КЛЮЧ_ФАЙЛ, "utf8").split(/\r?\n/)) {
      const m = с.match(/^\s*DOLPHIN_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

async function api(путь: string, метод = "GET", тело?: unknown): Promise<any> {
  const t = токен();
  if (!t) throw new Error("DOLPHIN_API_KEY не задан: переменная окружения или dolphin.env");
  const локальный = путь.startsWith("/v1.0/");
  const r = await fetch(`${локальный ? ЛОКАЛЬНЫЙ : ОБЛАКО}${путь}`, {
    method: метод,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: тело === undefined ? undefined : JSON.stringify(тело),
    signal: AbortSignal.timeout(40_000),
  });
  const текст = await r.text();
  if (!r.ok) {
    let сообщение = текст.slice(0, 200);
    try { сообщение = JSON.parse(текст)?.error ?? сообщение; } catch {}
    throw new Error(`HTTP ${r.status}: ${сообщение}`);
  }
  return текст ? JSON.parse(текст) : {};
}

// ───────────────────────────── команды ─────────────────────────────

async function профили(): Promise<void> {
  const т = await api("/browser_profiles");
  const список = т.data ?? [];
  console.log(`профилей: ${список.length}\n`);
  for (const p of список) {
    console.log(
      `  id=${String(p.id).padEnd(12)} имя=${String(p.name).padEnd(20)} ` +
      `платф=${String(p.platform).padEnd(8)} прокси=${String(p.proxyId ?? "—").padEnd(12)} ` +
      `последний запуск=${p.lastRunAt ? new Date(p.lastRunAt).toLocaleString("ru-RU") : "ни разу"}`,
    );
  }
}

async function прокси(): Promise<void> {
  const т = await api("/proxy");
  const список = Array.isArray(т) ? т : т.data ?? [];
  console.log(`прокси в кабинете: ${список.length}\n`);
  for (const x of список.slice(0, 20)) {
    // Логин/пароль прокси не печатаем: они идут в Dolphin, а не на экран.
    console.log(
      `  id=${String(x.id).padEnd(12)} тип=${String(x.type).padEnd(8)} ` +
      `хост=${String(x.host ?? x.hostName ?? "?").padEnd(18)} порт=${String(x.port ?? "?").padEnd(7)} ` +
      `логин=${String(x.login ?? "—").slice(0, 26)}`,
    );
  }
  if (список.length > 20) console.log(`  … ещё ${список.length - 20}`);
}

async function создать(имя: string, proxyId?: string): Promise<void> {
  if (!имя) throw new Error("нужно имя: bun dolphin.ts создать <имя> [proxyId]");
  const тело: Record<string, unknown> = { name: имя, platform: "windows", browserType: "anty" };
  if (proxyId) тело.proxyId = Number(proxyId);
  const т = await api("/browser_profiles", "POST", тело);
  console.log("создан профиль:", JSON.stringify(т).slice(0, 300));
}

async function старт(id: string): Promise<void> {
  if (!id) throw new Error("нужен id: bun dolphin.ts старт <id>");
  // Local API живёт только пока запущено приложение Dolphin, и требует входа.
  await api("/v1.0/auth/login-with-token", "POST", { token: токен() });
  // По документации Dolphin это GET, а не POST, и с automation=1 —
  // иначе профиль запустится, но без DevTools Protocol.
  const т = await api(`/v1.0/browser_profiles/${id}/start?automation=1`, "GET");
  console.log("запущен:", JSON.stringify(т));
  const порт = т?.automation?.port;
  if (порт) {
    console.log(`\n  CDP готов: http://127.0.0.1:${порт}`);
    console.log(`  цеплять так же, как наш 9222: chromium.connectOverCDP("http://127.0.0.1:${порт}")`);
  }
}

async function стоп(id: string): Promise<void> {
  if (!id) throw new Error("нужен id: bun dolphin.ts стоп <id>");
  const т = await api(`/v1.0/browser_profiles/${id}/stop`, "GET");
  console.log("остановлен:", JSON.stringify(т).slice(0, 200));
}

async function куки(id: string): Promise<void> {
  if (!id) throw new Error("нужен id: bun dolphin.ts куки <id>");
  const т = await api("/v1.0/export-cookies", "POST", { browserProfileId: Number(id) });
  // Куки — секрет: печатаем только сводку, сами значения не выводим.
  const строка = JSON.stringify(т);
  const домены = [...new Set((строка.match(/"domain":"[^"]+"/g) ?? []))].map((d) => d.split('"')[3]);
  console.log(`выгружено кук: ${строка.length} байт, доменов: ${домены.length}`);
  console.log("домены:", домены.slice(0, 12).join(", ") || "(пусто)");
}

async function доклад(): Promise<void> {
  const список = (await api("/browser_profiles")).data ?? [];
  const п = (await api("/proxy"));
  const всегоПрокси = Array.isArray(п) ? п.length : (п.data ?? []).length;
  console.log(`профилей: ${список.length}   прокси: ${всегоПрокси}`);
  const безПрокси = список.filter((p: any) => !p.proxyId).length;
  console.log(`профилей без прокси: ${безПрокси}`);
  const неЗапускались = список.filter((p: any) => !p.lastRunAt).length;
  console.log(`ни разу не запускались: ${неЗапускались}`);
}

// ───────────────────────────── точка входа ─────────────────────────────

const [команда, ...остальное] = process.argv.slice(2);
try {
  switch (команда) {
    case "профили": await профили(); break;
    case "прокси": await прокси(); break;
    case "создать": await создать(остальное[0], остальное[1]); break;
    case "старт": await старт(остальное[0]); break;
    case "стоп": await стоп(остальное[0]); break;
    case "куки": await куки(остальное[0]); break;
    case "доклад": await доклад(); break;
    default:
      console.log(`Dolphin Anty — антидетект-профили (API v1)

  профили                  список профилей
  прокси                   список прокси в кабинете
  создать <имя> [proxyId]  создать профиль
  старт <id>               запустить и показать CDP-порт
  стоп <id>                остановить
  куки <id>                выгрузить куки (печатается сводка, не значения)
  доклад                   короткая сводка по кабинету

Токен: DOLPHIN_API_KEY или dolphin.env рядом со скриптом.`);
  }
} catch (e) {
  console.error("ошибка:", String(e).slice(0, 300));
  process.exitCode = 1;
}
