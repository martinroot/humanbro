#!/usr/bin/env python3
"""Разбор учёта токенов из JSONL-сайдкара плагина token-usage-footer.

    python3 parse_usage.py --json                 # массив объектов
    python3 parse_usage.py --csv                  # CSV в stdout
    python3 parse_usage.py --sql --table agent_runs
    python3 parse_usage.py --since 2026-10-22     # только с даты
    python3 parse_usage.py --totals               # суммы по модели

Файл по умолчанию: <HERMES_HOME>/plugins/token-usage-footer/usage.jsonl
"""
import argparse
import csv
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

FIELDS = ["ts", "session_id", "turn_id", "model", "provider",
          "in", "out", "cache_read", "cache_write", "reasoning", "calls", "usd"]


def default_path() -> pathlib.Path:
    home = os.environ.get("HERMES_HOME") or "/home/main/.hermes"
    return pathlib.Path(home) / "plugins" / "token-usage-footer" / "usage.jsonl"


def load(path: pathlib.Path, since: str | None):
    rows = []
    if not path.exists():
        return rows
    cut = None
    if since:
        cut = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if cut and float(rec.get("ts") or 0) < cut:
                continue
            rows.append(rec)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=str(default_path()))
    ap.add_argument("--since")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--csv", action="store_true")
    ap.add_argument("--sql", action="store_true")
    ap.add_argument("--table", default="agent_runs")
    ap.add_argument("--totals", action="store_true")
    a = ap.parse_args()

    rows = load(pathlib.Path(a.file), a.since)

    if a.totals:
        agg = {}
        for r in rows:
            k = r.get("model") or "?"
            t = agg.setdefault(k, {"calls": 0, "in": 0, "out": 0, "cache": 0, "usd": 0.0, "turns": 0})
            t["calls"] += int(r.get("calls") or 0)
            t["in"] += int(r.get("in") or 0)
            t["out"] += int(r.get("out") or 0)
            t["cache"] += int(r.get("cache_read") or 0) + int(r.get("cache_write") or 0)
            t["usd"] += float(r.get("usd") or 0)
            t["turns"] += 1
        print(json.dumps(agg, ensure_ascii=False, indent=2))
        return 0

    if a.sql:
        print(f"-- INSERT INTO {a.table} (ts, session_id, turn_id, model, provider, tok_in, tok_out,"
              " tok_cache_read, tok_cache_write, tok_reasoning, calls, cost_usd) VALUES")
        vals = []
        for r in rows:
            ts = datetime.fromtimestamp(float(r.get("ts") or 0), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            vals.append(
                "('{ts}','{sid}','{tid}','{m}','{p}',{i},{o},{cr},{cw},{th},{c},'{u}')".format(
                    ts=ts, sid=str(r.get("session_id", "")).replace("'", ""),
                    tid=str(r.get("turn_id", "")).replace("'", ""),
                    m=str(r.get("model", "")).replace("'", ""), p=str(r.get("provider", "")),
                    i=int(r.get("in") or 0), o=int(r.get("out") or 0),
                    cr=int(r.get("cache_read") or 0), cw=int(r.get("cache_write") or 0),
                    th=int(r.get("reasoning") or 0), c=int(r.get("calls") or 0),
                    u=r.get("usd") or "0"))
        print(",\n".join(vals) + ";")
        return 0

    if a.csv:
        w = csv.DictWriter(sys.stdout, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})
        return 0

    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
