import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { shouldKeepMarketplaceTab } from "./marketplace-monitor-core";
import { selectResponsePage } from "./workzilla-response.ts";
import { порогУборки } from "./tab-budget.ts";
import { isRecent } from "./response-hold.ts";

/**
 * Один общий браузер на процесс. Контекст на задачу — изолированные
 * куки/сторедж, но без цены отдельного процесса Chrome.
 * На этой машине (2 vCPU / 4 GB) больше 4 параллельных задач не имеет смысла:
 * упираемся в CPU раньше, чем в память.
 */
const MAX_PARALLEL = 4;

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",   // иначе Chrome падает на маленьком /dev/shm
      "--no-sandbox",              // мы и так под Administrator в VM
      "--disable-gpu",             // GPU тут нет физически
    ],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/**
 * Закрывает браузер и завершает процесс.
 *
 * Нужен костыль process.exit: под bun после параллельного создания контекстов
 * (mapPages) остаётся висящий хендл, и процесс не выходит сам, хотя
 * browser.close() уже отработал и Chrome убит. Проверено: последовательный
 * withPage выходит чисто, параллельный mapPages — виснет навсегда.
 * Вызывайте shutdown() последней строкой скрипта.
 */
export async function shutdown(code = 0): Promise<never> {
  await closeBrowser();
  await closeVisible();
  process.exit(code);
}

const DEFAULT_CONTEXT = {
  viewport: { width: 1366, height: 768 },
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
};

/** Выполняет fn в свежем контексте и гарантированно его закрывает. */
export async function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: Parameters<Browser["newContext"]>[0] = {},
): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext({ ...DEFAULT_CONTEXT, ...opts });
  ctx.setDefaultTimeout(30_000);
  try {
    return await fn(await ctx.newPage(), ctx);
  } finally {
    await ctx.close();
  }
}

/** Прогоняет задачи пачками по MAX_PARALLEL, сохраняя порядок результатов. */
export async function mapPages<I, O>(
  items: I[],
  fn: (item: I, page: Page) => Promise<O>,
  parallel = MAX_PARALLEL,
): Promise<PromiseSettledResult<O>[]> {
  const out: PromiseSettledResult<O>[] = [];
  for (let i = 0; i < items.length; i += parallel) {
    const batch = items.slice(i, i + parallel);
    out.push(
      ...(await Promise.allSettled(
        batch.map((item) => withPage((page) => fn(item, page))),
      )),
    );
  }
  return out;
}

