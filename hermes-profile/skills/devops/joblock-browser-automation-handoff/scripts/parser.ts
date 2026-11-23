/**
 * Marketplace feed collector + single-sink Fabra transport.
 * Forward every newly discovered project-feed card using source+external_id
 * idempotency only; Fabra owns recommendations and the separate manual
 * "take into work" decision. This parser never submits exchange offers.
 * Kwork seller services stay read-only.
 *
 *   bun parser.ts            — работать
 *   bun parser.ts --тихо     — только в лог, ничего не отправлять
 */
import { appendFileSync } from "node:fs";
import { attachToVisible, closeInactiveTabs } from "./browser";
import { marketplaceKey, loadSeenMarketplaceKeys, parseApiTimestamp, shouldForwardFabraProject, normalizeFabraProjectStatus, isFabraProjectPersisted, waitForParserUnpause, ingestPriceRubles, diffKworkSnapshots, type FabraProjectSnapshot, type KworkSnapshot } from "./marketplace-monitor-core";
import { FabraApiError, FabraNetworkError, FabraParserClient, isRetryableFabraError, mergeEnvSettings, resolveParserSink } from "./fabra-client";
import { DispatcherIntakeClient, isRetryableDispatcherError } from "./dispatcher-client";
import { классифицировать, преграда } from "./classify";
import * as тг from "./tg";
import type { Page } from "playwright";
import { collectAttachments } from "./marketplace-attachments";

const ШАГ_МС = 10_000;          // как часто снимаем Workzilla (было 30_000 для 60-секундного SLA)
const KWORK_КАЖДЫЙ = 4;         // Kwork реже: проекты появляются медленнее
const МОЛЧА = process.argv.includes("--тихо");
// PARSER_MARKETS=wz,kw,is — процесс обслуживает только эти ленты. Пусто: все.
// Три отдельных процесса (по одному на биржу) пишут в разные логи и не
// мешают друг другу, если одна лента отвалилась.
// Имя переменной — ASCII: кириллица в имени не проходит через bash
// ("PARSER_БИРЖИ=wz: command not found") и молча убивала запуск.
const ТОЛЬКО_БИРЖИ = (process.env.PARSER_MARKETS || "").split(",").map(s => s.trim()).filter(Boolean);
const НУЖНА = (код: string) => ТОЛЬКО_БИРЖИ.length === 0 || ТОЛЬКО_БИРЖИ.includes(код);
const ПРИЁМНИК = resolveParserSink(process.env.PARSER_SINK, "fabra");
const FABRA = new FabraParserClient({ token: process.env.FABRA_PARSER_TOKEN });
const CONTROL_INTAKE = ПРИЁМНИК === "dispatcher" ? new DispatcherIntakeClient({
  baseUrl: process.env.JOBLOCK_CONTROL_URL || undefined,
  token: process.env.JOBLOCK_CONTROL_INGEST_TOKEN || "",
}) : null;
const ЛОГ_WZ = "feed-log.jsonl";
const ЛОГ_KW = "kwork-log.jsonl";
const ЛОГ_IS = "insolvo-log.jsonl";
// Sandbox — псевдо-биржа для smoke-тестов, ходит тем же путём, что и живые биржи.
const ЛОГ_SB = "sandbox-log.jsonl";
const SANDBOX_BOARD = "http://127.0.0.1:8788/board";
const PAUSE_FILE = `${import.meta.dir}/parser.pause`;
if (await Bun.file(PAUSE_FILE).exists()) {
  console.log("парсер на паузе: удалите parser.pause, чтобы продолжить");
  await waitForParserUnpause(() => Bun.file(PAUSE_FILE).exists(), (ms) => Bun.sleep(ms));
  console.log("парсер возобновлён");
}
// Insolvo — бурж-биржа, цены в долларах: фильтры считаем в рублях по грубому курсу.
const КУРС_$ = 90;

/** Не показываем то, что заведомо не дойдёт до работы. */
const МИН_ЦЕНА = Number(process.env.ПАРСЕР_МИН_ЦЕНА ?? 300);
const МАКС_ПРЕДЛОЖЕНИЙ = Number(process.env.ПАРСЕР_МАКС_ПРЕДЛОЖЕНИЙ ?? 8);

type Карточка = {
  id: string; title: string; description: string; price: number; time: string;
  предложений?: number; максимум?: number; проектов_у_заказчика?: number; нанимает?: string;
  attachments?: Array<{name:string;path:string;url:string;mime_type?:string;size?:number}>;
};

const видели = new Set<string>();
const тексты = new Map<string, string>();
const логиВиденных: { source: string; content: string }[] = [];
for (const [лог, источник] of [[ЛОГ_WZ, "workzilla"], [ЛОГ_KW, "kwork"], [ЛОГ_IS, "insolvo"], [ЛОГ_SB, "sandbox"]] as const)
  try { логиВиденных.push({ source: источник, content: await Bun.file(лог).text() }); } catch {}
