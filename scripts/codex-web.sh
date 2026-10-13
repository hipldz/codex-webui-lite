#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_ENTRY="$ROOT_DIR/dist-server/index.js"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/codex-web.pid"
LOG_FILE="$RUN_DIR/codex-web.log"
ACTION="${1:-start}"

read_pid() {
  [[ -f "$PID_FILE" ]] && tr -dc '0-9' < "$PID_FILE" || true
}

is_harness_process() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -F -- "$SERVER_ENTRY" >/dev/null
}

start_server() {
  local pid node_bin
  local -a detach=()
  pid="$(read_pid)"
  if is_harness_process "$pid"; then
    echo "Codex Web is already running (PID $pid)."
    return
  fi

  [[ -f "$SERVER_ENTRY" ]] || {
    echo "Production build not found: $SERVER_ENTRY" >&2
    echo "Run 'npm run build' first." >&2
    exit 1
  }
  node_bin="${NODE_BIN:-$(command -v node || true)}"
  [[ -n "$node_bin" ]] || { echo "Node.js was not found in PATH." >&2; exit 1; }
  command -v setsid >/dev/null 2>&1 && detach=(setsid)

  mkdir -p "$RUN_DIR"
  rm -f "$PID_FILE"
  cd "$ROOT_DIR"
  nohup "${detach[@]}" "$node_bin" --max-old-space-size=256 "$SERVER_ENTRY" </dev/null >>"$LOG_FILE" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  for _ in {1..30}; do
    if is_harness_process "$pid"; then
      echo "Codex Web started in background (PID $pid)."
      echo "Log: $LOG_FILE"
      return
    fi
    sleep 0.1
  done

  echo "Codex Web failed to start. Recent log:" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
}

stop_server() {
  local pid
  pid="$(read_pid)"
  if ! is_harness_process "$pid"; then
    rm -f "$PID_FILE"
    echo "Codex Web is not running."
    return
  fi

  kill -TERM "$pid"
  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Codex Web stopped."
      return
    fi
    sleep 0.1
  done

  echo "Graceful shutdown timed out; forcing PID $pid to stop." >&2
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

show_status() {
  local pid
  pid="$(read_pid)"
  if is_harness_process "$pid"; then
    echo "Codex Web is running (PID $pid)."
  else
    rm -f "$PID_FILE"
    echo "Codex Web is not running."
    return 1
  fi
}

show_logs() {
  mkdir -p "$RUN_DIR"
  touch "$LOG_FILE"
  echo "Following $LOG_FILE (Ctrl+C only exits log view):"
  tail -n 80 -f "$LOG_FILE"
}

case "$ACTION" in
  start) start_server ;;
  stop) stop_server ;;
  restart) stop_server; start_server ;;
  status) show_status ;;
  logs) show_logs ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
