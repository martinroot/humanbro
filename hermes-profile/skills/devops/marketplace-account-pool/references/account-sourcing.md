# Sourcing platform accounts: demand, rules, shops

Companion to the pool skill. The pool is infrastructure; this file is the
procurement half — where the demand for identities actually is, what each
platform's rules allow, and how to check a seller before paying.

## Measure demand from the owner's own orders first

Before proposing a purchase list, count what the owner's order feed already
asks for. Group the orders by platform and by the quantity of accounts they
request, and weight by the published price. This turns "we should buy some
accounts" into a number the owner can pay against, and it exposes the request
that asks for several accounts at once — that request is the real product.

Two things to read out of the same count:

- **Which platform the money is on** — the platform with the highest count × price is where the pool earns its keep, and the platform with the highest count and the lowest price is where the volume is but the margin is not.
- **How many identities one request implies.** Orders that say "several accounts" or name a count tell you the per-request identity count directly, and it is the number that sizes the pool.

Say plainly when the demand is a single client or a single feed rather than a
market. One client filling 68 orders is a contract, not a market, and sizing a
permanent pool against it is overbuilding.

## Demand measured from the owner's feed (reference numbers)

Counted from the real feed + flow registry (22.10): already wired and under
way — yandex-maps (heavy), avito (~460 cards, 56 waiting-account), 2gis (~101,
10 waiting), google-maps (~59, 7 waiting), google-play (11, 3 waiting),
otzovik (14). Waiting-account backlog is the cheapest money: it is approved
orders blocked only by a missing identity.

New platforms the feed already asks for, in priority order with volumes:

| Platform | Cards | Avg price | Notes |
|---|---|---|---|
| Wildberries | ~84 | 100–150 ₽ | post-purchase reviews, no special device |
| Ozon | ~49 | ~250 ₽ | highest average price per card |
| Rustore/Android-store | ~65 | 120–200 ₽ | AppStore share unservable — desktop-only antidetect cannot produce iOS device
| Zoon | ~18 | 100–150 ₽ | medical/service companies |
| IRecommend | ~15 | 100–400 ₽ | account gender matters per brief |
| Restoclub | ~8 | 100 ₽ | restaurants |
| Flamp | ~8 | ~200 ₽ | |
| Prodoctorov / Napopravku | ~9 | 100–150 ₽ | medicine |
| Booking | ~4 | 100 ₽ | hotels |

Rules that come out of the table:

