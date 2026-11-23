# Kwork portfolio upload (`kwork.ru/portfolio`)

Use for a **one-off bulk portfolio load**, never for the order-feed parser.
The owner supplies the material and a category per item; write a separate
script, stop the parser for the duration, and leave saving gated.

## Working sequence

1. **Stop every tab-driving worker first**: the feed parser (`bun parser.ts`),
   the detail collector (`bun wz-detail.ts ...`), the chat monitor, and the
   portal process itself (`app.py` — its in-process `order-details` thread keeps
   opening detail tabs even with no `bun` process alive). Switching the mode to
   `execute`/`respond` stops the parser by design but does NOT stop the detail
   worker or the portal threads. Verify zero matching processes by command line
   and that only the portfolio tab remains before opening the form; a single
   surviving collector makes the owner's screen jump for the whole load.
2. Attach to the already-open `kwork.ru/portfolio` tab over CDP; if absent,
   open it with `PUT /json/new?https://kwork.ru/portfolio` (GET returns 405).
3. Click «Загрузить работу» via a real Playwright `locator.click()`/DOM click,
   then wait for `#portfolio-title`.
4. Read the catalog from the form's own XHR, not from the DOM options:
   `GET /portfolio/get_popup` with `credentials: include` returns
   `data.additional.categories` (29) and `parentCategories` (6). Each category
   has `CATID`, `parent`, `portfolio_type` (`photo`/`video`/`audio`/`pdf`/
   `none`), `max_photo_count`, `resolution`. Cache it beside the loader as a
   JSON catalog and validate every job against it before touching the browser.
5. Write jobs as JSON: `title`, `category_id`, `files`, `cover`, optional
   `category_name`, optional `type`, and `save: true` only when the owner has
   approved that exact item. Run `--dry` first and print the accepted items.
6. In the form: fill `#portfolio-title` (≤40 characters); drive the linked
   vue-selects (parent → category → subcategory) with real clicks. Upload media
   through a **real `filechooser`**: register
   `page.waitForEvent('filechooser')`, click the create-block
   (`[data-type=media] .create-block`), then `chooser.setFiles(path)`. Calling
   `setInputFiles()` directly on `input.uploader` leaves the filename on the
   input but never fires the framework's change handler, so no media card
   appears and the save is rejected. `portfolio_type` is authoritative.
7. **Do not click «Сохранить» without an explicit per-job `save: true`.**
   The owner wants to eyeball the filled form; a batch that saves on its own
   is unrecoverable on the marketplace surface. Click the button with
   `page.getByText('Сохранить', { exact: true }).last().click()` — a `button`
   locator with an anchored Cyrillic regex misses it, and a DOM `evaluate()`
   `.click()` does not reach the framework's handler.
   **Verify the save by `workNum` from `/portfolio/get_popup`, never by the form
   closing**: the form stays open after a successful save and also closes on
   validation errors, so form state is not a success signal. Poll `workNum` for
   several seconds because it updates late. The message «Данное видео уже
   загружено в портфолио» means the item DID save even if `workNum` did not
   move — treat it as success and never re-submit. A freshly saved item can stay
   out of the visible list for hours; do not re-save it.
8. For a new source catalog, publish **ONE** item first: fill the form, show
   it to the owner, and stop. Only after he confirms that one publication do
   the remaining items go through the same template. Present a short checklist
   (workers stopped / tab open / catalog read / item chosen / form fields /
   awaiting confirm / rest after approval) rather than a narrative of the
   setup steps.
9. **One item per process, with a hard reset between items.** The form keeps
   previous fields and media across saves: clicking the overlay close triggers
   a «Очистить без изменений» confirmation, so explicitly confirm it and then
   do a full `page.reload()` — assert `#portfolio-title` count is 0 — before
   filling the next work. Reusing a form accumulates all videos into one card.
   A shell loop that invokes a single-item script once per ID is safer than a
   batch loop inside one browser session.

## apimedia source catalog

- A section is `https://apimedia.live/portfolio/api/sections/<topic>.json`;
  `items[]` carries `id`, `title`, `model`, `media_type`, `topics`,
  `video_url`, `thumb`, `script_url`, `json_url`. Verify `count` against the
  actual array length before planning a batch.
- **Titles in these JSON files are latin-1-mangled UTF-8** — decode with
  `title.encode('latin-1').decode('utf-8')` before putting them in a form.
  Undecoded text renders as `Ð¢Ð¾Ð²Ð°Ñ...` and is rejected by the owner.
- **Kwork derives the cover frame from the uploaded video itself.** Do not
  extract a frame with ffmpeg and do not look for a separate cover file input —
  the «Загрузить обложку» button reuses the same media uploader. Once a video
  card registers, the cover block shows the work title and category on its own.
  «Необходимо загрузить обложку» or «Минимум 1 видео» means the media never
  registered; fix the upload instead of adding a file.
- Video processing is asynchronous: after `chooser.setFiles()` poll until the
  «Минимум 1 видео» validation disappears (a few seconds) before saving. An
  `image`-class card with an empty caption is the intermediate state, not a
  failure.
- Some hosts return zero bytes to git-bash `curl` while responding normally
  to PowerShell `Invoke-WebRequest -UseBasicParsing`. Save the JSON with the
  latter and parse the saved file rather than retrying curl.

## Form facts

- One parent category is `Дизайн`; its `ИИ-генерация изображений` is CATID 306
  (`photo`), `ИИ-генерация видео` is 300 (`video`). Parent IDs are small ints
  (5 Тексты, 7 Аудио/видео, 11 Разработка, 15 Дизайн, 17 SEO, 83 Бизнес).
- Images: JPEG/JPG/PNG/GIF/WEBP ≤10 MB, recommended ≥1920×1280. Video:
  MP4/AVI/MOV ≤50 MB, ≤75 s, horizontal ≥660×165 or vertical ≥132×440.
- The form also offers «Привязать работу к моему кворку» (from
  `additional.kworks`) and kwork-activation radios; leave them untouched unless
  the owner specifies a kwork.
- Selector pitfalls are the generic ones in SKILL.md: vue-select needs a real
  `locator.click()`, visible labels are Cyrillic but identifiers inside
  `page.evaluate` must stay ASCII, and `browser.close()` over `connectOverCDP`
  kills the shared window — use `process.exit(0)` instead.

## Validation pattern

Put catalog validation in a small Python module beside the portal and test it
(RED→GREEN): reject an empty title, an unknown `category_id`, and an empty
`files` list. Keep the checked catalog in a fixed JSON file next to the loader
so a live CDP session is never needed to answer "is this category valid?".