/** Блокирует картинки/шрифты/медиа — на слабом канале ускоряет в разы. */
export async function blockHeavyAssets(ctx: BrowserContext): Promise<void> {
  await ctx.route("**/*", (route) =>
    ["image", "font", "media"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
}

/**
 * Подключается к Chrome, который пользователь запустил сам, вместо того
 * чтобы поднимать свой. Окно видно по RDP, профиль/куки/логины — родные.
 *
 * Запуск Chrome под автоматизацию (в отдельном окне терминала):
 *   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
 *       --remote-debugging-port=9222 `
 *       --user-data-dir="C:\chrome-automation"
 *
 * Отдельный --user-data-dir обязателен: с обычным профилем Chrome просто
 * передаст аргументы уже запущенному экземпляру и порт не откроется.
 */
export async function connectToRunningChrome(port = 9222): Promise<Browser> {
  return chromium.connectOverCDP(`http://localhost:${port}`);
}

/* ------------------------------------------------------------------ *
 * Видимое окно с постоянным профилем                                  *
 * ------------------------------------------------------------------ */

/**
 * Папка профиля. Здесь Chrome держит куки, localStorage, пароли — всё, что
 * делает сессию сессией. Переживает перезапуск скрипта: залогинились руками
 * один раз, дальше скрипт заходит уже своим.
 *
 * Лежит вне проекта, чтобы не попасть под чистку node_modules.
 */
export const PROFILE_DIR = "C:/chrome-profile";

let visible: BrowserContext | null = null;

/**
 * Видимое окно Chrome с постоянным профилем (одно на процесс).
 *
 * Не launch(), а launchPersistentContext(): обычный launch поднимает
 * одноразовый профиль во временной папке и стирает его при закрытии — то
 * есть ровно то, чего мы не хотим.
 *
 * Берём настоящий Chrome (channel), а не встроенный Chromium: часть сайтов,
 * Google в первую очередь, из Chromium в аккаунт не пускает вообще.
 *
 * Внимание: headed-браузеру нужен живой рабочий стол. Если отключиться от
 * RDP-сессии посреди прогона, отрисовка встаёт и скрипт может зависнуть.
 */
export async function getVisibleContext(
  opts: Parameters<typeof chromium.launchPersistentContext>[1] = {},
): Promise<BrowserContext> {
  if (visible) return visible;

  visible = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    slowMo: 250,            // пауза между действиями, чтобы успевать глазами
    viewport: null,         // страница по размеру окна, а не 1280x720 внутри него
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    args: [
      "--start-maximized",
      "--remote-debugging-port=9222",   // чтобы другие скрипты могли подключиться к этому же окну
      "--hide-crash-restore-bubble",              // не спрашивать «восстановить вкладки?»
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],   // убирает жёлтую плашку сверху
    ...opts,
  });

  visible.setDefaultTimeout(60_000);   // руками логинимся не спеша
  return visible;
}

/**
 * Выполняет fn в видимом окне. Контекст НЕ закрывается: профиль общий,
 * закрывает его тот, кто завершает работу, — shutdown().
 *
 * Первую вкладку персистентный контекст открывает сам — переиспользуем её,
 * иначе с каждым запуском копится пустой about:blank.
 */
export async function withVisiblePage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await getVisibleContext();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return fn(page, ctx);
}

/**
 * Отключаемся от видимого Chrome, НЕ закрывая его.
 *
 * ВАЖНО: browser.close() у браузера, подключённого по CDP, закрывает общий
 * контекст и рвёт вкладки ВСЕХ, кто к этому Chrome подключён. Так терялись
 * мониторы чата: отработал один скрипт с close() — и вкладка другого стала
 * «Target page, context or browser has been closed». Видимый Chrome должен
 * жить, пока жив сам процесс: закрывает его только владелец.
 */
export async function closeVisible(): Promise<void> {
  visible = null;
}

/**
 * Держит скрипт, пока в терминале не нажмут Enter. Для ручной авторизации:
 * скрипт ждёт, вы логинитесь в открытом окне, Enter — профиль сохранён.
 */
export async function waitForEnter(
  msg = "Залогиньтесь в окне браузера и нажмите Enter...",
): Promise<void> {
  process.stdout.write(`\n${msg}\n`);
  for await (const _line of console) break;   // одна строка из stdin
}

/* ------------------------------------------------------------------ *
 * Подключение к уже открытому окну                                    *
 * ------------------------------------------------------------------ */

/**
 * Chrome не даёт двум процессам держать одну папку профиля: пока окно
 * открыто, второй скрипт просто не стартует. Поэтому окно поднимает кто-то
 * один (serve.ts), а остальные скрипты подключаются к нему по CDP и работают
 * в тех же вкладках, с теми же куками.
 */
let attached: Browser | null = null;

export async function attachToVisible(port = 9222): Promise<BrowserContext> {
  if (!attached?.isConnected()) {
    try {
      attached = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { slowMo: 150 });
    } catch {
      throw new Error(`Порт ${port} молчит — окно не открыто. Запустите: bun serve.ts`);
    }
  }
  // У персистентного профиля контекст ровно один — он же и есть профиль.
  const ctx = attached.contexts()[0];
  if (!ctx) throw new Error("Браузер на порту есть, а контекста в нём нет.");
  ctx.setDefaultTimeout(60_000);
  заблокироватьМусор(ctx);
  return ctx;
}

