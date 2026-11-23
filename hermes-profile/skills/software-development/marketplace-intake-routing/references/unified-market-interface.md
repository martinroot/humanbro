# Unified multi-market order interface

When one platform accepts orders from several exchanges, the operator-facing
card and the bid/response form must behave identically across all of them.

## One adapter is the single point of truth

Keep a single module (`portal/marketplace_adapter.py` in the JobLock stack)
that maps `source → marketplace name, project URL, apply URL, keyboard, flow
steps`. Make the notification layer delegate to it:

- `tg_notify.url_отклика` must call the adapter instead of its own `if source ==
  …` ladder. Otherwise a newly enabled exchange gets a card but no apply URL,
  and the omission looks like a parser problem.
- Card text takes the marketplace name from the adapter so labels stay full
  (Workzilla, Kwork, FL.ru, Freelance.ru) while the canonical `source` key is
  preserved for storage.
- Read the active exchange set from saved settings (JobLock:
  `mll_settings.json → «биржи»`), not from a hardcoded tuple; expose it via an
  API endpoint (`/api/markets`) returning active markets, URL templates, and
  the shared flow.
- Verify with a focused test over EVERY enabled source: unify produces a
  non-empty apply URL, and every callback fits Telegram's 64-byte limit.

## Operator flow is a top-to-bottom sequence, not a numbered menu

The owner wants the work to read as steps, not as a feature list. In the
Telegram card, order the buttons: Orders → Agent catalog → Take to work →
Execution → Close. Put technical actions (order profile, session/archive
template, gateway handoff, topic, send result) behind one bottom button
labelled «Technique». Do not number the steps and do not surface technical
controls in the top menu — this is a presentation preference, not a cosmetic
one, and re-check it whenever the menu is regenerated.

## "Build from the skill base" is a pipeline, not a picker

An option that assembles a fresh pipeline from a skill library must do more
than list matching skills:

1. Gather candidates from the external skill catalog with synonyms for the
   owner's language (Russian `шортс` → `shorts`, `видео` → `video`); a plain
   search on the Russian title returns zero and makes the model reject
   everything.
2. Let the scoring model fit candidates to the brief and emit a plan:
   selected skills, pipeline steps, QA checks, three 0–100 scores.
3. Gate assembly on all scores ≥ 80; a low score must block creation.
4. Emit a NEW profile containing a `pipeline` skill with those steps/checks,
   plus the root quality playbook — never mutate the source profiles.
5. Keep a deterministic fallback (keyword overlap, neutral scores) so a
   provider outage degrades the option instead of removing it.

## Bid reply style: portfolio first, two phrases

The owner's reply must convince in the FIRST phrase that the executor has
done this kind of work. Structure: phrase one names a relevant past job from
portfolio («Есть опыт монтажа шортс…», «Делал парсеры маркетплейсов…»);
phrase two is just «Сделаю.». No greeting, no restating the brief, no stages,
no stack list, no promised deadline or price. Prefer fewer words over more.
When there is no exact experience, name adjacent work rather than inventing
it; for a scam use only «Не смогу помочь.».

When changing this style, update the persisted prompt copy as well as the
code default — otherwise the saved version wins and the change is invisible.
Also relax any minimum-length validator that rejects the deliberately short
reply, and remove contradictory lines from the scoring system prompt.

## Verify the whole chain, not only the UI

After any change here check: parser process alive, browser CDP feed tab open,
DB freshness advancing, API 200, and the scoring run actually writing statuses.
A green menu over a dead feed is the failure mode that costs the day.
