# Order attachments: what the client actually sent, and what the review needs

Companion to the pool skill. Covers the files that arrive with an order, the
difference between the files a review needs and the files a client sends, and
the two distinct "screenshot" requirements that look identical in a brief.

## Attachments are not in the portal

The order's own database row keeps the description and the raw payload; the
**files** are not there — only a link to the file inside the raw payload. So
an intake that only reads the database sees a brief with no pictures and
concludes the client sent nothing.

Fetch them with the downloader that logs into the marketplace
(`bun files.ts <orderId>` writes the files into `task-<orderId>/`). Then read
the file with a vision model — local OCR returns an empty string on marketplace
screenshots, silently.

## Ask what the picture IS before extracting fields from it

A screenshot attached to a review order is most often **the card the client
wants reviewed**, not a sample review. It carries the organization name,
address, city, rating and phone, and that is what it is for: the client
writes «адрес и название компании прикрепил» and expects us to find the card
ourselves.

So: no example review text on the picture, and no request to attach that
picture to the review. Read it for the **identity** of the organization, then
find the card by that name and address.

The picture is also **not a photo for the review**. A screenshot of a map UI
attached to a client review shows the interface, not the business, and the
moderation side reads it as unrelated. A card screenshot is an input to the
search, never a file to attach.

## Two different "screenshot" requirements

Briefs use the word «скриншот» for two unrelated things, and reading them as
one breaks the order:

| Requirement | Meaning | What to do |
|---|---|---|
| «прикрепить скриншот **после написания**» | proof of work **to the client** | after publishing, screenshot **our own review** on the card and send it to the client in the chat |
| «прикрепить фото **к отзыву**» / «с фото» | a photo **inside** the review | attach a file to the review form |

The first is a deliverable to the client, the second is part of the review
form. The Yandex review form does accept a file (`input[type=file]`, hidden,
`setInputFiles` works) — but only a photo of the business belongs there.

## Screenshotting our own review after publishing

**Capture the ORGANIZATION'S CARD page — never the author's own cabinet.**
The cabinet (`reviews.yandex.ru/ugcpub/cabinet`) lists EVERY review that
account ever wrote, so a shot taken there puts our other orders — other
clients' organizations — into the hands of the client looking at this one.
The owner's rule: «ты палишь другие отзывы наши, другим клиентам — это не
очень хорошо». Only this card's review tab may be in frame.

On the card: open the «Отзывы N» tab, then locate our review **by our review
text** (the card's list shows other people's reviews first, so "the first
review on the page" is not ours): take a slice of the text, find the smallest
element containing it, scroll it into view. The `«Вы оценили это место»`
marker on the card overview also names ours when the review is still under
moderation.

**Capture the whole viewport of the card page, not a tight crop** — the owner
prefers the wider frame: «Кроп можно страницу всю, там будет нагляднее».
The frame should carry the organization heading, the «Отзывы N» tab, the
author line, the date and the review text together; a crop of the text alone
proves less and reads worse.

**Verify the frame with DOM assertions when no vision model is available:**
read back, in the same page, (a) the `h1` organization name, (b) the
author-plus-date string, (c) the review text slice, and (d) that the review
element's `getBoundingClientRect()` lies inside the current viewport
(`top >= -40 && bottom <= innerHeight + 40`) after the scroll. A page-level
match that is off-screen proves nothing — the assertion has to be about the
saved frame's contents.

## Sending the proof screenshots to the client

`bun wz-msg.ts <orderId> <textFile> <img1> <img2> --attach` sends the text plus the listed files as attachments in the order's chat. The flag is spelled **`--attach`** — a Cyrillic guess like `--вложить` silently delivers the message WITHOUT the files and prints «файлы не приложены (нет --attach)», so the client gets prose and no proof. Take the flag literally from the script's usage line.

Re-running the same send (e.g. after a first attempt failed on the port) **appends** attachments again instead of replacing them — the interface then shows more chips than the number of files (this session: «вложений: 11 из 2»). Sending files is therefore not idempotent; if the first send may have landed, verify the chat before resending, and do not trust the count line as the number of files you intended. The send also needs the shared Chrome on :9222 up — a wedged window makes `wz-msg` fail with «Порт 9222 молчит»; restart the window in the same profile (drop it, relaunch `chrome.exe --remote-debugging-port=9222 --user-data-dir=<profile>`) and retry.

## Where a photo for the review comes from

The client rarely supplies one. In order of preference:

1. **A photo the client sent** that is actually a photo of the business
   (not a card screenshot, not an avatar).
2. **The business's own photos in its card** — the «Фото» tab of the Yandex
   card. These are real photos of the client's own premises and are the
   honest source when the client asks for a photo and supplies none.
3. **A generated image** — last resort, and it still goes through the owner's
   approval gate, like generated text. A generated image of a business the
   author has never visited is the weakest possible proof; prefer (2).

When the picture the client sent is only a card screenshot and the brief wants
a photo in the review, say so in the report and let the owner choose between
the card's own photos and a generated one — do not silently attach the
screenshot.

**A photo must be PER-ORDER, never a shared fallback.** `auto_publish._черновик`
once resolved a missing order photo to the first file in the shared
`data/photos/` directory, so every draft without its own image got the SAME
photo — an unrelated order's premises attached to four different businesses'
reviews at once. The card's own photos live in `data/photos/<target>/` (fetched
by `yandex-card-photos.ts <cdpPort> <cardUrl> <папка>`); if a draft has no
file under its own target folder, write «фото не приложено» in the draft's
meta — never substitute another order's photo. The draft `.meta` must name this
order's own organization, link and photo; a stale shared file silently marks
the wrong business as pictured.

## Cleaning the download folder

The download folder accumulates artefacts from image analysis (cropped tiles,
numbered fragments) next to the real attachment. Left in place they are
picked up later as if they were client files — and one of them gets attached
to a review. Keep only the files the marketplace actually delivered, and treat
a folder of crops as a local scratch dir, not as attachments.
