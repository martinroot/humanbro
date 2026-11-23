---
name: hermes-as-function
description: Use when calling Hermes as a Python function in a pipeline.
---

# Hermes as a function inside a code scenario

The scenario (plain code) owns the process, the checkpoints and the acceptance checks; the agent is called only where judgement or tools are needed. **Predictable actions are programmed, ambiguous ones go to the model — and the code always validates the model's output.** A skill being preloaded is guidance, not a guarantee of a correct result.

## Always-on
- **Verify any integration scheme against THIS install before building on it** — published schemes reference functions or HTTP routes (`/v1/runs`, helper names) that may not exist in the installed version. Probe signatures with `inspect.signature` in one `python -c` call, not by reading docs.
- **Never trust a model-produced JSON unvalidated**; parse defensively and gate the step on code-side checks (required keys present, correct type), failing the step — not the scenario — when they are missing.
- **Hermes config changes go through `hermes config set ...`** — direct edits to `config.yaml` are silently overwritten when the running process rewrites its config.

## Procedure (one step)
1. **Fix `sys.path` first**: insert the hermes-agent directory AND remove the calling script's own directory from `sys.path`. A project file named like a stdlib module (e.g. `queue.py`) otherwise shadows it and every Hermes tool import dies with `module 'queue' has no attribute ...`.
2. **Preload skills before the model runs**: `agent.skill_commands.build_preloaded_skills_prompt(ids, task_id=...)` → `(prompt, loaded, missing)`. Raise on `missing` BEFORE calling the agent — a model with half the instructions wastes a paid cycle.
3. **Construct a bounded agent**: `run_agent.AIAgent(model=..., quiet_mode=True, enabled_toolsets=[...], max_iterations=<small>, skip_memory=True, skip_context_files=True, ephemeral_system_prompt=prompt, request_overrides={"temperature": 0})`. Empty model = config default.
4. **Run one turn**: `agent.run_conversation(user_message=..., task_id=...)`; extract the text with fallbacks (`final_response` → `response` → `message` → raw string).
5. **Validate and repair once**: parse with layered strategies (as-is → balanced `{...}` slice → strip trailing commas); on failure send exactly ONE repair turn carrying the parse error and the previous answer, re-validate, then fail the step to the scenario. Never loop repairs.
6. **Ask for a single JSON object only** (no markdown, no commentary) and keep inputs small — long conversational context is where JSON output degrades.

## Pitfalls
- **Temperature must be 0 for structured steps** — long JSON answers break non-deterministically across runs; layered parsing plus one repair turn turns that into a bounded failure instead of a flaky step.
- **bun/Node scripts do not inherit Hermes' env** — the OpenRouter key lives in `hermes\.env`; copy it into the project `.env` (never into code) or calls fail with a missing key.
- **Keep the whole step budget under the caller's timeout** — the agent loop plus preload can take a minute; size `max_iterations` and the caller's cap together.

## references/
- `references/install-contract.md` — verified signatures of this install and how to re-probe them.