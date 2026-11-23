---
name: production-mvp-architecture
description: "Use when defining one production MVP architecture."
---

# Production MVP Architecture

Consolidate an existing multi-contour system into one usable production MVP. Separate what exists in code from what is running, choose one source of truth, and make the tree show the single intended production path plus explicitly excluded legacy paths.

## When to Use
- A user asks to centralize, simplify, or define a production MVP from an existing multi-service project.
- The project has several queues, databases, agents, dispatchers, or competing execution routes.
- The user asks for a canonical module tree, prioritised blockers, or a roadmap stored in a knowledge-tree API.

## Procedure
1. **Inventory before choosing.** Inspect route handlers, order stores, worker entry points, executor integrations, status maps, and actual processes/ports. Record separately: implemented, running, and demo-only.
2. **Choose one master record.** Identify the durable order/job ID and the single database/system that owns status transitions. Use source-qualified idempotency keys where external IDs can collide.
3. **Choose one production executor.** If an executor keeps its own session/order, model it as a linked child with one stable foreign key; require idempotent assignment and status/event/artifact readback to the master record.
4. **Freeze competing paths.** Put old workers, alternate dispatchers, experimental runtimes, and standalone order creation under an explicit `Excluded from production MVP` branch. Do not imply that existing code is an approved live path.
5. **Define the minimal lifecycle.** Include intake → input/feasibility gate → approval/assignment → customer clarification → execution → QA → delivery/revision → canonical status/audit. Do not start incomplete orders.
6. **Put blockers in the tree.** Use concise module headings with current status; attach sequenced tasks to the same tree with explicit priorities. Distinguish a known bug from a service that is merely offline.
7. **Match the requested format.** When the user asks for a tree, return one hierarchical tree; nest blockers and revival tasks under it instead of adding parallel architectures, tables, or a long prose report.
8. **Publish safely.** For an external knowledge tree, read the target before writing; import is destructive. Use the schema in `references/openmvp-tree-publishing.md`, then read back and verify exact root, node/task counts, titles, and priorities.
9. **Report scope accurately.** A saved architecture tree is not a deployed runtime. State which services remain down and which implementation tasks are still open.

## Always-On Rules
- Never present several independent queues/executors as one integrated system merely because one UI links to all of them; without one status owner and readback path they can double-run or disagree.
- Do not treat `unpaused`, a successful HTTP response, or a static demo as proof that a worker executed a real order; verify process heartbeat, queue claim, executor result, and master-record readback.
- Keep synthetic examples out of production storage and label them as demos; health snapshots are not order activity.
- Make quality gates fail closed: if required inputs, executor, or QA are unavailable, stop or request review rather than marking success.
- Never put credentials, customer briefs, order IDs, or chat text into a public tree or skill.

## Common Pitfalls
- Choosing architecture from directory names alone; the actual order-link and status-sync code determine whether two services are integrated.
- Keeping a legacy worker active alongside a new executor; both may claim the same master queue.
- Treating a child executor's `done` as master delivery without checking artifacts and QA.
- Publishing an import without GET-before-write and readback; an API can return success while sorting or shaping the result differently than submitted.
