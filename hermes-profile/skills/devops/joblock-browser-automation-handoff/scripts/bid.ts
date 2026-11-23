/**
 * Отклик на задание.
 *
 * По правилам биржи заявка — это уже обязательство выполнить работу за
 * указанную цену, а отказ после назначения роняет рейтинг. Поэтому:
 *   - вопросы задаём здесь, в отклике (правила прямо требуют так);
 *   - на запрещённое не откликаемся вообще, проверка встроена и не обходится.
 *
 *   bun bid.ts <id> <файл с текстом отклика> [--принудительно]
 *
 * --принудительно: пропустить гейты классификации/преград/экономики и
 * отправить отклик как есть. Только по прямому приказу владельца на
 * конкретный ID: это его аккаунт и его обязательство.
 */
import { withResponsePage, shutdown } from "./browser";
import { holdSeconds, markRecent } from "./response-hold.ts";
import { fillThenMaybeSend, hasWorkzillaOwnResponseMarker, isTargetWorkzillaPage, parseResponseArgs, responseAction, type ResponseResult } from "./workzilla-response.ts";
import { классифицировать, преграда, требует_чужой_доступ } from "./classify";
import { требуемых_страниц } from "./crew";
import { цена_со_страницы } from "./pipeline";
import { сделка } from "./roi";
import { вердикт_отзывов, type ВердиктОтзывов } from "./review-bridge";

// Текст берём из файла, а не из argv: Git Bash на этой машине не отдаёт
// UTF-8 в аргументах, кириллица приходит как «????».
const cli = parseResponseArgs(process.argv);
const responseMode = cli.fillOnly ? "test" : cli.responseMode;
const globalMode = cli.globalMode;
const ownerApproved = cli.ownerApproved;
const принудительно = process.argv.includes("--принудительно");
const [id, файл] = process.argv.slice(2).filter((а) => !а.startsWith("--"));
if (!id || !файл || !/^\d+$/.test(id)) throw new Error("надо: bun bid.ts <numeric-id> <UTF-8 response file>");
const текст = (await Bun.file(файл).text()).trim();
if (текст.length < 20) throw new Error("response text is empty or too short");
const action = responseAction(responseMode, globalMode, ownerApproved);
if (action === "blocked") {
  console.log("WORKZILLA_RESPONSE_RESULT:" + JSON.stringify({ status: "blocked", submitted: false }));
  await shutdown();
}

let outcome: ResponseResult = { status: "uncertain", submitted: false };

