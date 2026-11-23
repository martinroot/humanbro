# Executing work on a kanban board across specialist profiles

When a durable board assigns each order to a named profile — a photo/retouch
worker, a design worker, a copy writer, a developer — and a second profile
accepts or rejects the result. Applies wherever the queue outgrew a single
agent: the profile *is* the specialist, and the board is the handoff.

**Confirm the board exists before building one.** A code-level search of the
config directory, its databases, and the tool list reports a shipped board,
scheduler, and profile system as absent. Read the product's own docs and run its
CLI `--help`. Rebuilding a shipped subsystem by mistake is expensive and
embarrassing; the check is one command.

## The board is also a plugin surface in the web dashboard — enumerate the API, don't grep the CLI

The CLI verb list is not the whole product. A running dashboard serves every
plugin surface over HTTP, and the board is one of them, with far more surface
than the verbs expose (task inspection, runs, attachments, orchestration,
per-profile routing config, board export/import).

```
hermes dashboard --port 9119 --no-open     # first start builds the web UI (~1-2 min)
curl -s http://127.0.0.1:9119/openapi.json   # enumerate what actually exists
```

**Enumerate `openapi.json` and group the paths** rather than searching the
bundle or the CLI for a keyword. Two failure modes to avoid:

- **Grepping a minified asset bundle for a feature name returns zero even when
  the feature ships.** Absence there is evidence about the bundle, not the
  product.
- **An unauthenticated probe returning 401 proves the endpoint exists.** It is
  not a failure to fix — it is a working surface behind a gate. Read the status
  code as the answer, and hand the auth step to the owner rather than concluding
  the API is missing.

When an owner says a tool already has a surface, believe them and go find the
API — do not propose building a replacement in the code you happened to be
looking at. Getting this wrong twice on the same subsystem (board, then
dashboard) is the signal to stop searching and read the docs first.

## Creating the worker profiles

```
hermes profile create <name> --clone --no-alias --description "<what it does, in the words a router would match>"
```

- `--description` is the routing surface. The orchestrator reads it to decide who
  gets a task, so write it as the job's domain ("retouch and photo cleanup:
  background removal, exposure, highlight removal") rather than as a job title.
- **Clone config and skills, never the messaging channels.** A clone that copies
  bot tokens gives two profiles one identity; the second to start loses the
  token or answers on the same chat. Verify after creating: the worker's bot
  token must be empty.
- `--no-alias` keeps a wrapper script off `PATH` unless a human will use it.
- Workers do **not** need their own gateway. A worker is a process the
  dispatcher spawns for one task; giving every profile a running gateway costs
  tokens and multiplies the places a failure can hide.

## The dispatch cycle

```
hermes kanban create "<title>" --body "<full brief + procedure + success test>" --assignee <profile> --skill <name>
hermes kanban dispatch      # ready -> claimed -> spawned -> running
hermes kanban list / show <id>
```

- **The `--body` is the task.** It travels to a fresh process with no memory of
  this conversation: it needs the endpoints, the order ID, the exact expected
  output, and the instruction to verify the result rather than assume it.
- `--skill` loads a procedure by name. This is how a hard-won runbook reaches
  the worker without living in its prompt.
- The dispatcher claims atomically, heartbeats, and auto-blocks a task after
  consecutive spawn failures. Read `kanban show` for the event trail — claimed,
  spawned, heartbeat, attached, completed — which is what distinguishes "the
  worker started" from "the worker did the thing".
- Attach the produced artifact to the task. It survives the run; a scratch
  workspace does not.

**Scratch workspaces are ephemeral** — deleted when the task completes. Use
`--workspace dir:/abs/path` when the output must outlive the run.

## Review cannot be requested from a finished task

`request-review` only accepts a task in `running`/`ready`. A task already
`done` returns "task is not in running/ready". That is correct: acceptance is
requested *by the worker* as the last act of its run.

To review a finished task, **create a second task assigned to a different
profile**, whose body names the first task ID, states what to verify, and lists
the exact checks. This is a feature, not a workaround: the reviewer must not
share the worker's context, or it inherits the worker's assumptions.

## An acceptance check that cannot fail is decoration

The strongest failure mode here is a review that approves a no-op. Observed
shape: the worker delivered a file byte-identical to the input, the review found
the file present, correctly sized and correctly formatted — and passed it,
describing the missing work as an honest result.

- **Every review criterion must be phrased so a specific failure makes it
  false.** "File exists, is PNG, is 1200x1200" passes for a copy of the input.
  Add: "differs from the input file — compare bytes or hash", and state what the
  work was supposed to change.
- **The reviewer re-fetches the artifact and compares it to the input itself.**
  It must not reason from the worker's summary. A worker that says it did the
  work, and a file that shows it did not, is a normal outcome.
- **Record the check that ran, with numbers** — sizes, hashes, byte comparison —
  so "PASS" carries its evidence. A verdict without figures is an opinion.
- **Distinguish "the work is unobservable in this input" from "the work was
  done."** When the input genuinely offers nothing to change (a flat single-colour
  image, say), the correct verdict is neither: raise it to the customer as a
  question. A worker that notices this and asks has done the job well; a
  reviewer who passes the copy has ratified a no-op.
- **Keep the worker's own caveat.** A worker reporting "the source has no
  highlights to remove" is signal. The review should confirm or overturn that
  claim, not route around it.

## What the board is for

A board earns its keep by making the handoff durable and the verdict
independent. Two things that look like overhead are the point: a **second
profile** reviewing, and a **written criterion** the reviewer must satisfy. Drop
either and the board degenerates into a list that marks its own homework.
