# Owner approval gate: self-written review text never publishes silently

Companion to the pool skill. Covers the gate between «we wrote the review text»
and «the review is on the card» — the part that must never be automated away.

## Why the gate exists

Two different sources of a review text, and they are not equal:

| Source | Who wrote it | Gate |
|---|---|---|
| The client supplied the text | the client | publish as given, no approval needed |
| **We wrote it** («напишите простой-добрый отзыв») | us | **owner approval required before publishing** |

The owner's rule: a review whose text we invented goes to him first, and he
says OK. This is not a formality — we are writing an endorsement of the
client's business, and a fabricated detail (a price, a deadline, an employee
name that was never mentioned) is both a false statement to a third party and
the fastest way to have the review removed and the account sanctioned.

**A generated photo is the same case.** Anything we produce — text or image —
goes through the same gate.

## The gate mechanics

Drafts live on disk, one set per order, under `reviews/data/drafts/`:

```
<target>.txt   — the proposed review text
<target>.meta  — organization, card URL, photo, the client's own brief
<target>.done  — owner's decision marker
```

The publish loop asks the gate before it publishes:

```python
if not approve.одобрен(target):   # .done exists and does not start with REJECT
    continue                       # wait, do not publish
```

So a draft is inert until the marker says so. A loop that publishes
"whenever a text is available" is the bug this gate exists to prevent — the
text being present is not approval.

**Commands:**

```
python reviews/approve.py                    # list drafts with their status
python reviews/approve.py <target>            # show one
python reviews/approve.py <target> ok         # approve
python reviews/approve.py <target> ok "text"  # approve with a rewritten text
python reviews/approve.py <target> reject "reason"
```

The approval is **text-binding**: `ok` with a replacement writes the
owner's wording into the `.txt` and the publish loop must read the text from
the draft, not regenerate it. A loop that regenerates the text after approval
discards the edit and publishes something the owner never read.

Report the draft to the owner in the **working group**, not a personal DM —
the group is where he answers. Confirm the chat id is the group, not a legacy
personal chat id left over in the env file.

**What the owner gets is text.** The draft, the card link, the organization
and — only when the review really carries a photo — the file name. He asked
to approve the wording, not to receive image files «for approval»; a picture
pushed at him when the brief asks for no photo is noise, and he said so
explicitly. Attach a generated image only when the client asked for a photo in
the review, and even then it goes through the same gate as the text.

**When the brief asks for no photo, the review carries no photo.** «Скриншот
после написания» is a deliverable to the CLIENT (section «Two different
screenshot requirements» in `order-attachments-and-screenshots.md`), not a file
for the review form — attaching the card's own photos or a generated image
there is unsolicited work the client did not order. A brief that mentions a
picture in the ATTACHMENTS («адрес и название компании прикрепил») attaches
the card to identify the business; it still does not ask for a photo in the
review.

**Only an explicit approval marker counts.** A draft's `.done` file exists
while the owner has not answered yet — an empty or pending marker must NOT
satisfy the gate. The check is: the marker says OK (and only OK), the
owner's rewritten text is read FROM the draft, and a REJECT marker blocks.
A gate implemented as «the marker exists and is not a rejection» lets a
pending draft through and publishes a review the owner never read.

## Generating a review text when the client asked us to write it

Some briefs say: «напишите простой-добрый отзыв», «напишите отзыв сами»,
«своими словами». Then no client text will ever arrive, and waiting for one
stalls the order forever. So the loop must be able to write it.

Rules for generated text:

- **Truthful and unspecific.** No invented prices, deadlines, employee names,
  service outcomes or visit details. Generic service praise is acceptable;
  a specific false claim is not.
- **Short.** Clients ask for «простой-добрый»; a long text reads as
  inauthentic and the moderation side of the platform notices.
- **Varied across orders.** Keep several phrasings and pick deterministically
  from a hash of the order id, so the same order always gets the same text
  (re-runs stay consistent) while two different orders never get an identical
  one — two identical reviews on different cards is a pattern, and patterns
  are what the platform filters on.
- **One review per card, from one account.**

## Отзыв пишется ПО ТЕМЕ чужих отзывов, а не по шаблону

Правило владельца: «читать чужие отзывы и писать чет по теме. Там будет
попадание норм». Шаблонный текст («Хорошее место, всё понравилось») — это
ровно то, что модерация режет, а заказчик не принимает: одинаковый текст у
всех исполнителей виден сразу.

Процедура:

1. **Прочитать чужие отзывы карточки/профиля** (на карточке — готовым
   парсером, на профиле — отдельным скриптом; см.
   `references/yandex-maps-profile-route.md`).
