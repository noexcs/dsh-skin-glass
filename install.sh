#!/usr/bin/env bash
# dsh-skin-glass 一键安装脚本
#
# 用法（二选一）：
#   git clone https://github.com/noexcs/dsh-skin-glass && cd dsh-skin-glass && bash install.sh
#   bash <(curl -fsSL https://raw.githubusercontent.com/noexcs/dsh-skin-glass/main/install.sh)
#
# 环境变量：
#   DSH_PROFILE    目标 profile（默认 web）
#   DSH_SKIN_REPO  远程仓库地址（仅远程安装时用，默认 https://github.com/noexcs/dsh-skin-glass）
#   NO_RESTART=1   只安装，不自动重启 dsh web
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_SKIN_REPO="${DSH_SKIN_REPO:-https://github.com/noexcs/dsh-skin-glass}"
DSH_WEB_PORT="${DSH_WEB_PORT:-3080}"
NO_RESTART="${NO_RESTART:-0}"

say() { printf '\033[1;36m[dsh-skin-glass]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dsh-skin-glass] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1) 定位插件包目录（仓库根即插件包）───────────────────────────────
SKIN_DIR="${SKIN_DIR:-}"
if [ -z "$SKIN_DIR" ]; then
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
  if [ -n "$SELF" ] && [ -f "$SELF/package.json" ]; then
    SKIN_DIR="$SELF"
  else
    say "未找到本地插件包，尝试从 $DSH_SKIN_REPO 下载…"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    curl -fsSL "$DSH_SKIN_REPO/archive/refs/heads/main.tar.gz" | tar xz -C "$TMP" \
      || die "下载失败：$DSH_SKIN_REPO/archive/refs/heads/main.tar.gz"
    REPO_NAME="$(basename "$DSH_SKIN_REPO")"
    SKIN_DIR="$TMP/$REPO_NAME-main"
  fi
fi
[ -f "$SKIN_DIR/package.json" ] || die "插件包无效：$SKIN_DIR"

# ── 2) 前置检查：pnpm + dsh CLI ─────────────────────────────────────
command -v pnpm >/dev/null 2>&1 || die "需要 pnpm（corepack enable 或 npm i -g pnpm）"
if command -v dsh >/dev/null 2>&1; then
  DSH_CMD=(dsh)
else
  DSH_CMD=(npx --yes @deepseek-ai/dsh)
  say "未检测到 dsh CLI，使用 npx @deepseek-ai/dsh（首次会下载，稍候）"
fi

# ── 3) 安装并注册 bundle（自动并入 dsh.profile.bundles）──────────────
say "安装到 profile \"$DSH_PROFILE\"…"
"${DSH_CMD[@]}" plugin --profile "$DSH_PROFILE" add "$SKIN_DIR"

if [ "$NO_RESTART" = "1" ]; then
  say "已安装。重启 dsh web 后刷新页面生效（本次跳过了自动重启）。"
  exit 0
fi

# ── 4) 若 dsh web 正在运行，自动重启使其生效 ─────────────────────────
WEB_PID="$(lsof -tiTCP:"$DSH_WEB_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
if [ -z "$WEB_PID" ]; then
  say "dsh web 未在运行：启动 dsh web（或 npx @deepseek-ai/dsh web）后刷新页面即可。"
  exit 0
fi
if ! ps -p "$WEB_PID" -o command= 2>/dev/null | grep -q "dsh"; then
  say "端口 $DSH_WEB_PORT 被其他进程占用，跳过自动重启，请手动重启 dsh web。"
  exit 0
fi

say "重启 dsh web（pid $WEB_PID）…"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nohup bash "$SELF/restart-web.sh" "$WEB_PID" /tmp/dsh-web-restart.log >/dev/null 2>&1 &
disown 2>/dev/null || true

# 等旧进程退出，避免误读旧服务的响应
for i in $(seq 1 60); do
  kill -0 "$WEB_PID" 2>/dev/null || break
  sleep 0.5
done

# ── 5) 轮询新服务：boot manifest 出现插件条目即就绪 ──────────────────
say "等待新服务就绪…"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$DSH_WEB_PORT/" 2>/dev/null | grep -q "dsh-skin-glass"; then
    say "完成！刷新浏览器页面，在 设置 → 通用 中选择背景图即可。"
    exit 0
  fi
  sleep 1
done
die "新服务未在 60 秒内就绪，请查看 /tmp/dsh-web-restart.log"
