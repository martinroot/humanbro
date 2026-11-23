# Self-execution: the client never answers, so the order is done anyway

Companion to the pool skill. Covers the branch of the order cycle where the
client goes quiet: the order is still live, the client is not going to send
the card link and the review text, and the work must be executed without it.

## Why waiting loses the money

The client picks an executor within hours. An order parked on a silent client
is an order the client has already given away, and the daily limit of the
account is spent for nothing. Waiting is therefore not a neutral state — it is
the most expensive outcome available.

The owner's rule for this branch: **do the work yourself when the client does
not answer.**

## Decision procedure

Given an order whose client has not replied, decide in this order.

1. **Has the client promised their own text?** Read the brief AND the chat for
   a promise («текст пришлю», «скину отзыв», «готовый текст пришлю»). If the
   client promised to send the wording, WAIT for that one thing: publishing
   our own text on top of a promised one wastes the review slot and the
   client's own check. Everything else may proceed, but the text does not.
2. **Is the organization named?** Look in the brief first («найдите
   `<название>`», «организация: `<название>`»), then in the chat («найти
   ПролайфИнвест, адрес Москва, Барклая 6»). The chat carries the name far
   more often than the brief does — most briefs say only «Яндекс Карты 100 р».
   **And the LINK itself can be in the brief** («по ссылке
   https://yandex.ru/profile/…») — a card link found only in the chat is not
   proof the card is unknown, so the brief is the first place to look for
   the link itself, not only for the name.
3. **Can we publish without a photo the client promised?** If the brief asks
   for a photo in the review and no usable photo exists, that is a blocker for
   the review itself, not for the rest of the work.
4. **Otherwise: find the card, write the text, publish.**

If step 2 finds no name anywhere, the order is not executable — record that
as the reason (`ждём заказчика — в ТЗ и переписке нет названия организации`)
and move on. An order waiting for a card that will never be named is not the
same as an order waiting for a reply, and the status report must not show the
two mixed.

## The name extractor must not read a verb as a name

Extracting a name from free text is a regex job, and the failure mode is a
verb from the instruction: «адрес и название компании **прикрепил**» yields
«прикрепил» as the organization name. A name made only of service words
(яндекс, карты, отзыв, отзывы, организация, компания, профиль, задание,
работа, заказчик, услуга, клиника) is not a name either.

Keep a stop-list of instruction verbs and service nouns, and reject a
candidate whose every word is on it. Then take the name from the chat as
«найти X, адрес Y» — the address carries the city, and the city is the
second half of the card search.

## Resolving the card

The search resolver takes name + city and prints the card URL. Two forms of
the card URL matter downstream: the canonical `yandex.ru/maps/org/<slug>/<id>/`
is what the publish tool needs, and the short `yandex.ru/maps/-/<id>` link the
client sends has to be expanded first (see
`references/yandex-maps-review-flow.md`).

**When the brief orders a SEARCH instead of a link («Ищите в поиске», an
address rather than a URL), the ADDRESS is the selector.** One name returns
several cards — the requested branch and a «переехала» stub at a different
address — and the first row is often the wrong one. Match the brief's address
against the result rows (district, quarter, street), click THAT row (a
generic list-item click times out on the sticky result — filter by the
address text and click with `force: true`), then read the opened card's `h1`
and address back and compare them with the brief BEFORE farming: activity
and a route spent on the wrong branch of the same name are unrecoverable.
Confirm the category from the brief is on the card too — the moved stub
usually keeps the name and drops the location.

The city is soft: a city in the brief is a hint, not a gate, because the
platform does not compare the reviewer's city against the organization's. A
card that is genuinely in another region is a different question — see the
region rule in the pool skill (set the account's own region, never rotate the
proxy).

## One review per pair, and the count bookkeeping

An order can require several reviews («Написать 2 отзыва») and the client can
send several card+text pairs in one batch. Each pair is one review, each from
its own account (see `references/account-pool-selection.md`).

The bookkeeping that makes this work across runs: keep `count` (how many the
order needs) and `published_count` (how many are done). The order stays in
the publish selection while `published_count < count`, and the pair to publish
is chosen BY INDEX — pair N is the Nth one. A selection that drops the order
as soon as `published_url` is filled publishes exactly one review of a
two-review order and then abandons the second.

One pair per run, not all in one run: two reviews from one account, or two
reviews without the interval between them, both fail the client's check.

## What the owner still gates

The owner-approval gate is about the wording, not about the client's silence:

| Case | Gate |
|---|---|
| The client supplied the text | publish as given |
| We wrote it, order is interactive, the owner is reviewing the draft | owner's OK |
| We wrote it, the client is silent, the order is executed autonomously | publish (see below) |
| A generated photo | owner's OK, in every path |

The autonomous path publishes a text we wrote without a per-order owner
round-trip. The reason is mechanical, not editorial: the approval step is the
thing that stalls the order, and a stalled order is lost. What the autonomous
path may NOT do is invent a specific the client never mentioned — no prices,
no deadlines, no employee names, no claimed outcomes. The text stays truthful
and unspecific.

## The text the autonomous path writes

Same rules as any self-written review, and the same voice as the messages to
the client: one short sentence, plain, no blank lines, no invented detail,
varied per order (pick deterministically from a hash of the order id so one
order always gets the same text and two orders never match). The client sees
the review on the card, so a padded or machine-sounding text is a moderation
risk, not just a style miss.

## Traps

- **The «may we write the text ourselves?» predicate must exist ONCE.** Two
  modules carried their own copy of the regex, and the copies drifted: a
  brief worded «Отзыв составить самостоятельно» matched neither, so an
  order that had a ready link AND an explicit instruction hung with no
  visible cause. One function, imported by every caller, with the client's
  own wordings in the list — «составить самостоятельно», «своими словами»,
  «напишите отзыв», «без согласования» all mean the same thing.
- **A client that promised their text looks like a client that went quiet.**
  Check the promise before deciding to write the text yourself.
- **A short chat line («Яндекс карты», «Готовы?», a timestamp) is not an
  answer carrying the review text.** `можно_исполнить_самому` used to accept
  any non-empty line as «заказчик ответил», which flicked the loop into the
  «делаем сами» branch with only the metadata line as the text and no
  organization name — a nonsense `search:` about to be published. Require
  ≥15 chars before a line is evidence of a real answer, and require a real
  organization name before branching to self-execution at all.
- **The name is usually in the chat, not the brief.** A brief reading «Яндекс
  Карты 100 р» names nothing, and a rule that only reads the brief declares
  every such order unexecutable.
- **A verb extracted as a name.** Filter instruction verbs out of the
  candidate.
- **One review published, order declared done.** Compare `published_count`
  against `count`, not `published_url` against empty.
- **Executing an order that the client deleted.** The status gate runs before
  any of this — a removed task is closed without work (see
  `references/order-status-gate.md`).
- **A bid-side refusal is not the client closing the task.** «поле отклика
  нет — задание недоступно (заказчик закрыл или выбрал исполнителя)» also
  covers the case where the client chose US. Read the exchange stage before
  closing; a task that is `in_work` while our registry says `closed` is an
  order the client is waiting on.
