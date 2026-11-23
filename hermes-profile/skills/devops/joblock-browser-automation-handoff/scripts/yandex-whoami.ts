/**
 * Подтверждение: в каком аккаунте сидит профиль и закреплён ли он.
 * Читаем личный кабинет Яндекс ID и ищем логин/имя.
 *
 *   bun yandex-whoami.ts <cdpPort>
 */
import { chromium } from "playwright";

const порт = process.argv[2];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${порт}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());

for (const адрес of [
  "https://id.yandex.ru/profile",
  "https://passport.yandex.ru/profile",
  "https://yandex.ru/collections",
]) {
  try {
    await page.goto(адрес, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(4000);
    const t = await page.evaluate(() => document.body?.innerText ?? "");
    console.log(`\n=== ${адрес}`);
    console.log("   url:", page.url().slice(0, 110));
    console.log("   заголовок:", (await page.title()).slice(0, 60));
    // Ищем логины вида delaneysheke / herveyrid0ri / mnommathia
    const логины = t.match(/delaneysheke|herveyrid0ri|mnommathia|dorcasizlsantor|huongwip7q|whitleyvankctl|marleejawlap1|nellaxafus|hyonvagle7lx/gi);
    console.log("   наш логин на странице:", логины ? [...new Set(логины)].join(", ") : "не найден");
    console.log("   текст:", t.replace(/\s+/g, " ").slice(0, 320));
  } catch (e) {
    console.log(`\n=== ${адрес}: ошибка ${String(e).slice(0, 120)}`);
  }
}

// НЕ вызываем browser.close(): по CDP это закрывает общий контекст видимого
// Chrome и рвёт вкладки других скриптов (мониторы чата).
process.exit(0);
