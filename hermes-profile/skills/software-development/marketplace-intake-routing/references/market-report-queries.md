# Reading the day's market state out of the databases

Companion to the intake skill. A daily report ("how many applications today,
per exchange, per agent, what is closed, what is still open") is answered from
**two different databases**, and mixing them up produces confidently wrong
numbers.

## Two databases, two questions

| Database | Question it answers |
|---|---|
| The management database (MariaDB, e.g. `joblock` on 127.0.0.1:3306) | **The market side**: how many cards the parsers ingested, how they spread across exchanges and agents, and how far the agent fleet got. |
| The delivery registry (SQLite, e.g. `browser-automation/reviews/data/registry.db`) | **Our own work**: which orders we took into our pipeline, what we published and handed back, and what is still waiting. |

The two do not overlap. The MariaDB `orders` table counts *cards the pipeline
ingested*; the registry's `flow` table counts *orders we took into our own
review pipeline*. Reporting one as the other inflates or deflates the day's
work by orders of magnitude.

## Management database: the market side

Tables: `market_projects` (the cards), `orders` (the pipeline's mirror of
them), `agents` (the fleet with `run_count`, `orders_ok`, `orders_need`,
`orders_fail`).

```python
import pymysql
c = pymysql.connect(host='127.0.0.1', port=3306, user='root', password='',
                    database='joblock', charset='utf8mb4',
                    cursorclass=pymysql.cursors.DictCursor)
cur = c.cursor()
```

Useful queries:

- cards per exchange per day —
  `select source, count(*), sum(price) from market_projects where created_at >= CURDATE() group by source`
- cards per agent per day —
  `select agent_slug, count(*) from market_projects where created_at >= CURDATE() group by agent_slug order by 2 desc`
- cards still waiting for an agent — `agent_slug` empty, or `status_note` = «ждёт назначения агента»
- fleet throughput — `select slug, run_count, orders_ok, orders_need, orders_fail from agents where status='live'`

Traps:

- **The money column on the project table is `price`, not `amount`.**
  `sum(amount)` raises `Unknown column` and aborts the whole script.
- With `DictCursor` a row dict carries exactly the columns you selected — a
  `select count(*)` result has no `analysis_json` key and reading it raises
  `KeyError`. Select the columns you will read.
- `created_at` is the **ingestion** timestamp, not the card's publication time
  on the exchange — "today" means "ingested today".
- The order-status ENUM is
  `new/queued/running/done/failed/paid/needinfo/blocked`. A day showing only
  `new` and `needinfo` means the fleet classified but did not execute: report
  that as a **backlog**, not as failures.
- `orders.job` names the assigned agent slug and `orders.agent_code` its code;
  an empty `job` means the card was never assigned.
- `replied_at` is the honest field for "did we answer this one" — a project
  row can carry a `reply_text` with no timestamp. Count `replied_at is not null`.

## Delivery registry: our own work

Tables: `flow` (one row per order we took; `state` is the lifecycle), `steps`
(the pipeline steps performed per order), `accounts` (the identity pool),
`reviews`, `jobs`, `events`.

- `flow.state` values in use: `bid` (bid sent, awaiting the customer's card),
  `preparing` (gates not yet passed), `waiting-account` (no identity or no
  card link), `on-review` (delivered, waiting for moderation), `closed`
  (customer closed the task).
- `flow.target` holds the **exchange's own order id** for our own orders —
  look orders up by it, never by the local row number.
- **A `reviews` table can be empty while the day's work was real**:
  publications are recorded in `steps` (with `ts`, `ok`, and a note naming the
  account and the moderation state). When a report needs "what was published",
  read `steps`, not `reviews`.

## Reading it as one report

Lead with the conclusion, then the breakdown: cards per exchange (market
side), what we took and what we delivered (registry side), the open backlog by
cause, and the identity pool's readiness as its own short table (per identity:
proxy IP, login, registry row).

State the **observation moment** for anything time-varying: an egress IP from
a rotating mobile pool, a moderation verdict still pending, a customer who has
not answered. A report that mixes "confirmed" with "observed once" is worse
than one that marks the difference.

Two failure modes worth naming explicitly in the report, because they change
what the numbers mean:
- a **read that could not be performed** (a monitor or chat reader that fails
  mid-run) means the state of that channel is taken from the registry, not
  from the live conversation — say which;
- a **repeated 404 from a delivery endpoint** means one leg of the loop is
  dead while the others look healthy; report it as an open defect, not as
  "no deliveries happened".
