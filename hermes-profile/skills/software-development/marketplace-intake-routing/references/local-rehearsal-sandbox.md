# Local rehearsal sandbox

A localhost exchange built to rehearse the whole bid loop — listing discovery,
gating, form fill, delivery, client follow-up — without spending reputation on a
live board. Applies when the live target is costly to get wrong (an offer is a
commitment, and a malformed reply is visible to the client) and the cycle needs
to be exercised repeatedly while it is still changing.

## Build the failure modes, not a happy path

A sandbox that serves ideal listings teaches the wrong reflex: it never exercises
the branches that actually break. Reproduce, specifically:

- **A listing that closes mid-run.** A second response on an already-taken
  listing must be refused, and a listing must be able to vanish entirely with
  the order page then saying so. Without this, "we replied too late" is
  indistinguishable from a code bug, and the cycle learns to retry forever.
- **A client who answers later, and may attach files in that answer.** This is
  the only way to rehearse clarify -> client supplies material -> rerun. If the
  sandbox cannot hold a listing open across a boundary, that branch is never
  tested and quietly rots.
- **Delivery is not the end.** After files are submitted the listing moves to
  an in-progress state; only the client closes it. A sandbox that closes on
  delivery teaches the agent to treat submission as completion, which is the
  error this whole verification discipline exists to prevent.
- **A client who never answers.** The listing must be able to hang indefinitely,
  or the cycle has no way to distinguish waiting from abandoned.
- **Forms that lie about their own structure.** Mirror the shapes that break the
  bot on the live target: a rich-text editor over a hidden textarea, a
  `position: fixed` popup with no `<select>`, and separate chat and
  delivery-with-attachment forms. Copying a generic form erases exactly the
  defects you built the sandbox to catch.
- **A range of briefs**: normal, missing-input, low-price (must be filtered),
  one requiring credentials, one that vanishes, one with several deliverables.
- **An event journal**, so a rehearsal can be reviewed after the fact rather
  than inferred from the agent's own report.

## The double must render what it accepts

When the sandbox stores a delivery, the listing page must show it. A double that
accepts a file and renders nothing makes verification impossible, and the
pressure to relax falls on the check instead of the double. Append new state
blocks rather than overwriting, so one kind of record does not erase another
from the same view. When a read-back disagrees with the step that claims to have
caused it, establish which side is lying before editing either — a sandbox that
hides an accepted file makes a correct bot look broken, and a bot that reports a
click it never made makes a correct check look broken.

## Capped queue reads hide low-priced work

A queue endpoint that takes a limit and orders by price returns the *most
expensive* N. Once the queue holds more items than the cap, everything cheaper
silently falls out of the response. A listing absent from the reply is then
indistinguishable from a listing that was never enqueued or was already
consumed, and the natural next move — hunting a dedupe or status bug — is
entirely wasted.

Before concluding a listing is missing, check the read's ordering and cap, and
count what the queue actually holds. If the cap can hide work, say so when
reporting, and fetch wider than the workflow consumes rather than assuming the
default covers it.

## Stale listeners make a fixed sandbox look broken

Restarting a sandbox in a loop while iterating leaves several processes bound
to the same port. The kernel load-balances between them, so a route the *old*
build lacks answers 200 while the fixed one returns 000 — an error pattern that
points squarely at the code just edited, when the code is correct.

- **Count listeners, not just liveness:** `netstat -ano | grep :PORT | grep
  LISTENING`. More than one is the finding, and it outranks any code hypothesis.
- **A signal may not reap a process that ignores it,** and a background launch
  that was reported started may still be initializing. Kill every PID on the
  port explicitly, confirm the port is free, then start exactly one.
- **Run the server unbuffered** (`python -u`) so its traceback is visible
  immediately. Under a buffer, a crash's evidence arrives after the next
  restart, attached to the wrong run and easy to misread as a network fault.

Corollary: a request that fails with an empty response or connection reset is
evidence about *which process answered*, not about the route. Check the listener
set before editing handlers.

## Run it across several briefs

One green run on the friendliest listing proves the happy path and nothing else.
Variety is what surfaces selector and gate errors. Assert on the specific
outcome each brief should produce — a normal brief should deliver and show the
file, a missing-input brief should ask a question and stop, a vanished brief
should report late rather than send — so a regression names itself.