for (const key of loadSeenMarketplaceKeys(логиВиденных)) видели.add(key);
let FABRA_READY = ПРИЁМНИК !== "fabra";
let предупреждениеМаршрута = false;
console.log(`парсер: в логах ${видели.size} объявлений по трём биржам; sink=${ПРИЁМНИК}${ПРИЁМНИК === "fabra" ? "; передача всех новых карточек без выбора агента/ценовых фильтров" : `; порог ${МИН_ЦЕНА} ₽`}`);
if (ПРИЁМНИК === "fabra") {
  try {
    const подключение = await FABRA.connect();
    if (подключение.token) {
      process.env.FABRA_PARSER_TOKEN = подключение.token;
      try {
        const envPath = `${import.meta.dir}/.env`;
        const currentEnv = await Bun.file(envPath).text().catch(() => "");
        await Bun.write(envPath, mergeEnvSettings(currentEnv, {
          PARSER_SINK: "fabra",
          FABRA_PARSER_TOKEN: подключение.token,
        }));
      } catch {
        console.log("Fabra token active in process memory; persistent env update failed, bootstrap will retry on restart");
      }
    }
    FABRA_READY = true;
    const liveAgents = подключение.agents.filter((agent) => agent.status === "live").length;
    console.log(`Fabra connection ready; live agents=${liveAgents}; bootstrap=${подключение.bootstrapped}; credential redacted`);
  } catch (error) {
    FABRA_READY = false;
    const reason = error instanceof FabraApiError ? `HTTP ${error.status}`
      : error instanceof FabraNetworkError ? "network failure"
      : "credential/catalog validation failure";
    console.log(`Fabra startup connection failed: ${reason}; dispatch disabled`);
    if (!МОЛЧА) await тг.послать(`Fabra не подключена (${reason}); новые проекты не отправляю ни в Fabra, ни в JobLock.`).catch(() => {});
    предупреждениеМаршрута = true;
  }
}

const ctx = await attachToVisible();

async function вкладка(url: string, старая?: Page): Promise<Page> {
  // Утечка вкладок: каждая пересъёмка после ошибки открывала новую и бросала
  // старую — за сутки окно разрасталось до десятка вкладок и съедало память.
  // Старую закрываем до того, как поднять новую.
  if (старая) await старая.close().catch(() => {});
  // Вкладку с этим адресом уже открыли — второй не заводим, берём существующую.
  // Сравниваем адрес целиком, а не по префиксу: иначе лента Workzilla
  // подменяется чужой страницей /freelancer/current-orders — она начинается
  // с того же префикса, карточек ленты в ней нет, и парсер молчит.
  const норма = (адрес: string) => адрес.split("?")[0].replace(/\/$/, "");
  const имеющаяся = ctx.pages().find((p) => норма(p.url()) === норма(url));
  if (имеющаяся) return имеющаяся;
  const page = await ctx.newPage();
  // Таймаут навигации обязателен: без него goto висит до бесконечности и
  // тянет за собой весь процесс парсера (так умер парсер Kwork).
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(5000);
  return page;
}

// Уборщик наследия: прошлые запуски наоткрывали дублей. Оставляем по одной
// вкладке на адрес, остальные закрываем.
{
  const оставленные = new Set<string>();
  for (const p of ctx.pages()) {
    const адрес = p.url().split("?")[0];
    if (оставленные.has(адрес)) await p.close().catch(() => {});
    else оставленные.add(адрес);
  }
}

// Каждая биржа — свой процесс (ПАРСЕР_БИРЖИ). Вкладку открываем только
// для своей ленты, иначе три процесса наплодят девять вкладок в общем окне.
// Стартовые вкладки открываем в try/catch: падение одной ленты не должно
// убивать весь процесс парсера (иначе биржа молча выпадает до следующего
// перезапуска вручную).
let wz = НУЖНА("wz") ? await вкладка("https://client.work-zilla.com/freelancer").catch(() => null) : null;
let kw = НУЖНА("kw") ? await вкладка("https://kwork.ru/projects?c=all").catch(() => null) : null;
// Insolvo — третья биржа; разметка карточки копия Workzilla, снимает её тот же снять_wz.
let is = НУЖНА("is") ? await вкладка("https://client.insolvo.com/freelancer").catch(() => null) : null;
// Sandbox — псевдо-биржа в той же разметке, снимается тем же снять_wz.
// let, а не const: вкладку песочницы приходится пересоздавать, если её
// закрыла чистка неактивных вкладок.
// Песочница (127.0.0.1:8788) выключена по решению владельца 22.10:
// реальных заказов там нет, портал не поднят на хосте, а вкладка с неё
// только занимала экран. Рынок "sb" больше не открывается.
let sb: Page | null = null;

const снять_wz = (page: Page) =>
  page.evaluate(() => {
    const т = (el: Element | null) => el?.textContent?.trim().replace(/\s+/g, " ") ?? "";
    return [...document.querySelectorAll<HTMLElement>(".order-in-list[data-order-id]")].map((c) => ({
      id: c.dataset.orderId!,
      title: т(c.querySelector(".title .text-wrapper")),
      price: Number(т(c.querySelector(".price-order-in-list .param-title")).replace(/\D/g, "")) || 0,
      time: т(c.querySelector(".time-title")),
      description: т(c.querySelector(".new-order-full-description")) || т(c.querySelector(".new-order-short-description")),
    }));
  });

/** AJAX-обновление ленты Workzilla без перезагрузки страницы.
 *  Кнопка «Новые» дёргает XHR /api/order/v6/list/open (~76 КБ) и обновляет
 *  DOM на месте. Прямой fetch того же URL отдаёт только счётчик {result:N},
 *  поэтому перехватываем реальный ответ через Playwright.
 */
const обновить_wz_ajax = async (page: Page): Promise<any[]> => {
  const жду = page.waitForResponse(
    (r) => r.url().includes("/api/order/v6/list/open") && r.request().method() === "GET",
    { timeout: 12_000 },
  ).then((r) => r.text()).catch(() => "");
  const клик = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(
      (e) => (e.textContent || "").trim() === "Новые",
    );
    if (!a) return false;
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }).catch(() => false);
  if (!клик) return [];
  const raw = await жду;
  if (!raw || raw.length < 1000) return [];
  const j = JSON.parse(raw);
  const data = j?.data || {};
  return Object.values(data).flatMap((g: any) => Array.isArray(g) ? g : [])
    .filter((x: any) => x && x.id)
    .map((x: any) => ({
      id: String(x.id),
      title: String(x.subject || "").slice(0, 500),
      price: Number(x.price) || 0,
      // AJAX отдаёт modified в мс; приводим к тому же виду, что DOM (.time-title).
      time: (() => {
        const ms = Number(x.modified);
        if (!Number.isFinite(ms) || ms <= 0) return "";
        const d = new Date(ms);
        return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
      })(),
      description: String(x.description || "").slice(0, 6000),
    }));
};

