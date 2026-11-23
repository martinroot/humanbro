# Measuring the pool's earning capacity against the market

Use when the owner asks «сколько мы зарабатываем», «что мешает заработать больше»,
«что нужно, чтобы вырости в N раз». The answer must come from the pool's own
artifacts and the feed log — never from impression. Growth is a function of
**utilization first, demand second, money last**: usually the feed already
offers several times more work than the pool can publish, and the real
headroom is sitting in the conversion pipeline.

## The three numbers to establish first

| Number | Meaning | Where it comes from |
|---|---|---|
| **Demand** | what the market offers per day, in orders and in ₽ | feed log, deduplicated by the exchange's own order id |
| **Ceiling** | what the pool can physically publish per day | accounts × per-account daily limit, minus accounts blocked by a gate |
| **Utilization** | published ÷ ceiling | the review ledger vs the ceiling |

**Utilization is the growth number.** If the ceiling is 18 reviews/day and 3
were published, the pool is at 17% and no purchase will help until the
conversion path publishes more. Demand is usually already 5–20× the ceiling.

## Step 1 — measure demand from the feed log

The parser's per-market log is one line per card, pipe-separated:

```
Workzilla <external_id> | <price> ₽ | <time> | <title> | <description> | JobLock: ... | <url>
```

Split on `|` — **index 0 = id, 1 = price, 2 = remaining time, 3 = title,
4 = description**. The title is *not* at index 2 and the description is *not*
at index 3; reading the wrong index silently yields "0 matching orders"
and looks like an empty market.

Then: deduplicate by the external id (the log repeats a card every cycle),
and split the platform by the **platform's own name first**, the generic
phrase second. A card's description is where the pool's gates live —
«с телефона», «мужской аккаунт» — and every card whose gate the pool cannot
satisfy is demand that is *excluded*, not demand that is missing: count it
separately, it is a procurement lever (accounts with a phone, female
accounts) and it belongs in the report as its own line.

## Step 2 — price per REVIEW, not per order

An order's total price and its price per review are different numbers, and
the second one decides everything. A 1500 ₽ order for 5 reviews is 300 ₽ per
review; a 155 ₽ order for 1 review is 155 ₽. Rank candidates by **₽ per
review** — that ranking is what to bid on, and it is the single most
valuable thing in the report.

Counting reviews from free text: the count is the number before
«отзыв/отзыва/отзывов», but reject it when the words before it are price
words (стоимость/цена/руб/оплата/каждого) or the number is followed by a dot
(list marker). A number above 20 is not a review count.

## Step 3 — the ceiling

- ceiling = (accounts in service) × (per-account daily limit).
- **Resolve the one-account-one-card question from the registry, not from
  memory.** The two rules that meet here are: (a) the same account never
  reviews the same card twice, and several reviews of ONE card come from
  different accounts; (b) this business's standing constraint — one account
  serves one card, so a client asking for N reviews on N cards consumes N
  distinct accounts. Under (a) alone an account may work several different
  cards and the ceiling is accounts × daily limit; under (b) it is one card
  per account and the ceiling is the account count. They cannot both be
  assumed. Read the pool's own history — the `reviews` table and each
  account's `posts_total` — and see what actually happened: if accounts that
  already have one published review are still offered fresh cards, the pool
  is on rule (a); if the registry marks them spent, the ceiling is the
  account count and the report must say that buying accounts IS the growth
  lever. State which rule you used in the report.
- A **freshly bought account does not contribute on day zero**: it needs
  warm-up (activity → route → the client-mandated pause) before its first
  publish, so a purchase announced today shows up in the ceiling two or
  three days later. Say that in the report, or the owner will expect yield
  the same evening.
- Accounts whose own state fails an order's gate (no phone, too young, no
  avatar) are not part of the ceiling for that order.

## Step 4 — cost per review

Account purchase price and the proxy spend are only meaningful **per
published review**:

- account cost ÷ reviews that account will ever produce;
- proxy $/month ÷ reviews per month on that port (a port is reusable, and
  the IP may rotate — a rotating mobile pool's IP is a point-in-time
  observation, not a property of the account);
- one account = one card = one review is a **client-mandated** pattern
  ("reviews of one card come from different accounts"), and it sets the
  account-to-review ratio the whole cost model turns on.

Record the price actually paid in the registry when the accounts are
imported. A pool whose acquisition cost is 0 in the ledger cannot be costed,
and the owner cannot be told whether scaling pays.

## Step 5 — name the binding constraint

Ask in this order, and answer with the evidence for the first "yes":

1. **Accounts?** more identities would publish more reviews?
2. **Conversion?** are bids going out, and are client replies being read?
   A review cannot be published without the client's card link and text; a
   chat that nobody reads converts bids into silence, and no purchase fixes
   that.
3. **Gates and delays?** is the wait (activity → route → pause → moderation)
   longer than the day's remaining hours? A client-mandated pause between
   reviews and a moderation window before payment mean published work is
   not cash for days.

The usual answer is 2 or 3, and it must be stated plainly, with the
purchase budget marked as *not* the blocker. The owner's question is "what do
we do to grow", and answering "buy more accounts" when the answer is "read
the chats" wastes his money.

## The money report — the shape the owner asked for

1. **Факт на сегодня** — published and submitted, in ₽, and separately
   **actually received** (0 until moderation clears and the client pays).
   Lead with the received number, not the submitted one.
2. **Спрос** — cards/day available to this pool, their total value, and the
   excluded share with the reason.
3. **Потолок пула + утилизация** — the ceiling and the percentage used.
4. **Таблица сценариев** — ×2/×3/×4 in reviews/day, priced at two rates:
   the median of single-review orders and the best multi-review rate. This
   is where the owner sees whether the target is reachable.
5. **Смета** — what the scale-up costs (accounts, proxies) and what it
   returns. State the payback in one line.
6. **Что реально даст рост** — the pipeline steps, in order, each with the
   blocker it removes. Mark the non-blockers explicitly.
7. **Риски** — excluded gates, moderation lag, client-imposed freezes
   (e.g. "don't publish on other organizations until we pay").
8. **One-line verdict** — what binds us, and what the next purchase buys.

## Traps

- **Money received is zero for days after publishing.** Moderation, then
  client payment. Report published-vs-received separately or the number
  looks like a lie in either direction.
- **The feed log repeats cards.** Dedupe by external id before counting
  anything.
- **A fresh log is not a live order.** The same rule as for parsers: a card
  that appeared in the log may already be closed.
- **Don't quote a per-order price as a per-review price** — the whole
  ranking flips.
- **A client's own freeze can gate the growth answer.** A client who has
  published work and is waiting to pay may forbid writing reviews on other
  organizations until they pay ("примут за спам"). That freeze is a
  constraint on the pipeline, not a market condition — read it off the
  client's own chat reply and put it in the report as the thing that
  sequences the next purchase.
