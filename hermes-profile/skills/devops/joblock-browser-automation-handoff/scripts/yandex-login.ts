/**
 * Вход в Яндекс в профиле Dolphin через CDP.
 *
 * Учётные данные берём из реестра (`registry.py export-creds`) — пароль
 * в коде не появляется и не печатается.
 *
 * Логика шагов ведётся по URL, а не по наличию полей: на странице входа
 * тоже есть текстовое поле, и прежняя версия вводила код 2FA в поле
 * логина, теряя вход. Порядок челленджей Яндекса:
 *   1. логин (по умолчанию просит телефон — логин подставляется в URL),
 *   2. пароль,
 *   3. контрольный вопрос (ответ из поставки) либо код 2FA,
 *   4. предложение входа по лицу — жмём «Напомнить позже».
 *
 *   bun yandex-login.ts <profileCdpPort> <accountId>
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const порт = process.argv[2];
const аккаунт = process.argv[3] ?? "2";
if (!порт) {
  console.log("usage: bun yandex-login.ts <cdpPort> <accountId>");
  process.exit(1);
}

const РЕЕСТР = "C:/Users/Administrator/browser-automation/reviews/registry.py";
const ПИТОН = "C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe";

function учётка(id: string) {
  return JSON.parse(
    execFileSync(ПИТОН, [РЕЕСТР, "export-creds", "--account", id], { encoding: "utf-8" }),
  );
}

function код2fa(id: string): string {
  const out = execFileSync(ПИТОН, [РЕЕСТР, "totp", "--account", id], { encoding: "utf-8" });
  const m = out.match(/(\d{6})/);
  return m ? m[1] : "";
}

const уч = учётка(аккаунт);
console.log(`аккаунт #${аккаунт} логин=${уч.login}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${порт}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());

const текст = () => page.evaluate(() => document.body?.innerText ?? "");

async function снимок(подпись: string) {
  const t = await текст();
  console.log(`\n--- ${подпись}`);
  console.log("    url:", page.url().slice(0, 130));
  console.log("    текст:", t.replace(/\s+/g, " ").slice(0, 230));
  return t;
}

async function нажать(текстКнопки: string[]): Promise<string> {
  for (const надпись of текстКнопки) {
    const кнопка = page.locator(`button:has-text("${надпись}")`).first();
    if (await кнопка.count()) {
      await кнопка.click().catch(() => {});
      return надпись;
    }
  }
  return "";
}

async function ввести(значение: string): Promise<boolean> {
  const поля = page.locator('input[type="text"], input[type="email"], input:not([type])');
  const n = await поля.count();
  for (let i = 0; i < n; i++) {
    const п = поля.nth(i);
    if (!(await п.isVisible().catch(() => false))) continue;
    await п.fill(значение).catch(() => {});
    return true;
  }
  return false;
}

// ── старт: страница входа с логином в URL ──
await page.goto(
  `https://passport.yandex.ru/auth?origin=ya&retpath=https://ya.ru&login=${encodeURIComponent(уч.login)}`,
  { waitUntil: "domcontentloaded", timeout: 45000 },
);
await page.waitForTimeout(4500);

// Если форма всё ещё просит телефон — раскрываем «Ещё» и берём вход по логину.
if (/Введите номер телефона/i.test(await текст())) {
  await нажать(["Ещё"]);
  await page.waitForTimeout(1500);
  const пункт = page.locator("text=Логин, почта, номер телефона, Яндекс ID").first();
  if (await пункт.count()) await пункт.click().catch(() => {});
  else {
    const иначе = page.locator('[role="menuitem"], li, button').filter({ hasText: /^Логин/ }).first();
    if (await иначе.count()) await иначе.click().catch(() => {});
  }
  await page.waitForTimeout(2500);
}
await снимок("страница входа");

// ── шаг 1: логин ──
if (!/pwl-yandex\/auth\/password/.test(page.url())) {
  if (await ввести(уч.login)) {
    const нажато = await нажать(["Войти"]);
    if (!нажато) await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);
  }
  await снимок("после логина");
}

// ── шаг 2: пароль ──
// Шаг определяем по НАЛИЧИЮ поля пароля, а не по URL: у новых аккаунтов
// после логина URL остаётся passport.yandex.ru/auth?...&login=...,
// и старая проверка /pwl-yandex\/auth\/password не срабатывала —
// пароль просто не вводился, аккаунт оставался неавторизованным.
{
  const поле = page.locator('input[type="password"]').first();
  if (await поле.count()) {
    await поле.fill(уч.password).catch(() => {});
    const нажато = await нажать(["Далее", "Войти"]);
    if (!нажато) await page.keyboard.press("Enter");
    await page.waitForTimeout(6000);
  }
  await снимок("после пароля");
}

// ── шаг 3: контрольный вопрос или 2FA ──
// Ветку выбираем по URL: на странице входа тоже есть текстовое поле,
// и прежняя версия вводила в него код 2FA вместо логина.
if (/challenges/.test(page.url())) {
  const t = await текст();
  if (/контрольн|ответ на/i.test(t) && уч.answer) {
    console.log("\nконтрольный вопрос — вводим ответ из поставки");
    await ввести(уч.answer);
  } else {
    const код = код2fa(аккаунт);
    if (код) {
      console.log("\nзапрошен код 2FA — вводим");
      await ввести(код);
    }
  }
  const нажато = await нажать(["Продолжить", "Далее", "Войти"]);
  if (!нажато) await page.keyboard.press("Enter");
  await page.waitForTimeout(6000);
  await снимок("после контрольного вопроса / 2FA");
}

// ── шаг 4: предложение входа по лицу (webauthn) ──
if (/webauthn/i.test(page.url()) || /по лицу или отпечатку/i.test(await текст())) {
  console.log("\nпредложение входа по лицу — откладываем");
  await нажать(["Напомнить позже"]);
  await page.waitForTimeout(6000);
  await снимок("после откладывания входа по лицу");
}

// ── возможен ещё один вызов (Яндекс задаёт их подряд) ──
for (let круг = 0; круг < 3; круг++) {
  if (!/challenges/.test(page.url())) break;
  const t = await текст();
  console.log("\nещё один вызов:", t.replace(/\s+/g, " ").slice(0, 130));
  if (/контрольн|ответ на/i.test(t) && уч.answer) {
    await ввести(уч.answer);
  } else {
    const код = код2fa(аккаунт);
    if (код) await ввести(код);
  }
  const нажато = await нажать(["Продолжить", "Далее", "Войти"]);
  if (!нажато) await page.keyboard.press("Enter");
  await page.waitForTimeout(6000);
  await снимок(`после доп. вызова ${круг + 1}`);
}

// ── проверка результата ──
await page.goto("https://id.yandex.ru/profile", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);
const финал = await текст();
console.log("\n=== итог");
console.log("url:", page.url().slice(0, 120));
const наш = финал.includes(уч.login);
console.log("логин на странице:", наш ? уч.login : "НЕ НАЙДЕН");
console.log("текст:", финал.replace(/\s+/g, " ").slice(0, 300));

process.exit(0);