const снять_kw = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".want-card")].map((к) => {
      const с = к.querySelector("a[href*='/projects/']") as HTMLAnchorElement | null;
      const т = (к.innerText ?? "").replace(/\s+/g, " ").trim();
      const ч = (п: RegExp) => { const м = т.match(п); return м ? Number(м[1].replace(/\D/g, "")) || 0 : 0; };
      return {
        id: (с?.getAttribute("href") ?? "").split("/").pop() ?? "",
        title: с?.innerText?.trim() ?? "",
        description: т.split("Показать полностью")[0].replace(с?.innerText?.trim() ?? "", "").trim(),
        price: ч(/Желаемый бюджет[^\d]{0,12}([\d\s]+)/) || ч(/Цена до[^\d]{0,6}([\d\s]+)/),
        максимум: ч(/Допустимый[^\d]{0,12}([\d\s]+)/),
        предложений: ч(/Предложений[^\d]{0,6}(\d+)/),
        проектов_у_заказчика: ч(/Размещено проектов на бирже[^\d]{0,6}(\d+)/),
        нанимает: (т.match(/Нанято:\s*(\d+)%/) ?? [])[1] ?? "",
        time: (т.match(/Осталось:\s*([^П]+?)(?:Предложений|$)/) ?? [])[1]?.trim() ?? "",
      };
    }));

/** Kwork: лента в 34 страницы, а парсер видел только первую (12 карточек).
 *  Постраничный обход: кликаем по номеру страницы, если он есть в пагинации,
 *  иначе — по стрелке «вперёд». */
async function снять_kw_страницы(page: Page, страниц: number): Promise<Карточка[]> {
  const все: Карточка[] = [];
  const seen = new Set<string>();
  for (let номер = 1; номер <= страниц; номер++) {
    if (номер > 1) {
      const перешли = await page.evaluate((н: number) => {
        const items = Array.from(document.querySelectorAll<HTMLElement>(".pagination__item"));
        const цель = items.find(i => (i.textContent ?? "").trim() === String(н));
        if (цель) { цель.click(); return true; }
        const стрелка = document.querySelector<HTMLElement>(".pagination__arrow--next");
        if (стрелка) { стрелка.click(); return true; }
        return false;
      }, номер);
      if (!перешли) break;
      await page.waitForTimeout(2500);
    }
    for (const к of await снять_kw(page)) {
      if (!к.id || seen.has(к.id)) continue;
      seen.add(к.id);
      все.push(к);
    }
  }
  return все;
}

/** Insolvo: лента отдаёт 58 карточек одним экраном, кнопки догрузки нет.
 *  Кнопка «See more» на странице — это реклама реферальной программы
 *  (ссылка /friends), а не догрузка: клик по ней увёл вкладку с ленты. */
