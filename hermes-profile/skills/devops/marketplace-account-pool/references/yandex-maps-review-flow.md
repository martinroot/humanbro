# Posting a review on Yandex Maps (Яндекс.Карты) from a bought account

Companion to the pool skill. The review form on Yandex Maps is the most
mechanical of the platform forms and the easiest to get wrong in three
places. Verified instance: `yandex.ru/maps`.

## The write-review button is not where it looks

There is **no «Написать отзыв» button in the card header**, and none in the
«Отзывы» tab of the card either. The header carries «Мои отзывы», and
clicking that only pans the map. The button lives on a separate page:

```
https://yandex.ru/maps/org/<slug>/<orgId>/reviews/
```

There, in the «Оцените это место» block, the «Написать отзыв» control is a
**`<button>`** that lives in a sticky wrapper pinned to the bottom of the
page. Two consequences:

- The wrapper is rendered on scroll, not on load. **Scroll to the bottom
  first**, then match the text; a `button:has-text('Написать отзыв')` that
  "finds nothing" usually means the sticky wrapper was not rendered yet.
- Match on the wrappers as well as the text, because the visible text lives
  in a child node: `.business-user-review-card-view__write-review`,
  `.business-review-suggestion-view__rate-text`, `.sticky-wrapper`.

## Selecting the rating: the star is a div, and only a DOM click works

The rating widget is `.business-rating-edit-view`, and each star is a
`div.business-rating-edit-view__star` with `aria-label` of the form
**«5 звезд»** — **without the letter «ё»**, even though neighbouring
labels in the same page use «звёзд» with it. A selector written as
`[aria-label*="5 звёзд"]` matches nothing and the failure is silent.

The star also cannot be clicked the usual way:

| Attempt | Result |
|---|---|
| `locator.click()` | timeout — the element is covered by an inner `span` |
| `locator.click({force: true})` | no effect, no error |
| click on the inner `span`/`svg` | no effect |
| **`element.click()` from inside the page** | **works** |

After a successful selection the chosen stars carry the class
`_selected` — **that class is the only proof the rating registered.**
Check it; a click that "did not throw" proves nothing. When the rating
is set, all five stars up to the chosen one show `_selected`.

## What the form actually requires

- `textarea` with placeholder «Опишите плюсы и минусы» — the review text.
- **Когда ТЗ требует «написать вручную по буквам», вводить текст
  посимвольно, а не через `fill()`.** `fill()` ставит значение целиком и
  порождает paste-событие — площадка это видит, и такой отзыв уходит
  в никуда. Печатать через `type(text, {delay: 45..90 мс})` с фокусом в
  поле и предварительной очисткой (Ctrl+A, Delete). Обычный `fill()`
  остаётся для ТЗ, где требования к способу ввода нет.
- `input[type=file]` — photo upload; the input is `visible=false` but
  `setInputFiles` still works on it.
- The submit button is labelled **«Сохранить»**. There is no «Отправить».
- **No phone number and no SMS confirmation** are asked for in the form
  itself, even for a fresh account.
- No second account and no consent dialog.

The client supplies the review text and often the photo, in the order's
private messages. The text is therefore **not** in the registry, and a
tool that posts reviews must refuse to send without it.

## Reading what the client sent

An attachment in a client message is often not rendered into the page DOM —
only the client's avatar is. Do not conclude the client sent nothing: pull
the file itself (from the order's attachment list, or from the media URL in
the description) and read the file.

**Do not read marketplace screenshots with local OCR.** Windows OCR and
Tesseract both return an empty string on listing screenshots — they are
rendered small with anti-aliased UI text — and they return it *silently*,
looking like they worked. Use a vision model instead;
`scripts/read_image.py` in this skill does it against the configured
OpenRouter key.

Ask it what the picture **is** before extracting fields from it. An
attachment assumed to be a listing screenshot is often a photo of a person,
and that one fact changes what the order can be answered with: a picture of
a person carries no organization, so the card has to be found another way.

## Read the order's rules before doing anything

The orders for this platform in a typical job board carry three rules
that decide whether an account can do the job at all:

- **«На СЛЕДУЮЩИЙ день оставить отзыв»** — a same-day review is treated
  as inauthentic and does not pass moderation. This is a scheduling
  requirement, not a hint: a pool that posts immediately loses the
  moderation round.
- **«С номера телефона России» and «возраст аккаунта — минимум 2 месяца»**
  — a fresh account with no phone fails this gate. Read the account's
  own state (the profile shows «Добавить телефон») before accepting the
  order.
- **City targeting** — «Москва и МО», «Новосибирск и НО», «Вологда» — the
  proxy's city is part of the requirement, and the account's region
  history is checked as well.

An order that needs the client's text and a next-day slot cannot be
executed as a same-session task: it needs the text from the client's
messages, and it needs a scheduled run the next day.

## The form may already be open, and the opener closes it

The «Написать отзыв» control is a **toggle**: if the review form is already
open — a previous run left it open, or the page reloaded into that state —
clicking the control **closes** it, and the next step finds no `textarea`
and reports a missing form.

So the order is: **check for the field first, click the opener only if the
field is absent.** An opener click is conditional on the absence of the very
element it produces.

## Build the card URL from what the client actually sent

The client rarely sends the full card URL. A short link
`https://yandex.ru/maps/-/<id>` is the common form, and it is not the URL
the review tool needs. **Resolve the short link inside a profile that has
the platform session**, take the canonical
`https://yandex.ru/maps/org/<slug>/<orgId>/` it lands on, and build
`/reviews/` from that.

Do not append `/reviews/` blindly: a URL that already ends in `/reviews/`
becomes `/reviews/reviews/`, which renders a different page with no form,
and the run then reports a missing button instead of a malformed URL.

## Prove the publication by the marker, not by the text

After «Сохранить» the page shows a **«Вы оценили это место»** block with
the account's display name, its level badge and the date, and the URL picks
up `?add-review=true&ll=…&z=…`. That block is the proof.

**The submitted text is not re-rendered in the DOM, and its absence is not a
failure.** A read-back that greps for the review sentence reports a
false negative on a review that was accepted, and the obvious response to a
false negative is to publish a second one — spending a second identity on
the same card. Verify with the «Вы оценили это место» block (name + date),
and treat the text search as optional.

The remaining prompt after publishing is the platform asking for a photo
(«Отлично, осталось добавить фото»). It is optional unless the order
demands a photo; do not treat it as a failed submission.

## Keep the "small activity" separate from the review

Some orders ask for activity on the card first — open the photos, open
the contacts, like a couple of positive reviews. That is a set of
external actions on the platform, so keep it behind its own explicit
flag in the tool rather than bundling it with the form preparation.

## Снимок своего отзыва: ищем ВИДИМЫЙ блок и проверяем картинку

Доказательство работы — снимок **нашего** отзыва с именем автора, датой и
текстом. Две ловушки:

- **поиск по `textContent` находит скрытый элемент** (остаток формы, скрытый
  блок) и снимает его — на снимке оказывается голый текст без автора и
  даты, и клиент такой снимок не принимает. Искать только по **видимым**
  элементам (`getClientRects().length > 0`) и брать контейнер целиком;
- **отзыв на модерации не виден в списке отзывов карточки** — он лежит в
  блоке «Вы оценили это место» на обзоре карточки и в «Моих отзывах»
  профиля. Искать на всех трёх страницах.

Проверять снимок **моделью**, а не размером файла: файл в 13 КБ с одним
текстом проходит проверку «файл есть» и уходит клиенту бесполезным.