/**
 * Глушит виджеты, которые ничего не дают ленте, но стоят памяти.
 *
 * На трёх биржах висело 6 фреймов Stripe (js.stripe.com и m.stripe.network) —
 * платёжные виджеты, к которым лента не ходит. Каждый тянет скрипты с
 * внешнего CDN и живёт все часы работы окна. На 4 ГБ это была заметная часть
 * утечки, поэтому блокируем их и аналитику.
 *
 * ВАЖНО: блокируется только явно бесполезное. Картинки и шрифты не трогаем —
 * на странице задания заказчик может приложить превью, и без них мы не поймём,
 * что именно просят.
 */
const МУСОРНЫЕ_ХОСТЫ = [
  "js.stripe.com",
  "m.stripe.com",
  "m.stripe.network",
  "js.stripe.network",
  "www.google-analytics.com",
  "google-analytics.com",
  "mc.yandex.ru",
  "top-fwz1.mail.ru",
];

let правилоУстановлено = false;

function заблокироватьМусор(ctx: BrowserContext): void {
  if (правилоУстановлено) return;
  правилоУстановлено = true;
  ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (МУСОРНЫЕ_ХОСТЫ.some((h) => url.includes(h))) {
      route.abort().catch(() => {});
      return;
    }
    route.continue().catch(() => {});
  }).catch(() => {
    // Правило не завелось — не повод ронять парсер, работаем без блокировки.
    правилоУстановлено = false;
  });
}

/**
 * Открывает новую вкладку в уже запущенном окне и работает в ней.
 * Вкладку не закрываем: пусть результат остаётся на экране.
 */
export async function withAttachedPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await attachToVisible();
  // Чистим вкладки ДО создания новой: иначе closeInactiveTabs примет
  // пустую about:blank только что созданной вкладки за мусор и закроет её,
  // и первый же goto упадёт с "Target page has been closed".
  // Сколько вкладок оставляем открытыми. Раньше было жёстко 4, и человек,
  // сидящий за этим окном, не видел почти ничего: карточные вкладки
  // закрывались сразу после чтения, а открывались на пару секунд.
  // Теперь держим запас (по умолчанию 15), чтобы работа была видна глазами,
  // а не только в логе. Менять без нужды не стоит — вкладки копятся.
  const KEEP_ВКЛАДОК = Number(process.env.KEEP_TABS || 8);
  await closeInactiveTabs(KEEP_ВКЛАДОК).catch(() => {});
  const page = await ctx.newPage();
  // Помечаем вкладку как ЗАНЯТУЮ. Уборка (tidy-tabs.ts) идёт по другому
  // процессу и без этой метки закрывала свежеоткрытую вкладку отклика —
  // клик падал с "Target page, context or browser has been closed".
  // ВАЖНО: флаг ставим через addInitScript, а НЕ через page.evaluate:
  // evaluate пишет метку в документ about:blank, а первый же page.goto()
  // внутри fn уничтожает его — навигацией документ заменяется, флаг
  // теряется, и уборка снова считает вкладку свободной и закрывает её
  // посреди работы (строки fn в братьев-скриптов падали на evaluate
  // с "Target page ... has been closed"). addInitScript выполняется на
  // КАЖДОМ новом документе вкладки, поэтому метка переживает навигацию.
  await page.addInitScript(() => {
    (window as any).__hermesBusy = true;
  }).catch(() => {});
  try {
    return await fn(page, ctx);
  } finally {
    // Вкладку закрываем НЕ СРАЗУ.
    //
    // 22.10 (владелец): «Ты там быстро закрываешь, что тут никакая MLL
    // не успеет среагировать». Работа (отклик, чтение заказа, снимок
    // карточки) делалась в отдельной вкладке, и она закрывалась в тот же
    // миллисекунд — посмотреть на результат было невозможно.
    //
    // Поэтому: вкладка ждёт ЗАДЕРЖКУ (по умолчанию 3 минуты), и только
    // потом её подбирает уборка. Пока она живёт, её не трогают ни
    // closeInactiveTabs, ни tidy-tabs (свежая/занятая метка).
    //
    // Раньше вкладку закрывали мгновенно, и это же было причиной утечки
    // вкладок: каждая попытка оставляла свою. Теперь закрытие отложенное
    // и централизованное — уборка забирает вкладки старше задержки.
    const ЗАДЕРЖКА_СЕК = Number(process.env.TAB_HOLD_SEC || 180);
    if (ЗАДЕРЖКА_СЕК > 0) {
      // Помечаем вкладку как «на показу»: снимаем busy-метку, чтобы её
      // не считали занятой, но ставим метку удержания.
      await page.addInitScript(() => {
        (window as any).__hermesHold = true;
      }).catch(() => {});
      // Ждём конца задержки, затем закрываем. Скрипт остаётся жив — это
      // ровно то, что нужно: вкладка видна, пока идёт работа с ней.
      await new Promise((r) => setTimeout(r, ЗАДЕРЖКА_СЕК * 1000)).catch(() => {});
    }
    await page.close().catch(() => {});
  }
}

