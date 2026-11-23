/**
 * МОНИТОР ЧАТОВ — один на все заказы.
 *
 * Что было сломано (разбор 22.10):
 *  1. Список id задавался АРГУМЕНТОМ и замораживался на весь срок жизни
 *     процесса. Новый заказ в список не попадал — его ответы не читались.
 *  2. Круг по всем заказам шёл последовательно: 46 заказов × (goto + пауза
 *     8 сек) — круг 12–25 минут. Каждый заказ опрашивался раз в 20 минут,
 *     поэтому «чат не отрисовался» и «ждём ответа» почти у всех.
 *  3. Пустой/непрочитанный чат не отличался от «сообщений нет».
 *  4. Время последнего успешного чтения нигде не фиксировалось.
 *
 * Что стало:
 *  - список заказов берётся из реестра (bun:sqlite) ПЕРЕД КАЖДЫМ КРУГОМ;
 *  - приоритет: заказы в работе и ждущие данных — первыми, ждущие
 *    назначения — последними (круг по «важным» занимает минуты);
 *  - в реестр пишется время последнего успешного чтения (chat_read_at)
 *    и ошибка чтения (chat_error). Пустой чат ≠ «сообщений нет»: если
 *    .chat-message-row не дождались, это ошибка чтения, а не ответ;
 *  - лимит круга: не успели за круг — идём дальше, а не висим на одном.
 *
 * ПОЧЕМУ ОДИН ПРОЦЕСС НА ВСЕ ЗАКАЗЫ, А НЕ ПО ПРОЦЕССУ НА ЗАКАЗ.
 * Раньше на каждый заказ поднимался свой `bun watch-chat.ts`, и каждый держал
 * своё CDP-соединение к общему видимому Chrome. При 4 заказах это 4
 * одновременных connectOverCDP к одному порту 9222 — порт переставал
 * отвечать, и ВСЕ мониторы падали с «goto: Timeout», то есть ответы
 * заказчиков не читались вообще. Теперь: одно соединение, одна вкладка.
 *
 * ЛОГИ. Скрипт сам пишет per-id логи `logs-watch-chat-<id>-live.txt`:
 * найденный ответ — блоком «ОТВЕТ ЗАКАЗЧИКА (<id>):» + строки «  • текст»
 * (их читает cron-задача «Ответы заказчиков» и доставляет в чат), плюс
 * строку статуса «ждём ответа...».
 *
 *   bun watch-chat.ts [--once] [--minutes N] [--пауза 4] [--лимит 14]
 */
import { chromium } from "playwright";
import { Database } from "bun:sqlite";
import { appendFileSync } from "node:fs";

const арг = process.argv.slice(2);
const одинРаз = арг.includes("--once");
const минут = Number(арг[арг.indexOf("--minutes") + 1]) || 300;
const ПАУЗА_МЕЖДУ = Number(арг[арг.indexOf("--пауза") + 1]) || 4000;
const ЛИМИТ_КРУГА = Number(арг[арг.indexOf("--лимит") + 1]) || 14;
const БД = `${import.meta.dir}/reviews/data/registry.db`;
const ДЕДЛАЙН = Date.now() + минут * 60_000;

const логДля = (id: string) => `${import.meta.dir}/logs-watch-chat-${id}-live.txt`;

/** Приоритет: чем меньше, тем важнее опросить раньше. */
function приоритет(state: string): number {
  switch (state) {
    case "working": return 0;
    case "assigned": return 1;
    case "bid": return 2;
    case "submitted": return 3;
    case "moderation": return 4;
    default: return 5;
  }
}

/** Текущий режим из reviews/data/mode.json. */
async function режимИзФайла(): Promise<string> {
  try {
    const j: any = await Bun.file(`${import.meta.dir}/reviews/data/mode.json`).json();
    return String(j?.режим ?? "");
  } catch {
    return "";
  }
}