async function снять_is_с_догрузкой(page: Page): Promise<Карточка[]> {
  const url = page.url();
  if (!/client\.insolvo\.com\/freelancer/.test(url)) {
    // Лента уехала (рефералка, редирект) — возвращаемся и ждём загрузки.
    await page.goto("https://client.insolvo.com/freelancer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
  }
  return снять_wz(page);
}

function projectUrlForMarket(market:"wz"|"kw"|"is"|"sb", id:string):string {
  return market==="kw" ? `https://kwork.ru/projects/${id}`
    : market==="is" ? `https://client.insolvo.com/freelancer/${id}`
    : market==="sb" ? `${SANDBOX_BOARD.replace("/board","")}/order/${id}`
    : `https://client.work-zilla.com/freelancer/${id}`;
}

async function enrichMarketplaceAttachments(card:Карточка, market:"wz"|"kw"|"is"|"sb") {
  // ВАЖНО: `\\d` в literal regex — это НЕ цифра, а обратный слэш + «d».
  // Из-за двойного экранирования условие НИКОГДА не совпадало, и сбор
  // вложений молча выключался для всех заказов.
  if (market==="sb" || card.attachments?.length || !/^\d{4,}$/.test(String(card.id))) return;
  const projectUrl=projectUrlForMarket(market,card.id);
  // Файлы заказа есть ТОЛЬКО на странице задания: в ленте их нет, а `fetch`
  // по прямому URL отдаёт SPA-заглушку (~6 КБ, title «…_stub»). Поэтому
  // открываем деталь в отдельной вкладке и читаем уже отрисованный DOM.
  const detail = await вкладка(projectUrl, undefined).catch(() => null);
  if (process.env.PARSER_DEBUG_ATTACH === "1") {
    console.log(`enrich ${market}/${card.id}: tab=${Boolean(detail)} url=${detail ? detail.url().slice(-30) : "—"}`);
  }
  if (!detail) return;
  try {
    // Вкладка могла быть переиспользована с прошлого круга — обновляем,
    // иначе снимем DOM предыдущего заказа (пустой или чужой).
    await detail.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    // `[class*='attachment' i]` ловит иконку-заглушку «прикрепить файл», и
    // селектор срабатывал ДО подгрузки реальных вложений. Ждём именно блок
    // описания заказа, затем даём сети догрузить картинки/файлы.
    await detail.waitForSelector(".order-description, .fl-project-content__description, .b-post__description", { timeout: 15_000 }).catch(() => {});
    await detail.waitForTimeout(2500);
    const html=await detail.evaluate(() => "<!DOCTYPE html>\n" + document.documentElement.outerHTML);
    if (!html) return;
    const source=market==="wz" ? "WZ" : market==="kw" ? "KW" : "IN";
    card.attachments=await collectAttachments(detail,html,projectUrl,source,`${source}-${card.id}`);
    if (card.attachments.length) {
      console.log(`attachments ${market}/${card.id}: ${card.attachments.length} (${card.attachments.map(a=>a.name).join(", ")})`);
    } else if (process.env.PARSER_DEBUG_ATTACH === "1") {
      console.log(`attachments ${market}/${card.id}: 0 (html ${html.length} байт)`);
    }
  } catch (error) {
    console.log(`attachment extraction failed ${market}/${card.id}: ${typeOf(error)}`);
  } finally {
    await detail.close().catch(() => {});
  }
}

function typeOf(error:unknown):string { return error instanceof Error ? error.name : "Error"; }

const снять_sb = async (page: Page): Promise<Карточка[]> =>
  // Та же функция, что и для Workzilla: разметка песочницы с неё снята.
  снять_wz(page);

let найдено = 0, просмотрено = 0;

async function разобрать(карточки: Карточка[], биржа: "wz" | "kw" | "is" | "sb") {
  if (ПРИЁМНИК === "disabled" || (ПРИЁМНИК === "fabra" && !FABRA_READY)) {
    if (!предупреждениеМаршрута) {
      const причина = ПРИЁМНИК === "disabled" ? "PARSER_SINK неизвестен; локальный маршрут не выбран" : "Fabra bootstrap/auth не готов";
      console.log(`parser dispatch disabled: ${причина}`);
      if (!МОЛЧА) await тг.послать(`Маршрутизация проектов приостановлена: ${причина}. Проверьте конфигурацию; в JobLock/Fabra ничего не отправляю.`).catch(() => {});
      предупреждениеМаршрута = true;
    }
    return;
  }
  const источник = биржа === "wz" ? "workzilla" : биржа === "kw" ? "kwork" : биржа === "sb" ? "sandbox" : "insolvo";
  const лог = биржа === "wz" ? ЛОГ_WZ : биржа === "kw" ? ЛОГ_KW : биржа === "sb" ? ЛОГ_SB : ЛОГ_IS;
  if (ПРИЁМНИК === "fabra") {
    for (const card of карточки) {
      if (!card.id) continue;
      const projectUrl = биржа === "kw" ? `https://kwork.ru/projects/${card.id}`
        : биржа === "is" ? `https://client.insolvo.com/freelancer/${card.id}`
        : биржа === "sb" ? `${SANDBOX_BOARD.replace("/board", "")}/order/${card.id}`
        : `https://client.work-zilla.com/freelancer/${card.id}`;
      await сообщитьFabraЧтоОткрыт(источник, card.id, projectUrl).catch((e) => console.log(`Fabra source-status update failed ${источник} ${card.id}: ${String(e).slice(0, 120)}`));
    }
  }
  for (const к of карточки.filter((к) => ПРИЁМНИК === "fabra"
    ? shouldForwardFabraProject({ source: источник, id: к.id, price: к.price, offers: к.предложений }, видели)
    : Boolean(к.id) && !видели.has(marketplaceKey(источник, к.id)))) {
    видели.add(marketplaceKey(источник, к.id));
    // ЭТАП 1: только лента. Детали заказа (полное ТЗ + файлы) снимает
    // этап 2 (enrich_details.py) и ТОЛЬКО для прошедших блэклист.
    // Раньше здесь открывалась страница каждого заказа — 90% карточек
    // «отзывы за деньги», биржа видела десятки переходов и грозила баном.
    просмотрено++;
    // В ленте Insolvo бюджет указан в USD; фильтр и выбранная система считают в RUB.
    const вРублях = { ...к, price: ingestPriceRubles(источник, к.price, КУРС_$) };
    // Локальный JobLock тоже берёт каждую новую карточку: отбор агента и
    // цены делает портал (pick_agent) и таблица заказов, парсер только
    // приносит. Свои фильтры оставлены у Fabra-маршрута, где их тоже нет.
    const вердикт = ПРИЁМНИК === "fabra" ? "передать-в-Fabra" : ПРИЁМНИК === "dispatcher" ? "передать-в-JobLock-Control" : "передать-в-JobLock";
    const п = "";
    const {attachments:_неЛогировать, ...карточкаДляЛога}=к;
    const базоваяЗапись = { ...карточкаДляЛога, source: источник, ts: new Date().toISOString(), вердикт, преграда: п };
    const записатьРешение = (retryable: boolean) => appendFileSync(лог, JSON.stringify({
      ...базоваяЗапись, candidate_ready: false, retryable,
    }) + "\n");

    // Записываем in-flight marker до POST: падение процесса оставит ID доступным для retry.
    // Any interruption before an authoritative success stays retryable; all sinks are source+ID idempotent.
    записатьРешение(true);
    найдено++;
    // Ровно один получатель: Fabra ИЛИ локальный JobLock, никогда оба.
    // Курс Insolvo уже нормализован, чтобы в обе системы уходили RUB.
    let результат: any = null;
    let ошибкаIngest = "";
    let retryableIngest = false;
    let joblockHttpStatus: number | undefined;
    let fabraProject: any = null;
    try {
      if (ПРИЁМНИК === "fabra") {
        const projectUrl = биржа === "kw" ? `https://kwork.ru/projects/${к.id}`
          : биржа === "is" ? `https://client.insolvo.com/freelancer/${к.id}`
          : биржа === "sb" ? `${SANDBOX_BOARD.replace("/board", "")}/order/${к.id}`
          : `https://client.work-zilla.com/freelancer/${к.id}`;
        const response = await FABRA.createProjects([{
          source: источник,
          external_id: к.id,
          title: к.title || "",
          description: к.description || "",
          url: projectUrl,
          price: вРублях.price || 0,
          currency: "RUB",
          source_status: "open",
          raw: { exchange_currency: биржа === "is" ? "USD" : "RUB", listed_price: к.price || 0, parser_seen_at: new Date().toISOString(), attachments: к.attachments || [] },
        }]);
        const item = response.projects[0];
        const ingest = item?.ingest;
        fabraProject = item?.project ?? (isFabraProjectPersisted(item, источник, к.id) ? item : null);
        if (!isFabraProjectPersisted(fabraProject, источник, к.id)) {
          const readback = await FABRA.getProject(источник, к.id);
          if (isFabraProjectPersisted(readback, источник, к.id)) fabraProject = readback.project ?? readback;
        }
        if (!isFabraProjectPersisted(fabraProject, источник, к.id))
          throw new Error(String(item?.error || ingest?.error || "Fabra не подтвердила сохранение проекта"));
        результат = {
          ok: true,
          new: ingest?.new === true,
          number: ingest?.number || fabraProject?.order_number || "",
          agent: ingest?.agent || fabraProject?.agent_slug || "",
          suggestedAgent: fabraProject?.suggested_agent_slug || "",
          status: fabraProject?.fabra_status || fabraProject?.status || "",
        };
      } else if (ПРИЁМНИК === "joblock") {
        const projectUrl = биржа === "kw" ? `https://kwork.ru/projects/${к.id}`
          : биржа === "is" ? `https://client.insolvo.com/freelancer/${к.id}`
          : биржа === "sb" ? `${SANDBOX_BOARD.replace("/board", "")}/order/${к.id}`
          : `https://client.work-zilla.com/freelancer/${к.id}`;
        const response = await fetch("http://127.0.0.1:8701/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: источник,
            external_id: к.id,
            title: к.title || "",
            description: к.description || "",
            price: вРублях.price || 0,
            url: projectUrl,
            attachments: к.attachments || [],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        joblockHttpStatus = response.status;
        результат = await response.json().catch(() => null);
        if (!response.ok) {
          retryableIngest = [408, 425, 429].includes(response.status) || response.status >= 500;
          ошибкаIngest = `HTTP ${response.status}`;
        } else if (!результат?.ok) {
          retryableIngest = true;
          ошибкаIngest = String(результат?.error || "неподтверждённый ответ сервера");
        } else if (!результат) {
          retryableIngest = true;
          ошибкаIngest = "некорректный ответ сервера";
        }
      } else if (ПРИЁМНИК === "dispatcher" && CONTROL_INTAKE) {
        const projectUrl = биржа === "kw" ? `https://kwork.ru/projects/${к.id}`
          : `https://client.${биржа === "is" ? "insolvo.com" : "work-zilla.com"}/freelancer/${к.id}`;
        const intake = await CONTROL_INTAKE.intakeProject({
          source: источник as "workzilla" | "kwork" | "insolvo",
          external_id: к.id,
          title: к.title || "",
          description: к.description || "",
          price: вРублях.price || 0,
          currency: "RUB",
          source_status: "open",
          url: projectUrl,
          attachments: к.attachments || [],
        });
        результат = { ok: true, new: intake.created === true, number: intake.key,
          agent: "", status: intake.status, duplicate: intake.duplicate === true };
      } else {
        throw new Error("PARSER_SINK должен быть joblock, fabra или dispatcher");
      }
    } catch (e) {
      ошибкаIngest = String(e).slice(0, 180);
      if (ПРИЁМНИК === "dispatcher") retryableIngest = isRetryableDispatcherError(e);
      if (ПРИЁМНИК === "joblock") retryableIngest = joblockHttpStatus === undefined ||
        joblockHttpStatus === 401 || joblockHttpStatus === 403 || joblockHttpStatus === 408 ||
        joblockHttpStatus === 425 || joblockHttpStatus === 429 || joblockHttpStatus >= 500;
      if (ПРИЁМНИК === "fabra") {
        try {
          const readback = await FABRA.getProject(источник, к.id);
          if (isFabraProjectPersisted(readback, источник, к.id)) {
            fabraProject = readback.project ?? readback;
            результат = {
              ok: true, new: false,
              number: fabraProject?.order_number || "",
              agent: fabraProject?.agent_slug || "",
              suggestedAgent: fabraProject?.suggested_agent_slug || "",
              status: fabraProject?.fabra_status || fabraProject?.status || "",
            };
            ошибкаIngest = "";
          } else retryableIngest = isRetryableFabraError(e);
        } catch (readError) {
          retryableIngest = isRetryableFabraError(e) || isRetryableFabraError(readError);
        }
      }
      if (retryableIngest) видели.delete(marketplaceKey(источник, к.id));
    }
    const готовоКОтклику = Boolean(результат?.ok && результат?.new === true);
    appendFileSync(лог, JSON.stringify({
      ...базоваяЗапись,
      candidate_ready: готовоКОтклику,
      retryable: retryableIngest,
      ingest_ok: Boolean(результат?.ok),
      ingest_new: Boolean(результат?.new),
      ingest_number: результат?.number ?? "",
      ingest_agent: результат?.agent ?? "",
      ingest_suggested_agent: результат?.suggestedAgent ?? "",
      ingest_status: результат?.status ?? "",
      ingest_error: ошибкаIngest,
    }) + "\n");

    const имя = биржа === "kw" ? "Kwork" : биржа === "is" ? "Insolvo" : биржа === "sb" ? "Sandbox" : "Workzilla";
    const цена = биржа === "is" ? `$${к.price || "?"} (~${вРублях.price || "?"} ₽)` : `${к.price || "?"} ₽`;
    const имяПриёмника = ПРИЁМНИК === "fabra" ? "Fabra" : ПРИЁМНИК === "joblock" ? "JobLock" : ПРИЁМНИК === "dispatcher" ? "JobLock Control" : "выключенный маршрут";
    const статусПриёмника = результат?.ok
      ? ПРИЁМНИК === "fabra"
        ? `Fabra: запись подтверждена ${результат.number || `${источник}/${к.id}`}; статус ${результат.status || "получен"}; агент ${результат.agent || "—"}; рекомендация ${результат.suggestedAgent || "—"}`
        : ПРИЁМНИК === "dispatcher"
          ? (результат.new ? `${имяПриёмника}: принят новый проект ${результат.number}` : результат.updated ? `${имяПриёмника}: проект обновлён ${результат.number}` : `${имяПриёмника}: проект уже был ${результат.number}`)
          : (результат.new ? `${имяПриёмника}: проект ${результат.number}, агент ${результат.agent}` : `${имяПриёмника}: этот проект уже был`)
      : `${имяПриёмника}: не принят — ${ошибкаIngest || "неизвестная ошибка"}`;
    const строка =
      `${имя} ${к.id} | ${цена}` +
      `${к.максимум ? ` (до ${к.максимум})` : ""} | ${к.time}` +
      `${к.предложений !== undefined ? ` | предложений ${к.предложений}` : ""}\n` +
      `${к.title}\n${к.description.slice(0, 300)}\n${статусПриёмника}\nОтклик — только после вашего согласования.\n` +
      (биржа === "kw" ? `https://kwork.ru/projects/${к.id}`
        : биржа === "is" ? `https://client.insolvo.com/freelancer/${к.id}`
        : `https://client.work-zilla.com/freelancer/${к.id}`);
    // Лента в Telegram отключена по требованию владельца: за час приходило
    // около десятка карточек, и они забивали чат ценными сообщениями.
    // Строка остаётся в parser-run.log — история парсинга на месте, просто
    // не приходит в Telegram. Статусы заказов и ошибки (ниже) шлём по-прежнему:
    // это редко и по делу.
    console.log(строка.replace(/\n/g, " | "));
  }
}

const HEALTH_FILE = "marketplace-health.json";
const OWN_KWORK_STATE = "kwork-own-state.json";
const FABRA_STATE_FILE = "fabra-parser-state.json";
type HealthRecord = { status: string; last_seen: string; last_ok?: string; cards: number; error?: string };
let health: { feeds: Record<string, HealthRecord> } = { feeds: {} };
try { health = JSON.parse(await Bun.file(HEALTH_FILE).text()); } catch {}
let ownKwork: KworkSnapshot | null = null;
try { ownKwork = await Bun.file(OWN_KWORK_STATE).json(); } catch {}
let lastOwnKworkCheck = 0;
type FabraProjectState = FabraProjectSnapshot;
let fabraState: { cursor: string; projects: Record<string, FabraProjectState> } = { cursor: "", projects: {} };
try { fabraState = await Bun.file(FABRA_STATE_FILE).json(); } catch {}
let lastFabraStatusPoll = 0;
let lastFabraStatusError = "";

async function сообщитьFabraЧтоОткрыт(source: string, externalId: string, projectUrl: string) {
  if (ПРИЁМНИК !== "fabra" || !FABRA_READY) return;
  const key = marketplaceKey(source, externalId);
  const tracked = fabraState.projects[key];
  if (!tracked || tracked.source_status === "open") return;
  const result = await FABRA.updateSourceStatus(source, externalId, {
    source_status: "open",
    project_url: projectUrl,
    status_note: "Parser sees this project in the exchange open-project feed",
  });
  if (!result?.ok) throw new Error("Fabra source-status update rejected");
  tracked.source_status = "open";
  tracked.updated_at = new Date().toISOString();
  await Bun.write(FABRA_STATE_FILE, JSON.stringify(fabraState, null, 2));
}

async function отметитьЛенту(имя: string, page: Page | null, карточек: number, ошибка = "") {
  // Песочница приходит обычным fetch, а не вкладкой, поэтому page бывает null.
  const url = page?.url() ?? "";
  const статус = ошибка ? "error" : /\/(login|signin)(?:[/?#]|$)/i.test(url) ? "login" : "ok";
  const старое = health.feeds[имя];
  const now = new Date().toISOString();
  health.feeds[имя] = {
    status: статус,
    last_seen: now,
    last_ok: статус === "ok" ? now : старое?.last_ok,
    cards: карточек,
    error: ошибка || (статус === "login" ? `login redirect: ${url}` : ""),
  };
  await Bun.write(HEALTH_FILE, JSON.stringify(health, null, 2));
  if ((!старое && статус !== "ok" || старое && старое.status !== статус) && !МОЛЧА) {
    const сообщение = статус === "ok"
      ? `Монитор бирж: ${имя} восстановлен, карточек на ленте: ${карточек}.`
      : `Монитор бирж: ${имя} недоступен (${статус})${ошибка ? `: ${ошибка.slice(0, 180)}` : `: ${url}`}.`;
    await тг.послать(сообщение).catch(() => {});
  }
}

async function проверитьМоиКворки(page: Page | null): Promise<Page | null> {
  // В процессе, который не обслуживает Kwork, вкладки нет — проверять нечего.
  if (!page) return null;
  const firstRun = ownKwork === null;
  const now = Date.now();
  if (now - lastOwnKworkCheck < 15 * 60_000) return page;
  lastOwnKworkCheck = now;
  try {
    const снимок = await page.evaluate(async () => {
      async function загрузить(номер: number) {
        const response = await fetch(`/api/user/get_kworks_tab?group=all&page=${номер}`, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!json?.success || !json?.data?.stateData) throw new Error("Kwork API вернул пустое состояние");
        return json.data.stateData;
      }
      const first = await загрузить(1);
      const total = Number(first.pagingdata?.total ?? 0);
      const perPage = Number(first.pagingdata?.paging?.items_per_page ?? 12);
      if (!perPage || total < 0 || total > 1000) throw new Error("неожиданные границы списка Kwork");
      const posts = [...(first.posts ?? [])];
      for (let pageNo = 2; pageNo <= Math.ceil(total / perPage); pageNo++) {
        const state = await загрузить(pageNo);
        posts.push(...(state.posts ?? []));
      }
      const groups = first.groups ?? {};
      return {
        total,
        pagesLoaded: posts.length,
        totals: {
          rejected: Number(groups.rejected?.count ?? 0),
          paused: Number(groups.feated?.count ?? 0),
          drafts: Number(groups.draft?.count ?? 0),
          all: Number(groups.all?.count ?? total),
        },
        cards: posts.map((card: any) => ({
          id: String(card.PID),
          title: String(card.gtitle ?? ""),
          status: String(card.active ?? "unknown"),
          price: Number(card.price ?? 0),
          views: Number(card.viewcount ?? 0),
          sales: Number(card.done_order_count ?? card.data?.order_count ?? 0),
          earned: Number(card.rev ?? 0),
          warning: [card.commonRejectReason?.decision, card.rejectFieldsString ? `Требует исправить: ${card.rejectFieldsString}` : ""].filter(Boolean).join("; "),
          competition: String(card.competition_level ?? "unknown"),
        })),
      };
    });
    if (!снимок.total || снимок.pagesLoaded !== снимок.total || снимок.cards.length !== снимок.total)
      throw new Error(`неполный список Kwork: ${снимок.pagesLoaded}/${снимок.total}`);
    const текущий = { totals: снимок.totals, cards: снимок.cards } satisfies KworkSnapshot;
    const изменения = diffKworkSnapshots(ownKwork, текущий);
    const countsChanged = ownKwork && JSON.stringify(ownKwork.totals) !== JSON.stringify(текущий.totals);
    ownKwork = текущий;
    await Bun.write(OWN_KWORK_STATE, JSON.stringify(ownKwork, null, 2));
    await отметитьЛенту("kwork_my_services", page, снимок.cards.length);

    const сообщения: string[] = [];
    if (firstRun) {
      сообщения.push(`Мои Kwork: считано ${снимок.cards.length}/${снимок.total}; требуют исправления ${текущий.totals.rejected}, остановлены ${текущий.totals.paused}, черновики ${текущий.totals.drafts}.`);
      for (const card of текущий.cards.filter((c) => c.warning).slice(0, 5))
        сообщения.push(`⚠️ ${card.title}: ${card.warning}`);
    } else {
      if (countsChanged) сообщения.push(`Счётчики своих Kwork изменились: исправить ${текущий.totals.rejected}, остановлены ${текущий.totals.paused}, черновики ${текущий.totals.drafts}, всего ${текущий.totals.all}.`);
      for (const card of изменения.newWarnings) сообщения.push(`⚠️ Kwork требует внимания: ${card.title} — ${card.warning}`);
      for (const card of изменения.resolvedWarnings) сообщения.push(`✅ Предупреждение Kwork снято: ${card.title}`);
      for (const { card, previousSales } of изменения.salesIncreased) сообщения.push(`💰 Продажа Kwork: ${card.title} — ${previousSales} → ${card.sales}`);
    }
    if (сообщения.length && !МОЛЧА) await тг.послать(сообщения.join("\n")).catch(() => {});
    return page;
  } catch (e) {
    const текст = String(e).slice(0, 180);
    await отметитьЛенту("kwork_my_services", page, ownKwork?.cards.length ?? 0, текст);
    console.log(`монитор собственных Kwork: ${текст}`);
    // Вкладка закрыта (чистка, редирект на логин) — следующий опрос упадёт
    // снова: page.evaluate на закрытой странице бросает всё время, а лента
    // пересоздаёт вкладку только в свой редкий круг. Открываем новую сразу
    // и возвращаем вызывающему, чтобы он обновил свой хендл.
    if (/closed|Target page|context or browser/.test(текст)) {
      try {
        return await вкладка("https://kwork.ru/projects?c=all", page);
      } catch {}
    }
    return page;
  }
}

async function pollFabraStatuses() {
  if (ПРИЁМНИК !== "fabra" || !FABRA_READY || Date.now() - lastFabraStatusPoll < 20_000) return;
  lastFabraStatusPoll = Date.now();
  try {
    const since = fabraState.cursor
      ? new Date(Math.max(0, Date.parse(fabraState.cursor) - 1_000)).toISOString()
      : undefined;
    const response = await FABRA.getProjects({ since, limit: 100 });
    if (!response?.ok || !Array.isArray(response.projects)) throw new Error("Fabra вернула некорректный список статусов");
    const notices: string[] = [];
    let cursorMs = parseApiTimestamp(fabraState.cursor) || 0;
    for (const project of response.projects) {
      if (!project?.source || !project?.external_id) continue;
      const key = marketplaceKey(project.source, project.external_id);
      const next: FabraProjectState = normalizeFabraProjectStatus(project);
      const previous = fabraState.projects[key];
      if (previous) {
        const oldOrderStatus = previous.order_status || previous.fabra_status || previous.status;
        const newOrderStatus = next.order_status || next.fabra_status || next.status;
        const statusChanged = oldOrderStatus !== newOrderStatus || previous.source_status !== next.source_status;
        const hasRecommendationFields = Object.prototype.hasOwnProperty.call(previous, "suggested_agent_slug");
        const recommendationChanged = hasRecommendationFields && previous.suggested_agent_slug !== next.suggested_agent_slug;
        const assignmentChanged = hasRecommendationFields && previous.agent_slug !== next.agent_slug;
        // Шумовые стадии: сервер проставляет их подряд всем карточкам, в ТГ
        // их не пушим. В список добавлен awaiting_customer — им сыпалась
        // лента по 7-8 однотипных сообщений в минуту, и это ровно то, что
        // «новый отклик отправлен», а не новость для человека.
        const информативно = Boolean(next.agent_slug || next.suggested_agent_slug || next.candidate_category);
        const ШУМНЫЕ_СТАТУСЫ = ["new", "analyze", "deferred", "awaiting_customer", "received"];
        const шум = ШУМНЫЕ_СТАТУСЫ.includes(newOrderStatus) && !информативно;
        if ((statusChanged || recommendationChanged || assignmentChanged) && !шум) {
          notices.push(`Fabra ${project.source} ${project.external_id}: статус ${newOrderStatus || "?"}; агент ${next.agent_slug || "—"}; рекомендация ${next.suggested_agent_slug || "—"}; категория ${next.candidate_category || "—"}; цена ${next.price ?? "?"} ${next.currency}`);
        }
      }
      fabraState.projects[key] = next;
      const timestamp = parseApiTimestamp(next.updated_at);
      if (Number.isFinite(timestamp) && timestamp > cursorMs) cursorMs = timestamp;
    }
    if (cursorMs > 0) fabraState.cursor = new Date(cursorMs).toISOString();
    else if (!fabraState.cursor) fabraState.cursor = new Date().toISOString();
    await Bun.write(FABRA_STATE_FILE, JSON.stringify(fabraState, null, 2));
    if (lastFabraStatusError && !МОЛЧА) await тг.послать("Связь с Fabra восстановлена; продолжаю опрашивать статусы.").catch(() => {});
    lastFabraStatusError = "";
    if (notices.length && !МОЛЧА) await тг.послать(notices.join("\n")).catch(() => {});
  } catch (e) {
    const reason = String(e).slice(0, 180);
    if (reason !== lastFabraStatusError) {
      console.log(`Fabra status poll failed: ${reason}`);
      if (!МОЛЧА) await тг.послать(`Не удалось опросить Fabra: ${reason}`).catch(() => {});
      lastFabraStatusError = reason;
    }
  }
}

let круг = 0;
for (;;) {
  круг++;
  if (wz) try {
    // Лента обновляется AJAX-запросом страницы — БЕЗ reload.
    // Раньше каждые 2 круга перезагружали всю страницу, из-за чего вкладка
    // мигала и теряла CDP-сессию. Эндпоинт /api/order/v6/list/open
    // отдаёт тот же набор заказов (60+) с полями subject/description/price.
    let карточки = await обновить_wz_ajax(wz).catch(() => [] as any[]);
    if (!карточки.length) карточки = await снять_wz(wz); // fallback на DOM
    await отметитьЛенту("workzilla", wz, карточки.length);
    await разобрать(карточки, "wz");
  } catch (e) {
    await отметитьЛенту("workzilla", wz, 0, String(e).slice(0, 180));
    try { wz = await вкладка("https://client.work-zilla.com/freelancer", wz); } catch {}
  }
  // Лента не открылась при старте (вкладка() упала) — пробуем поднять её
  // заново, иначе биржа молчит до перезапуска процесса.
  if (!wz && НУЖНА("wz")) {
    try { wz = await вкладка("https://client.work-zilla.com/freelancer"); } catch {}
  }

  if (is) try {
    const карточки = await снять_is_с_догрузкой(is);
    await отметитьЛенту("insolvo", is, карточки.length);
    await разобрать(карточки, "is");
  } catch (e) {
    await отметитьЛенту("insolvo", is, 0, String(e).slice(0, 180));
    try { is = await вкладка("https://client.insolvo.com/freelancer", is); } catch {}
  }
  if (!is && НУЖНА("is")) {
    try { is = await вкладка("https://client.insolvo.com/freelancer"); } catch {}
  }

  // Sandbox опрашивается каждый круг: это наш источник, скорость не важна.
  if (sb) try {
    await sb.reload({ waitUntil: "domcontentloaded" });
    const карточки = await снять_sb(sb);
    await отметитьЛенту("sandbox", sb, карточки.length);
    await разобрать(карточки, "sb");
  } catch (e) {
    await отметитьЛенту("sandbox", sb, 0, String(e).slice(0, 180));
    // Пересоздаём вкладку: её могла закрыть чистка неактивных вкладок
    // (localhost в whitelist не входит), а reload на закрытой странице
    // всегда падает с "Target page has been closed" — и без этого блока
    // песочница молчала бы до перезапуска парсера.
    try { sb = await вкладка(SANDBOX_BOARD, sb); } catch {}
  }

  if (kw && круг % KWORK_КАЖДЫЙ === 0)
    // Kwork сам не обновляет ленту: без перезагрузки страницы висели бы
    // одни и те же проекты с первой загрузки.
    try {
      await kw.reload({ waitUntil: "domcontentloaded" });
      await Bun.sleep(4000);
      const карточки = await снять_kw_страницы(kw, Number(process.env.ПАРСЕР_KW_СТРАНИЦ ?? 3));
      await отметитьЛенту("kwork_projects", kw, карточки.length);
      await разобрать(карточки, "kw");
    }
    catch (e) {
      await отметитьЛенту("kwork_projects", kw, 0, String(e).slice(0, 180));
      try { kw = await вкладка("https://kwork.ru/projects?c=all", kw); } catch {}
    }
    kw = (await проверитьМоиКворки(kw)) ?? kw;
  await pollFabraStatuses();
  if (круг % 120 === 0) console.log(`[${new Date().toTimeString().slice(0, 5)}] просмотрено ${просмотрено}, отправлено ${найдено}`);

  // Берём вкладки под контроль: закрываем лишние после каждого цикла.
  // Лимит 8 (не 4): меньше нельзя — парсеру нужны свои ленты, а монитор
  // чата держит вкладку задания. Больше нельзя — вкладки копятся, Chrome
  // ест память, CDP-порт перестаёт отвечать и весь контур встаёт.
  await closeInactiveTabs(8).catch(() => {});

  await Bun.sleep(ШАГ_МС);
}