await withResponsePage(id, async (page) => {
  if (!isTargetWorkzillaPage(page.url(), id)) {
    outcome = { status: "closed", submitted: false };
    return;
  }
  // Ждём само описание, а не «две с половиной секунды»: под нагрузкой, когда
  // в браузере несколько вкладок и памяти мало, страница рисуется дольше, и
  // фиксированная пауза заканчивается раньше, чем появляется текст. Один раз
  // мы из-за этого решили, что задание не читается, и пропустили его.
  await page.locator(".description-content").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Берём именно .description-content, а не текст всей страницы: в body
  // попадают соседние блоки и реклама, и классификатор ловит чужие слова —
  // из-за этого чистое задание один раз уехало в «запрещено».
  const задание = await page.evaluate(() => {
    const t = (s: string) => (document.querySelector(s) as HTMLElement)?.innerText?.trim().replace(/\s+/g, " ") ?? "";
    return {
      title: t(".title .text-wrapper") || t("h1"),
      description: t(".description-content"),
      текст_страницы: document.body.innerText,
      файлы: [...document.querySelectorAll(".order-description a[href*='storage']")]
        .map((a) => (a as HTMLElement).innerText.replace(/\s+/g, "")),
      недоступно: /Задание больше недоступно/i.test(document.body.innerText),
      // Репутация заказчика лежит рядом с его именем: a.upvote и a.downvote
      // в блоке communication-assessment-voter.
      плюсы: Number((document.querySelector(".communication-assessment-voter a.upvote") as HTMLElement)?.innerText) || 0,
      минусы: Number((document.querySelector(".communication-assessment-voter a.downvote") as HTMLElement)?.innerText) || 0,
    };
  });
  const price = цена_со_страницы(задание.текст_страницы);
  if (задание.файлы.length) console.log(`вложения: ${задание.файлы.join(", ")}`);
  if (задание.плюсы + задание.минусы) console.log(`заказчик: ${задание.плюсы} за, ${задание.минусы} против`);

  // Задание могли закрыть за те минуты, что оно шло от ленты до нас: на
  // Workzilla разбирают быстро. Это не сбой и не повод чинить селекторы —
  // просто опоздали, и в журнале должно быть написано именно так.
  if (задание.недоступно) {
    console.log("ОПОЗДАЛИ: задание больше недоступно, заказчик закрыл его или выбрал исполнителя.");
    outcome = { status: "closed", submitted: false };
    return;
  }

  // Пустое описание — значит страница не догрузилась или селектор уехал.
  // Классификатор на пустой строке вернёт «непонятно», то есть пропустит, —
  // а это ровно та дыра, через которую можно откликнуться вслепую.
  if (задание.description.length < 20) {
    console.log("ОТКАЗ: описание не прочиталось, вслепую не откликаемся.");
    outcome = { status: "rejected", submitted: false };
    return;
  }

  let вердикт = классифицировать({ title: задание.title, description: задание.description, price });
  console.log(`«${задание.title.slice(0, 50)}» ${price} ₽ — вердикт: ${вердикт}${принудительно ? " (принудительно)" : ""}`);

  // Классификатор написан под агентский контур и считает любое упоминание
  // отзыва запрещённым. Мы живём отзывами, поэтому при «запрещено» спрашиваем
  // наши Python-триггеры: они знают наш бизнес и отличают заказной негатив
  // и отзыв конкуренту (стоп) от честного отзыва о клиентском бизнесе.
  let отзывы: ВердиктОтзывов | null = null;
  if (вердикт === "запрещено") {
    отзывы = await вердикт_отзывов({
      title: задание.title,
      description: задание.description,
      price,
    });
    console.log(`  отзывы: ${отзывы.verdict} — ${отзывы.reason}`);
    if (отзывы.verdict === "take" || отзывы.verdict === "need-info") {
      console.log(`  площадка: ${отзывы.platform_title || отзывы.platform}`);
      if (отзывы.questions.length) {
        console.log(`  спросить у заказчика: ${отзывы.questions.join(" ")}`);
      }
      вердикт = "агентское"; // наш бизнес-вердикт разрешает отклик
    }
  }

  if (!принудительно) {
  if (вердикт === "запрещено" || вердикт === "офлайн" || вердикт === "фарм") {
    console.log("ОТКАЗ: на такие задания не откликаемся.");
    outcome = { status: "rejected", submitted: false };
    return;
  }

  // Преграда. Для наших отзывных заказов проверка «чужой аккаунт» даёт
  // ложный отказ: «Разместить 1 отзыв на яндекс.карты» попадает под
  // «размест… отзыв», хотя мы работаем на СВОИХ аккаунтах — это наш бизнес,
  // и мост отзывов его уже подтвердил (take/need-info). Настоящие требования
  // чужого доступа (логин/пароль, клиентский аккаунт, телефон) останавливают
  // и наш отзывной контур.
  const п = преграда(задание);
  if (п === "чужой аккаунт" && отзывы &&
      (отзывы.verdict === "take" || отзывы.verdict === "need-info") &&
      !требует_чужой_доступ(задание)) {
    console.log("  преграда «чужой аккаунт» снята: наш отзывной бизнес, доступ свой.");
  } else if (п) {
    console.log(`ОТКАЗ: сам не вытяну — ${п}.`);
    outcome = { status: "rejected", submitted: false };
    return;
  }

  // Репутация заказчика. Порог намеренно высокий: на этом ценовом этаже
  // дизлайков больше лайков почти у всех, и владелец считает такого заказчика
  // нормальным — мы внизу пищевой цепочки, выбирать не из чего. Режем только
  // совсем гиблое: минусов впятеро больше плюсов. Само число всё равно
  // печатаем, чтобы видеть, с кем имеем дело.
  if (задание.плюсы + задание.минусы >= 10 && задание.минусы >= 5 * Math.max(1, задание.плюсы)) {
    console.log(`ОТКАЗ: репутация заказчика — ${задание.плюсы} за против ${задание.минусы} против.`);
    outcome = { status: "rejected", submitted: false };
    return;
  }

  // Экономика считается здесь, потому что здесь принимается обязательство.
  // Задание 22216749 показало цену ошибки: тридцать страниц патентного
  // отчёта за сто рублей были сделаны, но обошлись почти вдвое дороже.
  // Цену читаем не всегда; когда не прочитали — не отказываем вслепую.
  if (price > 0) {
    const с = сделка(price, требуемых_страниц({ id, заголовок: задание.title, описание: задание.description }));
    if (!с.выгодно) {
      console.log(`ОТКАЗ: экономика — себестоимость ~${с.себестоимость} ₽ против ${price} ₽, ROI ${(с.roi * 100).toFixed(0)}%.`);
      outcome = { status: "rejected", submitted: false };
      return;
    }
  }
  }

  outcome = await fillThenMaybeSend(
    page,
    текст,
    responseMode,
    globalMode,
    ownerApproved,
    async (targetPage: any) => {
      let accept: number | null = null;
      const слушатель = async (response: any) => {
        if (!/\/api\/order\/v5\/freelancer\/accept/.test(response.url())) return;
        try {
          const body = await response.json();
          accept = typeof body?.result === "number" ? body.result : null;
        } catch {
          accept = null;
        }
      };
      targetPage.on("response", слушатель);
      try {
        await targetPage.locator("a.wz-button.order-button", { hasText: /^Согласиться$/ }).first().click();
        await targetPage.waitForTimeout(4000);
      } finally {
        targetPage.off("response", слушатель);
      }
      let readback = false;
      if (accept === 0) {
        try {
          // НЕ перезагружаем страницу: после клика «Согласиться» reload
          // теряет вкладку и ломает подтверждение. Читаем признак отклика
          // из уже загруженного DOM; при отсутствии — accept всё равно 0.
          const postSubmitText = await targetPage.locator("body").innerText().catch(() => "");
          const postSubmitDescription = await targetPage
            .locator(".description-content").first().innerText().catch(() => "");
          readback = isTargetWorkzillaPage(targetPage.url(), id)
            && hasWorkzillaOwnResponseMarker(postSubmitText, postSubmitDescription);
        } catch {
          readback = false;
        }
      }
      return { accept, readback };
    },
  );
  if (outcome.status === "test_prepared") {
    console.log(`TEST_PREPARED: форма Workzilla заполнена; отправки не было (${id})`);
  } else if (outcome.status === "accepted") {
    console.log(`ОТКЛИК ОТПРАВЛЕН (accept result=0, target read-back), задание ${id}`);
  } else if (outcome.status === "closed") {
    console.log(`ОПОЗДАЛИ: форма отклика отсутствует, задание ${id}`);
  } else if (outcome.status === "rejected") {
    console.log(`НЕ ОТПРАВЛЕН: Workzilla accept result=${outcome.accept} (${id})`);
  } else if (outcome.status === "uncertain") {
    console.log(`НЕОПРЕДЕЛЁННЫЙ РЕЗУЛЬТАТ: повтор запрещён, проверьте Workzilla (${id})`);
  }
  // Вкладку держим открытой ещё holdSeconds: владелец (17.11) — «страница
  // открывается и моментально закрывается, переключает дальше на поиск».
    // Пауза нужна, чтобы человек успел увидеть результат, а уборка несла его.
  markRecent(id);
  const пауза = holdSeconds(process.env.RESPONSE_HOLD_SECONDS);
  if (пауза > 0) {
    console.log(`ПАУЗА: держу вкладку ${id} ещё ${пауза} с для контроля`);
    await page.waitForTimeout(пауза * 1000).catch(() => {});
  }
  await page.screenshot({ path: `bid-${id}.png` }).catch(() => {});
});
console.log("WORKZILLA_RESPONSE_RESULT:" + JSON.stringify(outcome));
await shutdown();
