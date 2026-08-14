#!/bin/bash
# dsh web 自动重启：等待旧服务退出后重新拉起，并轮询直到就绪。
# 由 install.sh / uninstall.sh 调用；以 nohup 方式脱离调用方运行。
set -u

OLD_PID="${1:-}"
LOG="${2:-/tmp/dsh-web-restart.log}"
URL="http://127.0.0.1:3080/"

if command -v dsh >/dev/null 2>&1; then
  DSH_CMD=(dsh)
else
  DSH_CMD=(npx --yes @deepseek-ai/dsh)
fi

echo "[$(date '+%H:%M:%S')] watcher started, old_pid=$OLD_PID" >> "$LOG"

# 1) 等待旧进程退出（最多 30s）
for i in $(seq 1 60); do
  if [ -z "$OLD_PID" ] || ! kill -0 "$OLD_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# 2) 等待端口释放（最多 15s）
for i in $(seq 1 30); do
  if ! lsof -iTCP:3080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# 3) 重新拉起 dsh web
echo "[$(date '+%H:%M:%S')] starting dsh web" >> "$LOG"
cd "$HOME"
nohup "${DSH_CMD[@]}" web >> "$LOG" 2>&1 &
NEW_PID=$!
echo "[$(date '+%H:%M:%S')] launched pid=$NEW_PID" >> "$LOG"

# 4) 轮询直到 3080 就绪（最多 90s）
for i in $(seq 1 180); do
  if curl -sf -o /dev/null "$URL"; then
    echo "[$(date '+%H:%M:%S')] web up after ${i} polls (pid $NEW_PID)" >> "$LOG"
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] ERROR: dsh web exited early" >> "$LOG"
    exit 1
  fi
  sleep 0.5
done
echo "[$(date '+%H:%M:%S')] ERROR: timeout waiting for web" >> "$LOG"
exit 1
