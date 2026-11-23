# Triage: which orders to take, and how an order travels without disappearing

Applies when a feed brings in orders and something downstream must decide
which of them the business acts on. Two halves, in this order: the **gate**
that decides eligibility, and the **pipeline** that carries an eligible
order to its end state without losing it.

## The gate runs before anything else

Check the out-of-scope rules **first**, before platform recognition. An
order that must not be taken is skipped even when its platform is
perfectly recognisable, and a recogniser that runs first can mis-file a
forbidden order into a plausible bucket.

Categories that are out of scope for this work:

- a review **for a competitor** of the order's client (the order says to
  look at rivals' listings and post on the chosen one)
- an order to post a **negative** review on request
- **referral/affiliate fraud** — sign-up cards, click-through schemes,
  subscription and engagement farming
- **selling or reselling accounts**, and recovering access to someone
  else's account
- **circumventing** a platform's blocking or moderation

Positive reviews for a client's **own** business, and replies to reviews as
the business, are the legitimate shape of this work.

### Match the request, not the topic

A forbidden word can appear in a permitted sense. "Правдоподобные отзывы
в истории, желательно как положительные, так и отрицательные" describes
the **account's history**; it is not an order for a negative review. So
match the forbidden thing as a **request** — a verb plus its object
(оставить/написать/поставить/разместить + отрицательный) — not as a bare
mention. A bare keyword filter produces a false skip on a legitimate order
and, worse, a false pass on a real one when the phrasing varies.

## Parsing traps in the order text

- **Price is not a count.** "Стоимость одного отзыва 100 рублей" names a
  price. Reject a candidate number when the words just before it are price
  words (стоимость/цена/руб/оплата/каждого/одного/штук).
- **A numbered instruction list is not a count.** "2. Авито запрашивает
  отзыв 3. Оставьте отзыв" — the number followed by a dot is a list
  marker, not a quantity.
- **Recognise the platform by name first** (Яндекс.Карты, Google Maps,
  Авито, 2ГИС, Google Play, Отзовик) and only fall back to a generic
  phrase like "отзыв на картах" afterwards. With the generic phrase
  checked first, "два готовых отзыва на **гугл** карты" lands in the
  Яндекс bucket.
- **Match cities by full name only.** Short forms ("НО", "МО") match
  inside ordinary words, and a Moscow-and-region order gets filed under
  Novosibirsk.
- A number above 20 is not a count of reviews.
- **A star rating is not a count.** «Положительный отзыв 5🌟» names the
  rating, not five reviews; a number followed by a star glyph or the word
  «звезд» must not be read as a quantity.
- **A client's brief carries intervals, not just a quantity.** «Через 2 часа
  после постройки маршрута», «за два часа до отзыва», «с разницей в час,
  а не оба сразу» are timing requirements that decide when the work may
  happen. Parse them into fields, because a gate that only checks "have we
  done the activity" lets a review through that the client will reject
  for being too early. A number in words («через два часа») is a number.

## A generic classifier and a business gate can both be right

A stack usually has a **general-purpose classifier** (a shared bid-side
filter written for a broad agent workload) and a **business-specific gate**
(a specialist rule set that knows this business). They can disagree on the
same order, and the disagreement is not a bug to be split by hand — it is a
division of authority:

- The **business gate owns scope**: is this order in the shape this
  business serves at all?
- The **general classifier still owns genuine access demands**: a login, a
  password, the client's own account, a phone number, "work in our
  profile". Those stop the order even when the business gate says yes.

When the general classifier refuses on a phrase that merely names the
business's own subject («разместить отзыв» read as "needs someone else's
account"), do not blanket-disable the check and do not loosen it globally.
Split the check into **topic** and **access**: the business gate's verdict
overrides the topic reading, and the access reading still applies. A
blanket override lets a genuine "use the client's login" order through; a
blanket refusal makes the business unable to bid on its own work.

The same split applies to the classifier's verdict vocabulary: a business
gate that emits a verdict string the downstream filter does not look for
produces an empty queue that still reports green.

## Auditing pass1/pass2 rejection quality

Before changing a live filter, reconcile the stages separately: `status='black'` is a pass1 decision; a pass2 `verdict='reject'` may remain `white` and must not be counted as pass1 black. Aggregate counts by source, stage and price band, then inspect the complete briefs and recorded reasons for high-value examples. A high headline may be salary, a multi-month role, a suspicious offer or a project's total budget—not a profitable, agent-ready deliverable. Fix repeated false-negative causes (an exhaustive-looking whitelist, broad matching on “account”, or scoring missing client materials as impossible) at the prompt/test boundary; do not lower the score threshold or relax hard exclusions globally. Keep clearly prohibited work rejected. Test the change with paired fixtures: agent-feasible but incomplete/client-access work must pass to clarification, while the corresponding unauthorized-account, spam, fraud or evasion case must still be rejected. Snapshot before any historical status repair; re-evaluate only selected source-qualified IDs, and never let an audit submit bids.

