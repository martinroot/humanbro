# Exchange offer forms: fill mechanics and failure triage

Applies when the job reaches the point of filling a bid/offer form on a
marketplace. Read this before debugging a bid that "did not go out" — that
symptom has several unrelated causes and the checks below separate them in one
pass.

## Triage order (cheapest discriminators first)

1. **Is the gate reachable at all?** Read the newest log record for the listing
   and check the verdict plus any readiness flags. A listing that never became a
   candidate produces no bid and no error. Compare those fields against the
   bidder's filter — a mismatched verdict string, or a readiness check that
   demands a locally created agent-backed order, empties the pipeline silently
   while the feeds stay green.
2. **Did argv survive?** Pass generated text through a file rather than argv
   when the shell is known to mangle UTF-8. Probe before assuming: spawn a child
   that prints argv types and values. Bun coerces a numeric argument to string
   and preserves a Cyrillic file name, so a "missing id/file" throw means the
   caller built the command wrong, not that encoding is broken.
3. **Is the tab being closed underneath you?** `Target page, context or browser
   has been closed` on a form route usually means a periodic tab-cleanup job, not
   the page. Take a tab lock covering the whole run and re-check before suspecting
   selectors — a lock with a short TTL written once at script start expires
   mid-fill.
4. **Did the form actually load?** Compare `location.href` before and after
   navigation and count the expected field nodes. A silent redirect to the feed
   is indistinguishable from selector drift without them.

## Rich-text fields (Trumbowyg and similar)

Editors commonly mount over a hidden backing `textarea`:

- Filling the `textarea` directly does nothing the form reads — the submit path
  reads the visible `contenteditable` div. A proposal once went out with an
  empty name for exactly this reason, hidden behind `.catch(() => {})`.
- Working pattern: locate the backing `textarea[name=...]`, walk to the sibling
  editor div, assign `innerHTML`, dispatch `input` and `change` with
  `bubbles: true`, then read the backing `textarea` back to confirm the value
  propagated. The editor can exist without syncing, so read-back is not optional.
- Never leave a required-field write in a bare `.catch()`.

## Non-native selects

Vue-style comboboxes have no `select[name=...]`, so a plausible selector counts
zero. Anchor on the component container, click its toggle, wait for the option
list, then click a visible option. Walk up from the field's label to the nearest
ancestor that actually contains an input — a fixed number of levels lands on the
whole form and returns an unusable HTML dump.

Two traps in the same step, and they are easy to mistake for each other:

- **Click with a real Playwright locator, never `element.click()` inside
  `page.evaluate`.** These widgets open on trusted pointer events; a synthetic
  `click()` reaches the element but never opens the list, so the option query
  comes back empty. An empty list here means "the click did not register", not
  "there are no options".
- **Test visibility with `getClientRects().length > 0`, never
  `offsetParent !== null`.** A dropdown and its items are typically
  `position: fixed`, and `offsetParent` is *always* `null` for such elements, so
  an `offsetParent` filter discards every real option and reports an empty list
  against a fully populated menu. The same null-`offsetParent` rule silently
  swallows submit buttons rendered in an overlay: they exist, they are not
  found, and the form never appears to be pressed.

Distinguish the two by inspecting the container: if the option nodes are present
in the DOM with text but your filter rejected them, it is the visibility test;
if no option node exists at all, it is the click.

## Minimum-length validation

Some exchanges refuse to submit a description shorter than a fixed character
count and report it as a field error while leaving the form open. Read the
rejection text out of the form instead of guessing: capture visible
field-error nodes right after the submit attempt, together with the current
length of each field's backing value. A template that is natural to read and
short enough to look deliberate is exactly the one that gets rejected, so keep a
separate generator for exchanges with a minimum and assert its length before
submitting rather than discovering the limit through a failed send.

## Reading a section, not the first block

Scoped containers repeat across a page, and the first match is frequently a
status badge ("You applied") rather than the content you came for. Anchor on the
section heading and take its **next sibling**, not `querySelector(".panel")` or
`document.body`. A description that reads as a fragment ("31 chars, says You
applied") is a selector bug, and it is invisible unless the step asserts on
content it expects.

## Two forms, not one

A listing page commonly carries a chat/reply form **and** a separate
delivery-with-attachment form, with different actions. Clicking the reply
button twice never delivers a file: the second click re-posts text, and a run
that reports "delivered" on that basis is fabricating its own success. Address
each form by its own action attribute, and give the delivery step its own
existence check.

## Missing inputs are a question, not a failure

When the brief has no input file, the correct end state is a targeted question
to the customer and a stop — not a failed delivery and not a silent skip. Build
the question from the brief's own wording (which noun it is missing) and send it
through the chat form. A delivery step that cannot run because the input is
absent is **correct behaviour**, so the pass/fail count must not treat it as a
defect, and the run should assert that the question went out. Silently dropping
the listing is the one outcome that is wrong.

## Confirming a delivery fact

A run that ends "delivered" is only credible if something independent of the
submit click supports it: the attachment re-read from the listing page, the
exchanges own submissions view, or a server read-back. Where the underlying
system is a **test double you control**, remember the double must also *render*
the state it accepted — a double that stores a delivery but shows nothing on the
page makes the only available verification impossible, and the pressure will
land on the check being loosened instead. Append state blocks rather than
overwrite, so one kind of record does not erase another from the same view.

## Diagnostics

- Inside `page.evaluate` use **Latin identifiers only**. The function is
  serialized, and Cyrillic local bindings reach the browser as
  `ReferenceError: <name> is not defined` while the same code passes lint. Keys of
  the returned object may be Cyrillic; local bindings may not.
- **`page.evaluate` takes exactly one argument.** Passing two or more throws
  `Too many arguments. If you need to pass more than 1 argument to the function
  wrap them in an object` — pack them into one object and destructure inside the
  callback. Note the related scoping trap: a `const` declared inside one step is
  invisible to a later step that needs it, so hoist any value two steps consume
  to the outer scope when you add the consumer.
- Never share one try/catch across several `waitFor` locators: it reports "form
  did not open" and names no field. Wait per field, then log which failed plus
  the post-navigation URL and title.
- **A closed form is not a sent offer.** After pressing submit, a redirect away
  from the form with no field errors is equally consistent with success and with
  the dialog discarding an invalid draft. Confirm from the exchange's own
  listing of your submissions when one is machine-readable; if it is not (SPA
  tab, no stable URL), say the send is unconfirmed rather than reporting
  "submitted" on the strength of a vanished dialog.
- Keep read-only markup probes in the project. They inspect selectors, labels,
  visibility and fill semantics without touching the submit path, and they are
  the fast way to re-learn a form after every change.
- Run scripts from the project directory with the absolute runtime path so
  relative log and state files resolve against the project root.
