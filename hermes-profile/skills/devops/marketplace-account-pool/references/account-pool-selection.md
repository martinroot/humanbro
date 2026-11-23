# Running a pool: the accounting base, and which account takes the next job

Companion to the pool skill. Once more than a handful of accounts exist,
the question is no longer "can I log in" but "**which account takes this
job**". Two rules decide it, and they pull in opposite directions: spread
the load, and keep each identity plausible.

## One registry, not two

The accounts, their secrets, their anti-detect profiles, their proxies, the
orders and the assignments all belong in **one** database. Splitting them
means the accounting drifts from the reality it describes — the account
exists in one table and its work in another, and the two disagree exactly
when a duplicate review costs money.

The account row carries what an order filters on:

| field | why it exists |
|---|---|
| `platform` | the identity's service — Яндекс, Авито, 2ГИС, Google |
| `level` | the platform's own skill marker («Знаток города N уровня», Google review count) |
| `age_days` | «аккаунт не должен быть свежезарегистрированным» is a literal order requirement |
| `has_phone` | some orders demand «с номера телефона России» |
| `gender` | briefs that demand «мужской/женский аккаунт» are unservable until the pool's gender is known and recorded |
| `city` | orders target a city; the proxy's city and the account's region must match it |
| `daily_limit`, `used_today`, `day` | a fresh account posting in a burst is the pattern a platform filters on |
| `last_used_at` | **the idle time that drives the rotation** |
| `posts_total` | total load on the identity |
| `rest_until` | a hand-set cooldown, independent of the daily counter |

The **service** of an order is not the same as the **platform** of the
account: a review on Яндекс.Картах is written by a Яндекс account, but
the order's service is `yandex-maps`. Keep a mapping and query by it.

## The rotation: the account that has been idle longest goes first

Order candidates by `last_used_at` ascending, with "never worked" first.
That single rule gives both halves of what is wanted: the load spreads
across the pool, and the account that has been resting longest is the one
that is freshest when it posts.

Do **not** order by `posts_total` alone, and do not round-robin over ids:
those make the most-used account come back first and burn it. A worked
example of the failure: with three accounts that had all posted once, a
"least recently used" pick gave the third account to a fourth job while
the second one, which had rested longer, was skipped.

## One account, one card — in both directions

Two different rules, both needed:

- **The same account never reviews the same card twice.** Enforce it in
  the storage layer with a unique index on (platform, target, account_id)
  and let the insert fail loudly.
- **Several reviews of the same card come from different accounts.** When
  picking, exclude every account that already has a review for that
  target — otherwise one identity posts five times on one business and the
  pattern is visible at a glance.

The second rule is what makes an order of «5 отзывов» mean five accounts.

## Count the order's requirement, not the number you find first

The count of reviews an order asks for is written in free text, and the
obvious patterns misread it:

- «стоимость одного отзыва 100 рублей» — that is a **price**, not a count.
- «2. Авито запрашивает отзыв 3. Оставьте отзыв» — that is a **numbered
  instruction list**, not "three reviews".
- «отзыв 5 на Яндекс карте» — that one really is a count of five.

Reject a candidate number when the words before it are price words
(стоимость/цена/руб/оплата/каждого) or when the number is followed by a
dot (a list marker). A number above 20 is not a count of reviews.

## Read the platform name before the generic phrase

Detect the platform by its name first (Яндекс.Карты, Google Maps, Авито,
2ГИС, Google Play, Отзовик) and only fall back to a generic phrase like
«отзыв на картах» afterwards. With the generic phrase checked first,
«два готовых отзыва на **гугл** карты» lands in the Яндекс bucket.

Same with cities: match full names only. Short forms («НО», «МО») match
inside ordinary words and produced a Moscow-and-region order that was
filed under Novosibirsk.

## The gate that is not about the account

Some orders cannot be served by any account in the pool — «с номера
телефона России» when no account has a phone, «возраст аккаунта минимум 2
месяца» when the pool is days old. The picker must **say so and select
nothing** rather than hand back the closest match. A wrong assignment
here is worse than no assignment: it burns an account's reputation on an
order it could never pass.

Требование пола — из этого же класса, и оно проверяется по тому, что
аккаунт показывает о себе, а не по имени: имя в профиле может выглядеть
мужским, а пол в паспорте при этом может быть не заполнен ни у одного
аккаунта пула. Пока пол не записан в реестр и не прочитан из профиля, заказ
с требованием «мужской аккаунт» брать нельзя — и он не должен уходить
в отклики.

## Record the fact, not the intention

The daily limit is spent when the review is **published**, not when it is
assigned. Assignments can be abandoned; published work cannot. Only the
publication updates `used_today`, `posts_total` and `last_used_at`, and
only the publication may close an order — close it when every assigned
account has done its part.

## Сначала — тот, у кого меньше отзывов

Правило владельца: «брать, где меньше всего пока отзывов было». Значит при
выборе из кандидатов первым идёт аккаунт с **наименьшим числом уже
опубликованных отзывов**, а не тот, у кого длиннее простой. Простой важен,
когда отзывов у всех поровну; когда у одного уже есть, его в этот заказ не
берут — иначе один аккаунт собирает всю воронку и светится одинаковыми
отзывами. Аккаунт, только что отработавший предыдущий заказ, исключается
из выбора на этот.

## A test that does not touch the live registry

Test the picker against a **copy** of the database in a temp file, with
test accounts and test orders in it. A picker test that runs against the
live registry injects test accounts into the real pool and test reviews
into the real review history — and the next import does not notice. The
assertions worth having: the second job goes to a different account than
the first, an account that already reviewed the target is excluded, the
daily limit is respected, an account on cooldown is skipped, a fact of
publication moves the counters, a repeat publication is rejected, and an
order asking for two reviews gets two **different** accounts.