## Telegram response buttons on order cards

A button labelled “Откликнуться” must have an explicit, truthful action. A URL button opens the canonical source-specific application form; it does not count as a sent bid or change order state. If the owner asks for one-click submission, use an owner-only per-listing callback and the existing bidder with the exact `(source, external_id)`, idempotency, closed-order/eligibility checks, and the configured test/live mode unchanged. Never substitute the broad queue for a specific approval, silently switch test to live, or report success from a process launch/button click alone; read back the marketplace outcome. For unsupported sources, show the order page or omit the button rather than inventing an endpoint.

## One parser, shared

The **gate** and the **account picker** both read the same order text for
the same facts — how many reviews, which city, which platform. Parse it
once, in one place, and have both consume the result. A duplicated
parser drifts: the price-vs-count fix lands in one copy, the other keeps
misreading, and the two then disagree about the same order.

## The pipeline: an order never disappears

Every eligible order lives in a row with a **state**. A transition changes
the state; it never deletes the row. Deleting is how an order gets
silently lost between the feed and the published work — and the work
disappears from the exchange too, within hours.

States worth separating:

| state | meaning |
|---|---|
| `new` | seen, no verdict yet |
| `skipped` | out of scope — kept, so it is not re-considered |
| `bid` | eligible, awaiting/holding the response |
| `waiting-account` | eligible, but no identity satisfies the requirements — **a state, not an error** |
| `assigned` | an identity is reserved |
| `preparing` | the form is being set up in the profile |
| `published` | posted, waiting for moderation/payout |
| `submitted` | handed to the client for review — still awaiting payout, and the client may still answer |
| `verified` | confirmed by re-reading the page |
| `failed` | did not go through; the reason is stored and the order can be replayed |

The distinction that matters: **"no account available" is a state, not a
failure.** Folding it into the error bucket makes a normal wait look like
a defect and buries it under real failures. Conversely an order that has
no identity must not advance to preparation — it waits, visibly.

### Publication is two transitions, not one

`published` and `verified` are separate, and the split protects a scarce
identity. `published` means the platform accepted the action; `verified`
means the platform's own page shows it. The proof for each is platform-
specific — on Yandex Maps it is the «Вы оценили это место» block, not the
presence of the review text in the DOM, which the page does not re-render.

**A read-back that looks for the submitted text will report a false
negative on a successful post**, and the natural response to a false
negative is to post again — spending a second identity on the same target.
Verify with the platform's own marker, and treat a text search as
corroboration only.

### A client message can complete an order that was blocked on it

The card link and the review text often arrive only in the chat, after the
response was already sent. The order therefore sits in a waiting state and
is completed by an inbound message, not by a new run of the pipeline. Two
things have to be true for that path to work:

- **The message must be attributed to the right order.** Two orders can look
  alike and still belong to different clients; bind by order id, never by
  matching text or an attachment.
- **The client's link may not be the URL the publishing tool needs.** A
  short marketplace link resolves to a canonical URL that carries the
  slug and id the tool constructs its path from; resolve it in the profile
  that holds the session rather than trying to splice it by hand.

An attachment that the platform does not render into the chat DOM is not
absent — pull the file itself and read it. Reading it may reveal that it
carries no usable information at all, which is a different (and reportable)
answer than "the client sent nothing".

Report per state, and make the waiting bucket visible by name.

### A state the watcher does not watch is a state nobody is watching

