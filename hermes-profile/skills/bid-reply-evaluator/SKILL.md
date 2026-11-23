---
name: bid-reply-evaluator
description: Use when tuning bid reply prompts or the order feed.
---

# Bid reply evaluator

Use when changing reply text, portfolio-link rules, the reply model, or the
score threshold for the JobLock order feed. The owner corrects these repeatedly
and expects the fixed version on the first try.

## Reply text contract

- Keep it short: «Понял задачу. Сделаю. Работаю с X, Y, Z — <quality check>.
  Строго по ТЗ.» Long CV-style answers are rejected.
- Name 2–3 tools/models **comma-separated**, picked for this specific brief, and frame them as a ready agentic automated combine ( «готовый агентский автоматизированный комбайн» ), not a generic tool dump or a retelling of the brief.
- **Never retell the brief.** «Понял задачу: нужен реферат…» and «Задача
  понятна: заполню…» are rejected — the customer wrote the brief and can read
  it.
- **Never emit meta-reasoning about the model or its data.** «В предоставленной
  информации нет», «не буду приписывать себе портфолио», «я проанализировал»
  expose the evaluator and must never reach a customer. Write as a live human
  executor.
- Banned empty fallback: «Делал смежные задачи, возьмусь». Demand a concrete
  adjacent experience with a named tool.
- No «Добрый день», no promised deadlines or prices, no invented guarantees.
  Scam work gets «Не смогу помочь.» only. Keep the reply validator floor at 10
  characters so short refusals do not raise.

## Two prompts, two calls

The scoring call is **evaluation only**: score, verdict, risks, questions,
agentic feasibility, risk score, and a `comment` explaining why a project does
or does not fit. It must not produce reply text or contain reply instructions —
the owner describes projects and argues unsuitability in this call himself. The
reply is a separate model call with its own prompt. Never merge them into one
prompt even if that saves a call. The owner keeps an editable block of labeled
live-feed examples in the scoring prompt (why a project is good or bad); treat
that block as evaluation-only material and never let it leak reply text into
the scoring output.

Both prompts are owner-editable on `/mll`: `оценка.prompt` via
`GET/POST /api/mll2/score-settings`, `bid_reply.prompt` via
`GET/POST /api/mll2/reply-settings`. `mll2.score_prompt()` reads the saved value
and falls back to `score_prompt.SCORE_PROMPT`; `build_score_prompt()` appends the
orders to it. Put new prompt text in the settings/module, not inline in
`build_score_prompt()`. When the owner asks to change a prompt, point him at the
portal field instead of iterating prompts in chat.

## Scoring criteria (owner-set)

- Rate price adequacy in the scoring call: `price_score` 0–100 with a one-line
  `price_comment`. Below ~20 is an unrealistic bid, 20–49 far below market,
  50–79 near market, 80–100 good. A `price_score` under 50 without a small,
  well-defined scope caps the score around 60.
- Reject feed junk instead of writing a nicer reply: "take everyone", "publish
  a post", descriptions under ~40 characters with no actual brief get reject,
  score 0–20, and a reason in `risks`. When the owner names more junk markers,
  add them to BOTH `mll_filter.ПО_УМОЛЧАНИЮ` and `mll_settings.json → mll.чёрный`
  (the saved copy overrides the default), then mark matching already-passed
  `white`/`ready` rows `black` so the feed clears immediately.
- Why a project fits or not belongs in `comment`/`price_comment`, never in the
  customer reply. Keep scoring prose out of the separate reply call.

## Portfolio and models

- Give the evaluator the **whole** model registry and the **whole** portfolio
  subcategory catalog; let it choose by meaning and synonyms, never by exact
  keyword hits. A keyword selector is a last-resort fallback only when the
  model repeatedly omits a required link.
- Generative / image / video / music / voice / design work requires at least
  one `apimedia.live/portfolio/...` subcategory link; coding and plain text
  do not.
- Pick the **exact subcategory** for the brief (`/portfolio/video/ads/` for an
  ad reel, `/portfolio/image/infograph/` for infographics); never emit a bare
  group link such as `/portfolio/video/`. Two precise links are acceptable when
  the brief spans two work types.
- Scoring stays on `openai/gpt-6-luna`. Never switch to a pricier model such as
  `gpt-6.1-sol` without explicit owner approval. Keep the reply draft a
  **separate model call** from scoring.
- After an uncertain marketplace submit, block retries until a fresh read-back
  or an owner decision; a second click can duplicate the response.

## Tuning workflow the owner expects

- He edits prompts himself through the portal page `/reply-test`: model select,
  editable prompt, output, a dropdown of the last 20 real orders (selecting one
  fills the task text), a notes field whose `POST /api/reply-test/fix-prompt`
  asks MLL to apply his remarks to the sandbox prompt, and a «💾 Сохранить
  промпт» button that commits the edited text via `POST /api/mll2/reply-settings`.
  MLL prompt fixing stays sandbox-only, but the manual save deliberately writes
  the working settings; never submit offers from this page. Provide these
  controls instead of an agent-mediated prompt-iteration pipeline.
- The order dropdown fills the task text with a «Вложения:» block built from
  `analysis_json.details.attachments` and `raw_json.attachments`: filename,
  extension, human-readable size (КБ/МБ) and MIME type, deduplicated by name.
  A model that cannot see attached-file metadata answers as if no material was
  supplied, so carry the file list into the sandbox task text.
- Resolve owner-named funnel stages through the label table in `orders_page.py`
  before writing SQL for that dropdown: «оценка_вайт» is `ready`, while `white`
  is labelled «white list». Guessing from the English word returns the wrong
  set — count the rendered `<option>` elements against the portal's own count.
- For a config change, change the **existing** knob. Raising the feed threshold
  meant editing `mll_settings.json` `mll2.min_score` 40 → 70 — not adding a
  parallel threshold setting plus filter functions. Remove such machinery if
  it was added.
- The visible bug is often in the display path: a card can show an old
  `reply_draft` from `offer_drafts` even after a fresh separate call. Mark the
  pass2 record with `reply_from_separate_call` so `tg_notify.послать_ready`
  skips the `offer_drafts.ensure_from_pass2` override, and resolve cards opened
  from a Telegram callback by database PK before falling back to external ID.
  Verify the text actually rendered in the Telegram card before claiming a new
  prompt is live.
- Normalize portfolio URLs before returning a reply: the model omits the
  trailing `/` on apimedia.live subcategory links and the broken link reaches
  the Telegram card.
- Coerce malformed model output before it reaches strict validators in the
  pass2 loop: one bad field that raises leaves the row unscored, and the loop
  re-evaluates the same batch forever instead of skipping one order. Run the
  sanitizer BEFORE `validate_pass2_item`: parse numeric ranges out of strings,
  clamp int fields to 0–100, map garbage to `null`, and keep the raw catalog
  untouched. Add a test that the malformed field becomes an accepted value.
- When rewriting a saved prompt wholesale, first list the rules the old prompt
  carried (SSH access requests, `reviewing_prices` not being a scam signal) and
  carry each one over. Prompt-contract tests catch a rewrite that silently
  deleted a safety rule.
- When asked for a simple change, do not add test tables, config modules, or
  batch scripts unprompted; he calls that overcomplication and will take over
  the tuning himself.
