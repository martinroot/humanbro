"""Идемпотентная правка config.yaml под token-usage-footer.

Запускается из install.sh от имени владельца профиля.
Меняет ровно три вещи, остальное сохраняет как есть (бэкап делает install.sh).
"""
import os
import pathlib
import sys

import yaml

PLUGIN_ID = os.environ.get("PLUGIN_ID", "token-usage-footer")
OPEN_ALL = os.environ.get("OPEN_ALL", "true").lower() in {"1", "true", "yes"}
FOOTER_ON = os.environ.get("FOOTER_ON", "true").lower() in {"1", "true", "yes"}

home = pathlib.Path(os.environ["HERMES_HOME"])
path = home / "config.yaml"
cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

# 1) plugins.enabled += PLUGIN_ID
plugins = cfg.setdefault("plugins", {})
enabled = plugins.get("enabled")
if not isinstance(enabled, list):
    enabled = []
if PLUGIN_ID not in enabled:
    enabled.append(PLUGIN_ID)
plugins["enabled"] = enabled
plugins.setdefault("entries", {}).setdefault(PLUGIN_ID, {}).setdefault("allow_tool_override", False)

# 2) gateway.allow_all_users — открыть доступ всем пользователям/группам
if OPEN_ALL:
    cfg.setdefault("gateway", {})["allow_all_users"] = True

# 3) нативный runtime_footer выключаем: остаётся одна машинная строка учёта
disp = cfg.setdefault("display", {})
rf = disp.get("runtime_footer")
if not isinstance(rf, dict):
    rf = {}
if FOOTER_ON:
    rf["enabled"] = False
    rf.setdefault("fields", ["model", "context_pct"])
disp["runtime_footer"] = rf

path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False, default_flow_style=False),
                encoding="utf-8")
print(f"   config.yaml обновлён: plugins.enabled += {PLUGIN_ID}"
      + (", gateway.allow_all_users=true" if OPEN_ALL else "")
      + (", display.runtime_footer.enabled=false" if FOOTER_ON else ""))
