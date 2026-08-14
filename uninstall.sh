#!/usr/bin/env bash
# dsh-skin-glass 一键卸载脚本
#
# 用法：bash uninstall.sh
#
# 环境变量：
#   DSH_PROFILE   目标 profile（默认 web）
#   NO_RESTART=1  只卸载，不自动重启 dsh web
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_WEB_PORT="${DSH_WEB_PORT:-3080}"
NO_RESTART="${NO_RESTART:-0}"

say() { printf '\033[1;36m[dsh-skin-glass]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dsh-skin-glass] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 前置检查 ─────────────────────────────────────────────────────────
command -v pnpm >/dev/null 2>&1 || die "需要 pnpm（corepack enable 或 npm i -g pnpm）"
if command -v dsh >/dev/null 2>&1; then
  DSH_CMD=(dsh)
else
  DSH_CMD=(npx --yes @deepseek-ai/dsh)
fi

# ── 卸载并移除 bundle 层 ─────────────────────────────────────────────
say "从 profile \"$DSH_PROFILE\" 卸载 dsh-skin-glass…"
"${DSH_CMD[@]}" plugin --profile "$DSH_PROFILE" remove dsh-skin-glass

if [ "$NO_RESTART" = "1" ]; then
  say "已卸载。重启 dsh web 后刷新页面恢复默认外观（本次跳过了自动重启）。"
  exit 0
fi

# ── 若 dsh web 正在运行，自动重启恢复默认外观 ────────────────────────
WEB_PID="$(lsof -tiTCP:"$DSH_WEB_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
if [ -z "$WEB_PID" ]; then
  say "dsh web 未在运行：下次启动即恢复默认外观。"
  exit 0
fi
if ! ps -p "$WEB_PID" -o command= 2>/dev/null | grep -q "dsh"; then
  say "端口 $DSH_WEB_PORT 被其他进程占用，跳过自动重启，请手动重启 dsh web。"
  exit 0
fi

say "重启 dsh web（pid ${WEB_PID}）…"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nohup bash "$SELF/restart-web.sh" "$WEB_PID" /tmp/dsh-web-restart.log >/dev/null 2>&1 &
disown 2>/dev/null || true

for i in $(seq 1 60); do
  kill -0 "$WEB_PID" 2>/dev/null || break
  sleep 0.5
done

say "等待新服务就绪…"
for i in $(seq 1 60); do
  HTML="$(curl -sf "http://127.0.0.1:$DSH_WEB_PORT/" 2>/dev/null || true)"
  if [ -n "$HTML" ] && ! printf '%s' "$HTML" | grep -q "dsh-skin-glass"; then
    say "完成！刷新页面即恢复默认外观。"
    exit 0
  fi
  sleep 1
done
die "新服务未在 60 秒内就绪，请查看 /tmp/dsh-web-restart.log"
