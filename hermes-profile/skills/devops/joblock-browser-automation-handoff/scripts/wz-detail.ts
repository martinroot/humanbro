// Этап 2: детали ОДНОГО заказа — полное ТЗ + вложения.
// Отдельный процесс, чтобы портал не тянул playwright, а биржа видела
// ровно один переход на нужный заказ вместо страницы каждого в ленте.
//
// ДВА БАГА, из-за которых этап 2 «висел» (18.11):
//   1) `page.waitForFunction(fn, { timeout })` — второй аргумент это АРГУМЕНТ
//      функции, а не опции. Таймаут не применялся, и ожидание картинок жило
//      дефолтные 60 с вместо 12. Правильно: `waitForFunction(fn, undefined, {timeout})`.
//   3) Заглушка «Задание больше недоступно» рендерится ПОЗЖЕ события load,
//      поэтому проверять её один раз сразу после load бесполезно: заказ
//      считался живым, и мы ждали описание+картинки ~80 с впустую.
//      Теперь ждём ОДНО из двух (описание или заглушка) и выходим сразу.
//
//   bun wz-detail.ts <source> <external_id> <url>
import { attachToVisible, shutdown } from "./browser";
import { collectAttachments } from "./marketplace-attachments";

const [, , source, externalId, url] = process.argv;
if (!source || !externalId || !url) {
  console.log(JSON.stringify({ ok: false, error: "usage: wz-detail.ts <source> <id> <url>" }));
  process.exit(1);
}

/** Ждём одно из двух: описание заказа ИЛИ заглушка «недоступно».
 *  Bot API не отдаёт историю, поэтому опираемся на то, что видим в DOM. */
async function waitDescriptionOrClosed(page: any, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const hasDescription = Boolean(document.querySelector(
        ".description-content, .order-description, .fl-project-content__description"));
      const closed = /Задание больше недоступно|order-not-available-stub/i.test(
        (document.body?.innerText || "") + " " + (document.body?.innerHTML || ""));
      return { hasDescription, closed };
    }).catch(() => ({ hasDescription: false, closed: false }));
    if (state.closed) return { hasDescription: false, closed: true };
    if (state.hasDescription) return { hasDescription: true, closed: false };
    await page.waitForTimeout(500);
  }
  return { hasDescription: false, closed: false };
}

const ctx = await attachToVisible();
const page = await ctx.newPage();
const t0 = Date.now();
const log = (msg: string) => {
  if (process.env.PARSER_DEBUG_ATTACH === "1") console.error(`[detail ${Date.now() - t0}ms] ${msg}`);
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  log("domcontentloaded");
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => log("load timeout"));

  // Главное ожидание: описание ИЛИ заглушка. Не ждём селектор описания
  // вслепую — на закрытых заказах его не будет никогда.
  const state = await waitDescriptionOrClosed(page, 15_000);
  log(`state: desc=${state.hasDescription} closed=${state.closed}`);

  if (state.closed) {
    // Заказ закрыт биржей: ни описания, ни файлов не будет. Выходим сразу.
    log("order closed by exchange — early exit");
    console.log(JSON.stringify({ ok: true, closed: true, full_description: "", attachments: [] }));
    await page.close().catch(() => {});
    await shutdown();
    process.exit(0);
  }
  if (!state.hasDescription) {
    console.log(JSON.stringify({ ok: false, error: "описание заказа не найдено в DOM" }));
    await page.close().catch(() => {});
    await shutdown();
    process.exit(0);
  }

  // Картинки заказа лежат в /storage и приходят ПОЗЖЕ описания. Ждём, пока
  // каждая реально загрузится. ВНИМАНИЕ: третий аргумент — опции, второй
  // был бы аргументом функции (из-за этого таймаут не работал).
  const imagesReady = await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".order-description img")]
      .filter(i => /\/storage\//.test(i.src) && !/avatar/i.test(i.src));
    if (!imgs.length) return true;          // файлов нет — это нормально
    return imgs.every(i => i.complete && i.naturalWidth > 0);
  }, undefined, { timeout: 10_000 }).then(() => true).catch(() => false);
  log("images ready=" + imagesReady);

  // Короткая страховка на ленивые секции описания.
  await page.waitForTimeout(imagesReady ? 1_000 : 2_000);

  const html = await page.evaluate(() => "<!DOCTYPE html>\n" + document.documentElement.outerHTML);
  const full = await page.evaluate(() => {
    const el = document.querySelector(".description-content")
      || document.querySelector(".order-description")
      || document.querySelector(".fl-project-content__description");
    return (el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 6000);
  });

  // Файлы забираем СРАЗУ, пока вкладка открыта и авторизована.
  const prefix = source.toUpperCase() + "-";
  const normalized = String(externalId).toUpperCase().startsWith(prefix)
    ? String(externalId).slice(prefix.length) : String(externalId);
  const attachments = await collectAttachments(
    page, html, url, prefix.replace("-", ""), `${prefix}${normalized}`);
  log(`attachments=${attachments.length} html=${html.length}`);

  console.log(JSON.stringify({
    ok: true,
    full_description: full,
    attachments: attachments.map(a => ({
      name: a.name, path: a.path, url: a.url, mime_type: a.mime_type, size: a.size,
    })),
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error).slice(0, 200) }));
} finally {
  await page.close().catch(() => {});
  await shutdown();
}