2. **Отдать их модели как контекст** с инструкцией: писать от первого лица,
   2–4 предложения, только по темам, которые там реально упоминаются.
3. **Ответ модели — не текст, а кандидат.** Проверить его и, если нужно,
   сгенерировать несколько вариантов и выбрать лучший.

Ограничения промпта (каждое закрывает свою ловушку):

- **Не выдумывать** того, чего в чужих отзывах нет: цены, сроки, имена.
- **Не называть имён** из чужих отзывов (имя инструктора из чужого отзыва
  выдаёт, что текст списан) — только «инструктор», «сотрудники».
- **Не повторять устойчивые штампы** («незабываемо», «не передать словами»,
  «рекомендую компанию», «эмоции не передать») — их повтор срезает как дубль.
  Своими словами: «впечатления остались лучшие», «хочется возвращаться».
- **Не копировать дословно** — переформулировать своими словами.
- **Род отзыва — род аккаунта.** Аккаунт с женским профилем и текстом
  «получил сертификат» выдаёт себя сразу; пол проверяется по паспорту
  Яндекса. Если пол неизвестен — писать безличными оборотами.
- **Длина — как у чужих** (2–4 предложения). Короткое «всё понравилось»
  выглядит как спам.

Текст, написанный по теме, всё равно проходит гейт владельца: это наш
текст, значит — черновик, а не молчаливая публикация.

**Готовый модуль — не пиши новый.** В проекте уже есть
`reviews/topic_review.py`: `чужие_отзывы(порт, ссылка)` читает чужие отзывы
(на карточке — готовым парсером, на профиле — `yandex-profile-reviews.ts`),
`написать_по_темам(дамп, организация, род)` отдаёт их модели с уже
встроенными ограничениями (без чужих имён, без штампов, род по аккаунту).
Собирай текст через него, а не новым вызовом модели со своим промптом —
каждое ограничение выше уже зашито, и новая копия промпта их потеряет.

**Порядок: минимум несколько вариантов, потом выбор.** Один вызов модели
даёт текст с дефектом, который видно только при чтении (не тот род, «не
за виражи не платила» из чужого отзыва). Генерируй 3–4 варианта и выбирай
глазами; дефекты одного варианта не видны, пока не сравнил с другими.

**Род берётся из паспорта аккаунта, а не из ника.** Аккаунт с именем
«Dorcas…» — женский: текст «получил сертификат» выдаёт себя с первого
слова. Проверяй ник аккаунта перед генерацией и передавай род в модель
явно.

## Parsing the client's chat: instruction ≠ review text

The chat contains instructions, links, and sometimes the review text, mixed.
The failure mode is picking the longest line (usually the client's long
brief) and then discovering it is an instruction — the review text is then
reported as absent and the order stalls.

Order the steps so this cannot happen:

1. Collect candidate lines from the client's messages.
2. **Filter instructions out first** — lines that ask for something («найди»,
   «напишите», «подходит вам задание», «выключите гео», «прикрепите
   скриншот после написания») are not review text.
3. **Then** pick the review candidate: the longest remaining prose line, and
   a line that looks like an actual review (a sentence about the experience),
   not a URL.

Filtering after the choice nulls the whole result — the longest line is
usually the brief, and the longest line is exactly what a naive picker
grabs.

An attached image is not a review example either. See the card-screenshot
rule in `yandex-maps-review-flow.md`.

## Когда в чате несколько отзывов: разбирать ПАРЫ «ссылка + текст»

Заказ на «оставить 2 отзыва» приходит одной пачкой, и порядок внутри неё
такой: **ссылка, затем отдельное сообщение с текстом, затем снова ссылка,
затем снова текст.** Между ссылкой и её текстом часто стоит указатель
(«Текст 👇🏻») — это МАРКЕР, а не сам текст отзыва.

Правила разбора:

- текст отзыва приходит в сообщении ПОСЛЕ ссылки, а не в хвосте того же
  сообщения — хвост ссылки («Текст 👇🏻») текстом не является;
- сообщение-указатель («Текст 👇🏻», «Текст👇») пропускается;
- каждая ссылка образует пару со СЛЕДУЮЩИМ сообщением-текстом, а не с
  самым длинным текстом в чате;
- отзывов несколько — значит пар несколько, и каждая пара уходит
  **своего аккаунта** (см. «One account, one card» в
  `references/account-pool-selection.md`): один аккаунт на две пары не
  годится.

Разбор, который берёт «самую длинную оставшуюся строку», на таком заказе
возвращает текст ЧУЖОЙ пары — и отзыв уходит на чужую карточку.
