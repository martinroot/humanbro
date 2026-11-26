"""token-usage-footer — per-turn token/cost accounting appended to messaging replies.

Data path:
  * ``post_api_request`` fires once per provider call with the canonical usage
    buckets (uncached input / output / cache read / cache write / reasoning) and
    the call duration. Usage is accumulated per (session_id, turn_id).
  * ``transform_llm_output`` fires once per finished turn with the final reply
    text. The accumulated numbers for that turn are rendered into one compact
    line appended to the reply.

Only messaging surfaces get the line (CLI, TUI and delegated subagents are
skipped) — the model never sees it, so prompt caching is untouched.
"""

from __future__ import annotations

import os
import threading
import logging
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("hermes_plugins.token_usage_footer")

try:  # Hermes internals are importable inside the gateway process.
    from agent.usage_pricing import (  # type: ignore
        CanonicalUsage,
        estimate_usage_cost,
        format_cost_label,
        format_token_count_compact,
        get_pricing_entry,
    )
except Exception:  # pragma: no cover - plugin must never break the turn
    CanonicalUsage = None  # type: ignore
    estimate_usage_cost = None  # type: ignore
    format_cost_label = None  # type: ignore
    format_token_count_compact = None  # type: ignore
    get_pricing_entry = None  # type: ignore

# Test escape hatch: also stamp CLI/desktop surfaces.
_FORCE_ALL_PLATFORMS = os.environ.get("HERMES_TOKEN_USAGE_FOOTER_ALL", "").strip().lower() in {
    "1", "true", "yes", "on",
}

# Surfaces that must NOT receive the accounting line.
_SKIP_PLATFORMS = {"cli", "subagent", "tui", "acp", "desktop", "api_server", ""}

_LOCK = threading.Lock()
# (session_id, turn_id) -> accumulator
_TURNS: Dict[Tuple[str, str], Dict[str, Any]] = {}
_MAX_TRACKED_TURNS = 64