export async function withResponsePage<T>(
  externalId: string,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  options: { attach?: () => Promise<BrowserContext>; writeGuard?: boolean } = {},
): Promise<T> {
  const id = String(externalId || "");
  if (!/^\d+$/.test(id)) throw new Error("Некорректный Workzilla ID отклика");
  const ctx = await (options.attach ?? attachToVisible)();
  const selection = selectResponsePage(ctx.pages(), id);
  for (const duplicate of selection.duplicates) await duplicate.close().catch(() => {});
  const existing = selection.target as Page | null;
  const page = existing ?? await ctx.newPage();
  await page.addInitScript(() => { (window as any).__hermesBusy = true; }).catch(() => {});
  await page.evaluate(() => { (window as any).__hermesBusy = true; }).catch(() => {});
  const guardPath = `${import.meta.dir}/tab-guard.json`;
  if (options.writeGuard !== false) {
    await Bun.write(guardPath, JSON.stringify({ ts: new Date().toISOString(), id }));
  }
  try {
    await page.bringToFront().catch(() => {});
    if (!existing) {
      await page.goto(`https://client.work-zilla.com/freelancer/${id}?from=detail`, {
        waitUntil: "domcontentloaded",
      });
    }
    return await fn(page, ctx);
  } finally {
    await page.evaluate(() => { delete (window as any).__hermesBusy; }).catch(() => {});
    if (options.writeGuard !== false) {
      const guard = await Bun.file(guardPath).json().catch(() => null);
      if (String(guard?.id || "") === id) await Bun.file(guardPath).delete().catch(() => {});
    }
  }
}

