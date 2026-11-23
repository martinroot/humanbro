# Verified install contract (probe before you build)

The integration surface of the installed Hermes, and the one-liners to re-probe it when the version moves.

## Entry points (Python, importable from the hermes-agent directory)
- `run_agent.AIAgent` — constructor keyword args include: `model` (empty string = config default), `max_iterations`, `enabled_toolsets`, `disabled_toolsets`, `quiet_mode`, `ephemeral_system_prompt`, `request_overrides` (dict passed into the API call, e.g. `{"temperature": 0}`), `skip_memory`, `skip_context_files`, `session_id`, `run_budget_seconds`, `fallback_model`, plus callbacks.
- `AIAgent.run_conversation(user_message, system_message=None, conversation_history=None, task_id=None, stream_callback=None, ...)` — returns a dict; response text lives under `final_response` (also probe `response`, `message`).
- `agent.skill_commands.build_preloaded_skills_prompt(skill_identifiers, task_id=None, excluded_loaded_names=None) -> (prompt_text, loaded_names, missing_identifiers)` — disabled skills count as missing.
- `agent.skill_commands.build_skill_invocation_message(cmd_key, user_instruction="", task_id=None, runtime_note="") -> Optional[str]` — slash-command style single-skill message; `build_stacked_skill_invocation_message(cmd_keys, ...)` loads up to 5 leading skills and returns `(message, loaded, missing)`.

## What is NOT in this install
- HTTP job API (`POST /v1/runs`, `/v1/runs/{id}`, `/v1/capabilities`) — no route matches in the installed Python tree; do not plan a cross-server design on it without probing the running server first.

## Re-probe (one call, no docs involved)
```
cd <hermes-agent dir> && python -c "import run_agent, inspect; A=run_agent.AIAgent; print(inspect.signature(A.run_conversation)); from agent.skill_commands import build_preloaded_skills_prompt as b; print(inspect.signature(b))"
```
If an import fails, fix `sys.path` first (see SKILL.md step 1) before assuming the symbol moved.

## Model / key wiring
- Default model: `hermes config set model.default <provider/model>`; read back with `hermes config get model`. Never hand-edit `config.yaml` — the live process rewrites it.
- OpenRouter key source: `hermes\.env` (variable `OPENROUTER_API_KEY`). Node/bun project scripts need it duplicated into their own `.env`.