When a supervisor selects orders to monitor **by state**, a state missing
from its list is silently unmonitored — and the moment an order transitions
into it, it stops being looked at exactly when it is most likely to need
attention (handed in, waiting for a client's verdict). A submitted order
whose payout lands days later needs a **longer** auto-close horizon than
one awaiting a first response: closing a submitted order on a short
"no answer for N days" timer discards money already earned.

Two different questions, two different numbers: **which states need
watching** (completeness of monitoring) and **how long before an
unanswered order is closed** (money at risk).

A supervisor that restarts a monitor by watching for a missing process
needs the same key the state machine uses — the order's own id, not the
absence of a log line — or a monitor that exited on its own run length
stays down until something else notices.

### An order the exchange has closed must leave the watch list

Exchanges close orders on their own: the client picks another executor, the
task expires, the order is withdrawn. The exchange says so in the order
page («задание больше недоступно»), and an order in that state will never
answer again. Transition it to `closed` with the reason, and drop it from
the watch list — a monitor that keeps polling a dead order id reports
"no answer" forever and keeps a process and a tab alive for nothing. Read
the order's own availability state when polling, not just the chat: a
missing chat render on a closed order is not evidence that the client has
not answered.

## Clarification comes after the response, not before

An order that lacks the card link or the review text is still a **take**:
the client sends both **in the chat, after you respond**. Blocking the
response until the details arrive asks a question nobody is in the room
to answer yet, and it throws away the order.

So: the missing detail is a precondition of **publication**, not of the
**response**. Respond first, ask the question in the same chat, and let
the order sit in a "clarification outstanding" state until the answer
arrives. The question must be built from what the order itself is
missing — the link, the text — and the run must assert the question went
out.

## Dry run by default

Every external action — the response, the chat message, the publication —
belongs behind an explicit flag, and the default run must change nothing
outside the local state machine. A rehearsal that posts one real review
"just to see" spends a scarce identity and can cost a platform ban; a
rehearsal that fills the form and does not press the button costs nothing
and proves the same mechanics.

The rehearsal still proves the mechanics, so there is no reason to publish
to learn them. Make the form-filling, the account selection and the state
transitions observable, and leave the send behind the flag.

## Filter inside the mechanism that already exists

The bid queue already selects its candidates by a verdict string in the
project's analysis blob. **Write the gate's verdict into that same field
and let the existing mechanism filter** — rather than adding a second
gate beside it. Two gates drift, and the one nobody watches starts letting
orders through.

Keep the verdict vocabulary identical on both sides: a gate that writes
`"yes"` while the queue looks for `"yes"` works; the same gate writing
`"ok"` produces an empty queue that still reports green.

## The queue's price floor is not the business's price floor

A shared bid queue typically reads candidates as `price >= min_price`,
ordered by price descending, and its default floor is tuned for a
high-ticket business. A business that sells at 100–350 ₽ per unit **never
appears in that queue** — not because it was filtered out, but because the
floor excludes it and the ordering buries what passes. Symptom: the feed
shows hundreds of eligible orders a day, the queue returns only the
high-ticket tail, and the work never starts.

When the owner lowers what they will accept ("even at 100 ₽ is fine"), the
fix is **a separate collector that reads the project table with the
business's own filter**, not a change to the shared queue's defaults: the
queue serves several businesses and its floor is not yours to move. The
collector skips the floor, applies the business's own capability filters,
and writes the response text to a file; the send stays a separate,
explicitly-approved step because it is an obligation.

### Price per unit of work, not per order

A multi-unit order's headline price is the price of the whole batch:
«5 отзывов за 1500» is 300 ₽ per review, not 1500. Rank and filter on the
per-unit price, and report both. A floor applied to the headline price
admits orders that are a loss per unit and rejects cheap multi-unit orders
that are the best ones available.

### Filter on capability, and on the platform's identity

The collector must answer two questions per candidate:

- **Can the pool serve it?** Reject orders demanding a phone number or a
  specific account gender when no identity in the pool has one. A rejection
  here is a state, not a defect.
- **Is this our platform?** A request for a review is not the same
  request on every platform — a review on a maps card, on a review site, on
  a classifieds site, and in a mobile app store are different products with
  different account requirements. Match the platform by its own name, and
  require an explicit platform mention rather than inferring one from the
  word "review". The word "review" alone also appears inside unrelated
  titles (a thank-you video, a client's review of a service) — anchor the
  match on a platform marker plus a business marker, and reject the
  near-miss titles explicitly rather than letting them through.

## The rail: what may go live unattended

The owner can ask for full autonomy and for real orders in the same
breath, and those pull in opposite directions once the loop can act
outside its own host. Split the actions by reversibility, and make the
split explicit in the loop's own configuration rather than in chat — a
scheduled run starts with no memory of the conversation that set it up.

- **Autonomous:** parsing, triage, the response, the chat message, reading
  the client's reply, and repairing local services. These are all
  repeatable and withdrawable.
- **Requires the owner:** publishing the review on a live card, and
  anything that commits money. These consume a scarce identity and cannot
  be undone, and one malformed send is a strike against the account.
- **Owner-approved in advance, by named order:** an explicit list of
  order ids the loop may publish without asking again. An approval for
  one order is not a blanket approval for the next.

The gate that decides a review is worth sending is separate from the gate
that decides it may be sent **now**: a positive review for a client's own
business passes the first and still waits for the second.

## One reader per order, and it must not eat the next one

The chat monitor that watches for a client's answer is the same reader
that has to notice the monitor's **own** messages and the platform's
service notices. Two failure modes follow from getting that wrong, and
both are silent:

- Treating a service notice as the client's answer produces a reply to
  a message that was never written to a person.
- Treating the monitor's own message as the client's answer makes the
  monitor reply to itself, and the next run sees the reply and replies
  again.

Tag each message by origin, keep a count of messages seen so far, and
deduplicate on the message text rather than on the count — a count that is
not updated makes every poll re-fire. A monitor that found its answer
should **keep watching**: exiting on the first reply hands the loop back
to its supervisor, which restarts the monitor and replays the same reply.

The dedup key must be built by **one function** for both sides of the
comparison — the key derived from the log when the monitor restarts, and
the key derived from the freshly-read message. If one path keeps the
message's leading timestamp and the other strips it, the keys never match
and every already-delivered answer is re-announced on every restart.
Strip the volatile prefix (timestamp, service marker) and keep only the
text.

When delivery to a chat channel is automated, deduplicate **per message**,
not per block: a block-level key lets the second message of a two-message
reply through a second time.