/** id заказов, нужных в текущем режиме (из keep-tabs.json). */
async function заказыИзФайлаРежима(): Promise<string[]> {
  try {
    const j: any = await Bun.file(`${import.meta.dir}/reviews/data/keep-tabs.json`).json();
    const out: string[] = [];
    for (const p of (j?.паттерны ?? []) as string[]) {
      const m = p.match(/freelancer\/(\d+)/);
      if (m) out.push(m[1]);
    }
    return out;
  } catch {
    return [];
  }
}

/** Сортировка по приоритету состояния. */
function отсортированные(rows: { id: string; state: string }[]) {
  rows.sort((a, b) => приоритет(a.state) - приоритет(b.state));
  return rows;
}

/** Актуальные заказы из реестра. Список обновляется каждый круг. */
async function списокЗаказов(): Promise<{ id: string; state: string }[]> {
  let db: any;
  try {
    db = new Database(БД, { readonly: true });
    const rows = db
      .query(
        `select target, state from flow
         where target GLOB '[0-9]*'
           and state in ('bid','assigned','working','submitted','moderation')
         order by updated_at desc`
      )
      .all() as any[];
    db.close();
    // РЕЖИМ ОПРЕДЕЛЯЕТ ГЛУБИНУ ОПРОСА. В режиме «Общение» нужны только
    // заказы с непрочитанными сообщениями (их пишет reviews/mode.py в
    // reviews/data/keep-tabs.json). Опрашивать все 46 — значит держать на
    // экране вкладки чатов, которые сейчас не нужны: экран снова «моргает».
    const режим = await режимИзФайла();
    if (режим === "chat") {
      const нужные = await заказыИзФайлаРежима();
      if (нужные.length) {
        const отфильтрованные = rows.filter((r: any) =>
          нужные.includes(String(r.target ?? "").trim()));
        if (отфильтрованные.length) {
          // ФИКС (25.10): ветка возвращала сырые строки {target, state},
          // а вызывающий код читал .id → undefined → ids всегда пустые →
          // в режиме chat монитор вообще не опрашивал (1071 «нет активных»),
          // per-id логи застывали и фаза ОБЩЕНИЕ зацикливалась без прогресса.
          const норм = отфильтрованные.map((r: any) => ({
            id: String(r.target ?? "").trim(),
            state: String(r.state ?? ""),
          }));
          return отсортированные(норм as any);
        }
      }
    }
    const seen = new Set<string>();
    const out: { id: string; state: string }[] = [];
    for (const r of rows) {
      const id = String(r.target ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, state: String(r.state ?? "") });
    }
    out.sort((a, b) => приоритет(a.state) - приоритет(b.state));
    return out;
  } catch (e) {
    console.log(`не удалось прочитать реестр: ${String(e).slice(0, 90)}`);
    return [];
  }
}

/** Записать результат чтения чата в реестр: время успеха или ошибку. */
function записатьЧтение(id: string, успех: boolean, ошибка: string): void {
  try {
    const db = new Database(БД);
    const now = new Date().toISOString().slice(0, 19);
    if (успех) {
      db.query("update flow set chat_read_at=?, chat_error='' where target=?").run(now, id);
    } else {
      db.query("update flow set chat_error=? where target=?").run(ошибка.slice(0, 250), id);
    }
    db.close();
  } catch {
    /* реестр недоступен — не роняем монитор */
  }
}

async function вЛог(id: string, строки: string[]): Promise<void> {
  try {
    appendFileSync(логДля(id), строки.join("\n") + "\n", "utf-8");
  } catch {
    /* лог не пишется — не роняем монитор */
  }
}

// Подключаемся с явным таймаутом: общий Chrome обслуживает ещё и парсеры,
// и когда к нему ломятся несколько клиентов сразу, connectOverCDP без
// таймаута висит вечно и процесс «залипает» молча.
/**
 * Подключение к видимому Chrome — С ПОВТОРОМ.
 *
 * 22.10: Chrome упал (убили процессы bun вместе с дочерним Chrome), и
 * монитор умер с `connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222`.
 * Он больше не поднимался — а вместе с ним мы перестали видеть ответы
 * заказчиков по семи заказам в работе. Теперь монитор ждёт Chrome и
 * подключается сам, как только тот поднимется.
 */