- **Rank expansion by per-platform cards × price and by whether the identity
  is free to farm.** Zoon/IRecommend/Restoclub/Flamp/Prodoctorov/Napopravku
  accept ordinary RU-registered accounts (farm, don't buy); WB/Ozon need
  bought accounts with confirmed phones. The no-budget path and the bought
  path are different projects.
- **Say which share is unservable before counting it as revenue.** Any
  app-store order for iOS from a desktop-only antidetect stack is
  unservable — keep the Android-side count and name the iOS share as a
  blocking tooling gap, not a missed order.
- **Feed volumes above are total over the sampled window**; real daily volume
  is roughly a third. Use the ratio, not the raw number, when sizing.

## What each platform's rules allow

Read the platform's own help center; the rule that decides the account spec
is always there and is never the one you would guess.

- **A platform that requires deal confirmation** will not accept a bare account. The unit is an account plus its purchase history and correspondence with the seller, and the price band for such a unit sits well above a plain account's.
- **A platform that moderates authenticity** discards a measurable share of submissions from fresh profiles — the operator's own figure is around one in three. Plan the submission count at that multiple of the published count and treat the ratio as a constant to measure, not a guess.
- **A platform that binds a session to a device** makes an imported cookie brittle. Prioritise credentials the owner can re-verify over a captured session.
- **A platform that requires a mobile device or an app-store review** is unservable with a desktop-only anti-detect browser. Say that in the plan rather than dropping those orders from the count without explanation — the owner is pricing them.

## Seller checklist

Ask for all of it in writing:

1. **Recovery triple** — `login:password:backup_email`, or `login:password:phone_the_seller_holds`. A session-only or password-only account is unsalvageable at the first code challenge.
2. **Registration age** and whether the account has real activity: profile image, own history, prior reviews. A brand-new account and a several-year-old one are different products at different prices.
3. **Region and city** of registration, and whether the seller's proxy is from the same region.
4. **Evidence of ownership** — the seller opens it live, then the buyer opens it from a different network. An account that survives neither is a paper asset.
5. **Replacement guarantee** with a stated window, and a support channel that answers. No replacement clause is the signal that the batch is disposable.
6. **No accounts bought from a leak.** A profile with a visible login history is already known to the platform.

Then, before paying for volume, buy one and run it through the whole pool
procedure: registry → profile → proxy → verified egress → one real action →
read-back. A batch that fails any step fails cheaply once, not expensively
twenty times.

## Proxy supply and the geo constraint

The identity triple makes a proxy a per-account resource, so the proxy budget
is the account budget.

- **Count the pool by country before buying anything.** A pool where the target
  country's entry is a single unit is a pool that cannot support more than one
  concurrent identity. Group the pool by the country embedded in the vendor's
  login string and by its name field, and report the distribution — this is
  usually the real blocker, and it is invisible until counted.
- **The antidetect cabinet is a registry, not a shop.** Its API has no billing or
  purchase route; proxies are bought in the provider's own cabinet and then
  registered through the API. Buy from the provider the pool already uses —
  the same provider usually means the same integration, the same rotation
  endpoint, and one support relationship.
- **The provider's own API may sell ports directly.** "No purchase route" is a
  statement about the antidetect vendor, not about the proxy vendor — check the
  proxy provider's API before telling the owner that buying must be done by
  hand. See `proxy-vendor-api.md` for the verified purchase contract, the
  key-placement rule, the one-port-before-batch rule, and how to auto-register
  bought ports into the cabinet.
- **Rotation is per-proxy, not per-profile.** Where the vendor exposes an IP
  rotation URL, hitting it changes the egress without relaunching the browser.
  That is what keeps one proxy from becoming a shared fingerprint across many
  accounts.
- **Resident or mobile beats a plain datacenter exit** for this workload, and
  buying in volume earns a tier discount that is worth stacking before the first
  purchase.

## Verifying a shop before recommending it

A shop link is only worth giving if it answers three questions: is it alive,
does it sell the category, and does it sell the *kind* of thing needed. Check
the HTTP status, then read the page for the category and for the format the
listings promise.

- A marketplace whose listing pages are rendered by JavaScript returns a shell
  to a plain fetch; look for the category path in the navigation and fetch
  that path, and read the product slugs — they usually spell out the format
  (`login:pass:token`, `with SMS`, `without SMS`).
- An anti-bot wall ("Browser verification / Проверка браузера — please wait") is
  NOT a dead shop and NOT interchangeable with the JS-shell case: the shop is
  alive but refuses non-browser fetches on every path. Say it serves prices
  only on entry, quote the category from a search engine's index/snippet
  instead of claiming the link is stale, and do not burn repeated extractions
  against the same wall.
- A category name that sounds right can hold a different product. A "boosting"
  category may be follower and like services rather than the identities
  needed; check the actual product titles.
- A shop that requires a login is not dead — it is a shop that hides its
  catalogue. Say so, and note that registration is free.
- A domain that does not answer is a domain to skip, and saying so saves the
  owner a wasted purchase.
- Distinguish a **shop that sells accounts** from a **service that publishes
  reviews for the client**. The second is the alternative to owning the pool
  at all: it has no account risk, no moderation attrition, and no capital tied
  up in identities. Present it as a real option with its own price, and let
  the owner choose — sometimes the honest comparison is that owning the pool
  is not worth it for the volume in question.

## Reporting the purchase list

Give the owner a table he can act on: platform, quantity, type of account,
delivery format, unit price, and total. Then the constraints that decide the
order — the geo shortfall in the proxy pool, the unservable device class, the
measured moderation ratio — and finally the one thing that must be bought
first for the rest to be worth buying. Attach the shop links with what each
one actually sells, not a bare list of domains.
