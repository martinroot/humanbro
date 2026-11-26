#!/usr/bin/env bash
# Установка per-turn учёта токенов в шлюз Hermes:
#   * футер в конце КАЖДОГО сообщения шлюза: IN=..|OUT=..|CACHE_R=..|..
#   * JSONL-сайдкар (usage.jsonl) — по объекту на ход, для загрузки в БД.
#   * gateway.allow_all_users = true (открыть доступ всем в группах).
# Идемпотентно: можно запускать повторно, ничего не ломает.
#
#   sudo ./install.sh                      # профиль main, /home/main/.hermes
#   sudo ./install.sh --user dagi          # другой пользователь
#   sudo ./install.sh --home /root/.hermes # произвольный HERMES_HOME
#
set -euo pipefail

USER_NAME="main"
HERMES_HOME_DIR=""
OPEN_ALL="true"
FOOTER_ON="true"

while [ $# -gt 0 ]; do
  case "$1" in
    --user)     USER_NAME="$2"; shift 2;;
    --home)     HERMES_HOME_DIR="$2"; shift 2;;
    --no-open-all) OPEN_ALL="false"; shift;;
    --no-footer)   FOOTER_ON="false"; shift;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2;;
  esac
done
[ -n "$HERMES_HOME_DIR" ] || HERMES_HOME_DIR="/home/$USER_NAME/.hermes"

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ID="token-usage-footer"
DEST="$HERMES_HOME_DIR/plugins/$PLUGIN_ID"
HERMES_BIN="$HERMES_HOME_DIR/hermes-agent/venv/bin/hermes"
USER_HOME="/home/$USER_NAME"
[ "$USER_NAME" = "root" ] && USER_HOME="/root"

[ -x "$HERMES_BIN" ] || { echo "ОШИБКА: не найден $HERMES_BIN" >&2; exit 1; }
[ -f "$PKG/plugin/token_usage_footer.py" ] || { echo "ОШИБКА: нет $PKG/plugin/token_usage_footer.py" >&2; exit 1; }

run_bin() { sudo -u "$USER_NAME" env HOME="$USER_HOME" HERMES_HOME="$HERMES_HOME_DIR" "$HERMES_BIN" "$@"; }

echo "== 1/5  плагин -> $DEST"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$DEST"
install -m 644 -o "$USER_NAME" -g "$USER_NAME" "$PKG/plugin/token_usage_footer.py" "$DEST/__init__.py"
install -m 644 -o "$USER_NAME" -g "$USER_NAME" "$PKG/plugin/plugin.yaml"           "$DEST/plugin.yaml"
rm -rf "$DEST/__pycache__"

echo "== 2/5  конфиг (plugins.enabled / gateway.allow_all_users / display.runtime_footer)"
cp -a "$HERMES_HOME_DIR/config.yaml" "$HERMES_HOME_DIR/config.yaml.bak-$(date +%Y%m%d-%H%M%S)"
sudo -u "$USER_NAME" env HOME="$USER_HOME" HERMES_HOME="$HERMES_HOME_DIR" \
  OPEN_ALL="$OPEN_ALL" FOOTER_ON="$FOOTER_ON" PLUGIN_ID="$PLUGIN_ID" \
  "$HERMES_HOME_DIR/hermes-agent/venv/bin/python" "$PKG/scripts/configure.py"

echo "== 3/5  валидация плагина реальным рантаймом"
run_bin plugins doctor "$DEST" || true

echo "== 4/5  перезапуск шлюза"
systemctl --user -M "$USER_NAME@" restart hermes-gateway.service && echo "   шлюз перезапущен"
sleep 15

echo "== 5/5  проверка"
systemctl --user -M "$USER_NAME@" show hermes-gateway.service -p MainPID -p ActiveState -p SubState
grep -E "polling confirmed healthy|Connected to Telegram" "$HERMES_HOME_DIR/logs/gateway.log" | tail -2 || true
echo
echo "Футер:  IN=..|OUT=..|CACHE_R=..|CACHE_W=..|THINK=..|CALLS=..|MS=..|USD=..|MODEL=..|SESS=..|TURN=..|"
echo "JSONL:  $DEST/usage.jsonl"
echo "Перезапуск после правок: /restart в чате."
echo "Готово. Напиши боту любое сообщение — в конце ответа будет строка учёта."