async function подключиться(): Promise<{ ctx: any; page: any }> {
  for (;;) {
    try {
      const браузер = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30_000 });
      const ctx = браузер.contexts()[0];
      if (!ctx) throw new Error("нет контекста");
      const page = await ctx.newPage();
      console.log("[watch] подключились к Chrome");
      return { ctx, page };
    } catch (e) {
      const причина = String((e as Error)?.message ?? e).slice(0, 80);
      console.log(`[watch] Chrome недоступен (${причина}) — ждём и пробуем снова`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

let { ctx, page } = await подключиться();
/**
 * Один опрос: читаем страницу задания.
 * Классы строк Workzilla:
 *   self   — наши сообщения;
 *   system — служебные («Обмен контактами запрещён») — это НЕ ответ заказчика;
 *   прочие — сообщения заказчика.
 */
async function опросить(page: import("playwright").Page, id: string) {
  await page.goto(`https://client.work-zilla.com/freelancer/${id}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // Ждём отрисовку чата. Если не дождались — это ОШИБКА ЧТЕНИЯ, а не
  // «сообщений нет»: раньше это различалось только в тексте лога, и
  // система считала такие заказы «ждём ответа».
  const чат = await page
    .waitForSelector(".chat-message-row", { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!чат) return { наши: [] as string[], чужие: [] as string[], чат: false };
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const наши: string[] = [];
    const чужие: string[] = [];
    for (const s of Array.from(document.querySelectorAll(".chat-message-row"))) {
      const t = (s.querySelector(".chat-text-message")?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      const время = (s.querySelector(".chat-time-status")?.textContent ?? "").replace(/\s+/g, " ").trim();
      const cls = s.className || "";
      if (cls.includes("system") || cls.includes("service")) continue; // служебное
      const строка = `${время ? время + " " : ""}${t}`;
      if (cls.includes("self")) наши.push(строка);
      else чужие.push(строка);
    }
    return { наши, чужие, чат: true };
  });
}

// Ключ сообщения для дедупа. Время в начале строки («14:12 текст») —
// служебное, при перезапуске оно может отличаться, поэтому ключ строим
// ТОЛЬКО по тексту. Раньше при чтении лога в ключ попадало время, а при
// добавлении — нет, и уже доставленные ответы печатались заново по кругу.
const ключСообщения = (t: string): string =>
  t.replace(/^•\s*/, "").replace(/^\S+\s*/, "").slice(0, 200);

// Уже напечатанные сообщения, по заказу. Монитор перезапускается (watchdog,
// истечение срока), и без этого он напечатал бы в лог все старые ответы
// заново — а cron-доставка слала бы в чат одно и то же по кругу.
const ужеНапечатано = new Map<string, Set<string>>();
async function подготовитьЛоги(ids: string[]): Promise<void> {
  for (const id of ids) {
    if (ужеНапечатано.has(id)) continue;
    const набор = new Set<string>();
    try {
      const старый = await Bun.file(логДля(id)).text();
      for (const строка of старый.split("\n")) {
        const t = строка.trim();
        if (t.startsWith("•")) набор.add(ключСообщения(t));
      }
    } catch {
      /* лога нет — напечатаем всё, что найдём */
    }
    ужеНапечатано.set(id, набор);
  }
}

// Замок вкладки: чистка неактивных вкладок (closeInactiveTabs) считает
// страницу задания /freelancer/<id> мусором и закрывала её на ровном месте —
// опрос падал с "Target page, context or browser has been closed". Замок
// сообщает чистке, что эту вкладку трогать нельзя. Обновляем каждый круг.
const ЗАМОК = `${import.meta.dir}/tab-guard-chat-all.json`;
let ids: string[] = [];
async function обновитьЗамок(): Promise<void> {
  await Bun.write(ЗАМОК, JSON.stringify({ ts: new Date().toISOString(), ids })).catch(() => {});
}

// Страница уже создана в подключиться() — второй `let page` ломал
// модуль («page has already been declared»), и монитор не стартовал.
for (;;) {
  const список = await списокЗаказов();
  ids = Array.isArray(список) ? список.map((x: any) => x.id).filter(Boolean) : [];
  if (!ids.length) {
    console.log("в реестре нет активных заказов — ждём");
    await new Promise((r) => setTimeout(r, 60_000));
    continue;
  }
  await подготовитьЛоги(ids);
  await обновитьЗамок();

  let обработано = 0;
  for (const { id } of список) {
    if (обработано >= ЛИМИТ_КРУГА) break;
    if (Date.now() > ДЕДЛАЙН) break;
    обработано++;
    let ч: { наши: string[]; чужие: string[]; чат: boolean };
    try {
      ч = await опросить(page, id);
    } catch (e) {
      // Вкладку закрыли (чистка, чужой скрипт) или Chrome не отвечает —
      // не молчим: заводим новую вкладку и продолжаем ждать.
      const причина = String((e as Error)?.message ?? e).slice(0, 90);
      const строка = `сбой опроса (${id}): ${причина} — переоткрываю вкладку`;
      console.log(строка);
      await вЛог(id, [строка]);
      записатьЧтение(id, false, причина);
      await page.close().catch(() => {});
      // Chrome мог упасть целиком — тогда вкладку не создать, и монитор
      // обязан переподключиться, а не завершиться.
      try {
        page = await ctx.newPage();
      } catch {
        const заново = await подключиться();
        ctx = заново.ctx;
        page = заново.page;
      }
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (ч.чат) записатьЧтение(id, true, "");
    else записатьЧтение(id, false, "чат не отрисовался");

    const набор = ужеНапечатано.get(id)!;
    const свежие = ч.чужие.filter((t) => !набор.has(ключСообщения(t)));
    if (свежие.length) {
      // Ответ найден — печатаем в лог (оттуда cron-задача «Ответы заказчиков»
      // доставляет его в чат) и ПРОДОЛЖАЕМ ждать следующие сообщения.
      // Строка [HH:MM:SS] ОТВЕТ ЗАКАЗЧИКА — маркер для алерта «ответ без
      // реакции» (reviews_noreply_alerts.py). Формат блока ниже не менять:
      // chat-alerts и auto_publish разбирают его по 'ОТВЕТ ЗАКАЗЧИКА (id):'.
      const маркер = `[${new Date().toTimeString().slice(0, 8)}] ОТВЕТ ЗАКАЗЧИКА (${id})`;
      const блок = [маркер, `ОТВЕТ ЗАКАЗЧИКА (${id}):`, ...свежие.map((t) => `  • ${t}`)];
      console.log(блок.join("\n"));
      await вЛог(id, блок);
      for (const t of свежие) набор.add(ключСообщения(t));
    }

    if (одинРаз) {
      const строка = `новых сообщений нет (${id}) | всего: ${ч.наши.length + ч.чужие.length} (наших ${ч.наши.length}) | чат отрисован: ${ч.чат}`;
      console.log(строка);
      await вЛог(id, [строка]);
    }

    const строка =
      `ждём ответа... (${id}) наших:${ч.наши.length} чужих:${ч.чужие.length}` +
      (ч.чат ? "" : " (чат не отрисовался — это ошибка чтения, не «нет ответа»)");
    console.log(строка);
    await вЛог(id, [строка]);
    await new Promise((r) => setTimeout(r, ПАУЗА_МЕЖДУ));
  }

  if (одинРаз) break;
  if (Date.now() > ДЕДЛАЙН) {
    const строка = `таймаут ${минут} мин — цикл завершён (${ids.length} заказов в списке)`;
    console.log(строка);
    await вЛог(ids[0], [строка]);
    break;
  }
  await new Promise((r) => setTimeout(r, 20_000));
}

// Выходим, не закрывая браузер: browser.close() по CDP рвёт вкладки других.
process.exit(0);