def _acc(key: Tuple[str, str]) -> Dict[str, Any]:
    acc = _TURNS.get(key)
    if acc is None:
        if len(_TURNS) >= _MAX_TRACKED_TURNS:
            # Drop the oldest half — a leaked turn must not grow memory forever.
            for stale in list(_TURNS)[: max(1, _MAX_TRACKED_TURNS // 2)]:
                _TURNS.pop(stale, None)
        acc = {
            "input": 0,
            "output": 0,
            "cache_read": 0,
            "cache_write": 0,
            "reasoning": 0,
            "calls": 0,
            "api_seconds": 0.0,
            "first_started": None,
            "last_ended": None,
            "model": "",
            "provider": "",
            "base_url": "",
        }
        _TURNS[key] = acc
    return acc


def _on_post_api_request(**kwargs: Any) -> None:
    """Accumulate one provider call's usage into its turn bucket."""
    try:
        usage = kwargs.get("usage") or {}
        if not isinstance(usage, dict):
            return
        key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
        with _LOCK:
            acc = _acc(key)
            acc["input"] += int(usage.get("input_tokens") or 0)
            acc["output"] += int(usage.get("output_tokens") or 0)
            acc["cache_read"] += int(usage.get("cache_read_tokens") or 0)
            acc["cache_write"] += int(usage.get("cache_write_tokens") or 0)
            acc["reasoning"] += int(usage.get("reasoning_tokens") or 0)
            acc["calls"] += 1
            try:
                acc["api_seconds"] += float(kwargs.get("api_duration") or 0.0)
            except (TypeError, ValueError):
                pass
            started = kwargs.get("started_at")
            ended = kwargs.get("ended_at")
            if isinstance(started, (int, float)):
                acc["first_started"] = started if acc["first_started"] is None else min(
                    acc["first_started"], started)
            if isinstance(ended, (int, float)):
                acc["last_ended"] = ended if acc["last_ended"] is None else max(
                    acc["last_ended"], ended)
            if kwargs.get("model"):
                acc["model"] = str(kwargs["model"])
            if kwargs.get("provider"):
                acc["provider"] = str(kwargs["provider"])
            if kwargs.get("base_url"):
                acc["base_url"] = str(kwargs["base_url"])
    except Exception:
        return


def _num(value: int) -> str:
    if format_token_count_compact is not None:
        try:
            return format_token_count_compact(int(value))
        except Exception:
            pass
    return str(int(value))


def _cost_label(acc: Dict[str, Any]) -> Optional[str]:
    """Estimated USD for the turn, or None when pricing is unknown."""
    if estimate_usage_cost is None or CanonicalUsage is None:
        return None
    model = acc.get("model") or ""
    if not model:
        return None
    usage = CanonicalUsage(
        input_tokens=acc["input"],
        output_tokens=acc["output"],
        cache_read_tokens=acc["cache_read"],
        cache_write_tokens=acc["cache_write"],
        reasoning_tokens=acc["reasoning"],
        request_count=max(1, acc["calls"]),
    )
    try:
        result = estimate_usage_cost(
            model, usage,
            provider=acc.get("provider") or None,
            base_url=acc.get("base_url") or None,
        )
    except Exception:
        return None
    if result is None:
        return None
    if result.status == "unknown" or result.amount_usd is None:
        # One bucket has no published rate (typical on free models: prompt/completion
        # are $0 but cache read is unpriced). Say so instead of inventing a number.
        entry = None
        if get_pricing_entry is not None:
            try:
                entry = get_pricing_entry(
                    model,
                    provider=acc.get("provider") or None,
                    base_url=acc.get("base_url") or None,
                )
            except Exception:
                entry = None
        if entry is None:
            return None
        input_rate = entry.input_cost_per_million
        output_rate = entry.output_cost_per_million
        if input_rate == 0 and output_rate == 0:
            return "$0.00 (free)"
        return "cost n/a"
    if format_cost_label is not None:
        try:
            return format_cost_label(result.amount_usd)
        except Exception:
            pass
    return str(result.amount_usd)


def _kv(key: str, value) -> str:
    """One KEY=VALUE pair, safe for a pipe-delimited line."""
    v = str(value).replace("|", "_").replace("\n", " ").replace("\r", " ")
    return f"{key}={v}"


def _cost_usd(acc: Dict[str, Any]) -> str:
    """Raw estimated USD as a plain number string ('' when pricing is unknown)."""
    if estimate_usage_cost is None or CanonicalUsage is None:
        return ""
    model = acc.get("model") or ""
    if not model:
        return ""
    usage = CanonicalUsage(
        input_tokens=acc["input"], output_tokens=acc["output"],
        cache_read_tokens=acc["cache_read"], cache_write_tokens=acc["cache_write"],
        reasoning_tokens=acc["reasoning"], request_count=max(1, acc["calls"]),
    )
    try:
        result = estimate_usage_cost(model, usage, provider=acc.get("provider") or None,
                                     base_url=acc.get("base_url") or None)
    except Exception:
        return ""
    if result is None or result.amount_usd is None:
        return ""
    try:
        return f"{float(result.amount_usd):.6f}"
    except Exception:
        return ""


def _render(acc: Dict[str, Any]) -> str:
    """Machine-readable footer: IN=..|OUT=..|CACHE_R=..|..| (pipe-delimited KEY=VALUE)."""
    first, last = acc.get("first_started"), acc.get("last_ended")
    if isinstance(first, (int, float)) and isinstance(last, (int, float)) and last >= first:
        ms = int(round((last - first) * 1000))
    else:
        ms = 0
    pairs = [
        _kv("IN", acc["input"]),
        _kv("OUT", acc["output"]),
        _kv("CACHE_R", acc["cache_read"]),
        _kv("CACHE_W", acc["cache_write"]),
        _kv("THINK", acc["reasoning"]),
        _kv("CALLS", acc["calls"]),
        _kv("MS", ms),
        _kv("USD", _cost_usd(acc)),
        _kv("MODEL", acc.get("model") or ""),
    ]
    return "|".join(pairs) + "|"


def _jsonl(acc: Dict[str, Any], key) -> None:
    """Append the same numbers as one JSON object per line for offline ingestion."""
    try:
        import json, time
        rec = {
            "ts": int(time.time()),
            "session_id": key[0], "turn_id": key[1],
            "model": acc.get("model") or "", "provider": acc.get("provider") or "",
            "in": acc["input"], "out": acc["output"],
            "cache_read": acc["cache_read"], "cache_write": acc["cache_write"],
            "reasoning": acc["reasoning"], "calls": acc["calls"],
            "usd": _cost_usd(acc),
        }
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage.jsonl")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
    except Exception:
        pass


def _on_transform_llm_output(**kwargs: Any) -> Optional[str]:
    """Append the accounting line to the final reply of a messaging turn."""
    try:
        platform = str(kwargs.get("platform") or "")
        if not _FORCE_ALL_PLATFORMS and platform in _SKIP_PLATFORMS:
            return None
        response_text = kwargs.get("response_text")
        if not isinstance(response_text, str) or not response_text.strip():
            return None
        key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
        with _LOCK:
            acc = _TURNS.pop(key, None)
        if not acc or not acc.get("calls"):
            return None
        total = acc["input"] + acc["output"] + acc["cache_read"] + acc["cache_write"]
        if not total:
            return None
        line = f"⚙️ {_render(acc)}" + _kv("SESS", key[0]) + "|" + _kv("TURN", key[1]) + "|"
        _jsonl(acc, key)
        logger.info("token-usage-footer: stamped turn %s (%s)", key[1][:12], line)
        return f"{response_text.rstrip()}\n\n{line}"
    except Exception:
        return None


def register(ctx) -> None:
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("transform_llm_output", _on_transform_llm_output)