/** Уборка вкладок: закрывает всё, что не нужно текущему режиму. */
export async function closeInactiveTabs(keep = 4): Promise<number> {
  try {
    // Замок отклика: bid.ts/kwork-bid.ts держат вкладку с формой открытой,
    // а парсер каждую минуту вычищает "немониторные" вкладки — и закрывал
    // форму посреди заполнения.
    // Раньше свежий замок ОТМЕНЯЛ чистку целиком (return 0). При откликах
    // каждые 5 минут замок был свежим всегда, и чистка не выполнялась НИ
    // РАЗУ: вкладки копились до 65, Chrome ел память, CDP-порт зависал.
    // Теперь замок защищает только СВОЮ вкладку — остальное чистится.
    const защищённыеОтклик = new Set<string>();
    try {
      const guard = `${import.meta.dir}/tab-guard.json`;
      const guardData = await Bun.file(guard).json().catch(() => null);
      if (guardData && Date.now() - Date.parse(guardData.ts) < 10 * 60_000 && guardData.id) {
        защищённыеОтклик.add(String(guardData.id));
      }
    } catch {}

    // Замок чата: монитор watch-chat.ts держит вкладку задания
    // (/freelancer/<id>), а такая вкладка для чистки считается мусором —
    // её закрывали, и опрос падал с "Target page has been closed".
    // Каждый монитор пишет свой файл tab-guard-chat-<id>.json; читаем все.
    const защищённые = new Set<string>();
    try {
      const dir = import.meta.dir;
      for (const f of Array.from(new Bun.Glob("tab-guard-*.json").scanSync(dir))) {
        const g = await Bun.file(`${dir}/${f}`).json().catch(() => null);
        if (g && Date.now() - Date.parse(g.ts) < 5 * 60_000) {
          for (const id of g.ids ?? []) защищённые.add(String(id));
          if (g.id) защищённые.add(String(g.id));
        }
      }
    } catch {}
    const ctx = await attachToVisible().catch(() => null);
    if (!ctx) return 0;
    let pages = ctx.pages();

    // ЖИВЫЕ ВКЛАДКИ РЕЖИМА. Файл reviews/data/keep-tabs.json пишет
    // reviews/mode.py: в нём URL-паттерны вкладок, которые нужны текущему
    // режиму (ленты в режиме «Поиск», чат заказа в режиме «Общение»).
    // Без этого уборка закрывала ленты, парсеры открывали их заново —
    // экран моргал бесконечно, и разобраться, что происходит, было невозможно.
    const живыеПаттерны: string[] = [];
    try {
      const k = await Bun.file(`${import.meta.dir}/reviews/data/keep-tabs.json`).json().catch(() => null);
      if (k && Array.isArray(k.паттерны)) живыеПаттерны.push(...k.паттерны);
    } catch {}
    const живая = (url: string) => живыеПаттерны.some((p) => url.includes(p));

    // ПОРОГ УБОРКИ. 17.11 владелец: «6 пустых вкладок открываются, что-то их
    // закрывает и так по кругу, как будто индекс теряется». Уборка резала окно
    // до keep=8, а живых лент в поиске 6 + монитор + страховка + вкладки
    // заказов. Каждый тик парсера урезал ниже нужного, «возврат вкладок» их
    // открывал заново — и так по кругу. Никогда не режем ниже нужного.
    const порог = порогУборки(keep, живыеПаттерны.length);
    if (pages.length <= порог) return 0;

    // ЗАКЛАДКИ: вкладка задания, по которому идёт работа, не закрывается
    // НИКОГДА, пока заказ не сдан. Владелец (22.10): «Она вообще не должна
    // закрываться, пока мы не выполним заказ. Она всегда должна быть
    // активна в хроме, идем в Dolphin выполняем, затем возвращаемся в хром
    // и уже вставляем скрины». Метки лежат в tab-hold.json.
    let заложенные: string[] = [];
    try {
      const h = await Bun.file(`${import.meta.dir}/tab-hold.json`).json().catch(() => null);
      if (h && h.закладки) заложенные = Object.keys(h.закладки).map(String);
    } catch {}
    const подЗакладкой = (url: string) => {
      const m = url.match(/client\.work-zilla\.com\/freelancer\/(\d+)/);
      return Boolean(m && заложенные.includes(String(m[1])));
    };

    if (pages.length <= keep) return 0;

    let closed = 0;

    // Сначала закрываем все about:blank и пустые.
    // Если работает монитор чата, about:blank трогать нельзя: его вкладка
    // между newPage() и goto() выглядит именно как about:blank, и её закрывали
    // в этот момент — опрос падал с "Target page has been closed".
    for (const p of pages) {
      if (защищённые.size > 0) break;
      const url = (p.url() || "").trim();
      if (url === "" || url === "about:blank" || url === "about:blank#blocked") {
        // Пустая вкладка, нужная текущему режиму, — не мусор.
        if (живая(url)) continue;
        if (подЗакладкой(url)) continue;
        try { await p.close().catch(() => {}); closed++; } catch {}
      }
    }
    pages = ctx.pages(); // refresh

    // Затем закрываем старые неважные, пока не останется порог
    while (pages.length > порог) {
      let closedThisRound = false;
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const url = p.url() || "";
        // Вкладка задания под замком чата — не мусор.
        const m = url.match(/client\.work-zilla\.com\/freelancer\/(\d+)/);
        if (m && (защищённые.has(m[1]) || защищённыеОтклик.has(m[1]))) continue;
        // Вкладка, нужная текущему режиму (ленты в «Поиске», чат заказа в
        // «Общении»), не трогается. Иначе ленты закрывались и открывались
        // заново каждый круг — экран моргал, и работа выглядела случайной.
        if (живая(url)) continue;
        // Закладка: вкладка рабочего заказа не трогаем НИКОГДА.
        if (подЗакладкой(url)) continue;
        if (shouldKeepMarketplaceTab(url)) continue;
        // Вкладка заказа, по которому только что ответили: владелец должен
        // успеть увидеть результат (17.11: «моментально закрывается»).
        const недавний = url.match(/client\.work-zilla\.com\/freelancer\/(\d+)/);
        if (недавний && isRecent(недавний[1])) continue;
        // Свежая вкладка: скрипт только что её открыл и работает в ней.
        // Закрывать такую — значит обрывать чужую работу на середине.
        let свежая = false;
        try {
          const возраст = await p.evaluate(() =>
            Date.now() - (performance.timeOrigin || Date.now()));
          свежая = возраст < 60_000;
        } catch {}
        // Занятая вкладка (withAttachedPage поставил метку через
        // addInitScript — она переживает навигацию): её трогать нельзя,
        // даже если возраст больше порога свежести.
        if (свежая) continue;
        try {
          const занята = await p.evaluate(() => Boolean((window as any).__hermesBusy))
            .catch(() => false);
          if (занята) continue;
        } catch {}
        try {
          await p.close().catch(() => {});
          closed++;
          closedThisRound = true;
          break; // refresh list
        } catch {}
      }
      if (!closedThisRound) break; // ничего не закрыли, выходим
      pages = ctx.pages();
    }

    if (closed > 0) console.log(`[browser] закрыто ${closed} неактивных вкладок, осталось ${ctx.pages().length}`);

    // Возвращаем вкладку парсера, если её только что закрыли. Иначе лента
    // вылетает каждый круг: парсер держит хендл на закрытую страницу, и все
    // последующие evaluate() падают с "Target page, context or browser has
    // been closed". Открываем заново — дешевле, чем искать, кто именно её
    // закрыл: keeper, другой скрипт или пользователь в общем окне.
    //
    // ВАЖНО: открываем только то, что нужно ТЕКУЩЕМУ РЕЖИМУ. Раньше список
    // был фиксированным (3 ленты + доска) и срабатывал при каждой уборке в
    // любом режиме — поэтому в режиме «Общение» или «Исполнение» ленты
    // открывались заново и тут же закрывались. Отсюда было «всё моргает».
    try {
      const МОНИТОР = живыеПаттерны.length
        ? живыеПаттерны.filter((p) => !p.includes("/freelancer/"))
        : [];
      if (МОНИТОР.length) {
        const живые = ctx.pages().map((p) => (p.url() || "").split("?")[0].replace(/\/$/, ""));
        for (const адрес of МОНИТОР) {
          const чистый = адрес.split("?")[0].replace(/\/$/, "");
          if (!живые.includes(чистый)) {
            const p = await ctx.newPage();
            await p.goto(адрес, { waitUntil: "domcontentloaded" }).catch(() => {});
            console.log(`[browser] вернул вкладку ${адрес}`);
          }
        }
      }
    } catch {}

    return closed;
  } catch {
    return 0;
  }
}
