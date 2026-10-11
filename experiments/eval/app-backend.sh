#!/usr/bin/env bash
# Live checks for the app backend, without the GUI.
# Drives src-tauri/examples/backend_cli.rs and talks to the bundled Ollama with curl.
#
# Usage: experiments/eval/app-backend.sh <check> [args]
#   ready                start, ready within 15 s, stop, no process left
#   pull-cancel <GB>     start a pull, cancel it after <GB> downloaded
#   pull                 pull to the end (prints the first completed bytes: > 0 means resume)
#   full                 ready, model listed, generate once, idle unload (keep_alive 10s), stop
#   port                 11535 taken by a dummy listener: backend uses 11536
#   broken               missing and corrupt binary: status failed with a message
#   offline              generate only: no pull call in the log, no outbound connection
#
# Env: LIX_APP_DATA (required, a temp dir), MODEL (default gemma4:e2b-it-qat).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OLLAMA_DIR="$ROOT/src-tauri/resources/ollama"
CLI="$ROOT/src-tauri/target/debug/examples/backend_cli"
MODEL="${MODEL:-gemma4:e2b-it-qat}"
APP_DATA="${LIX_APP_DATA:?set LIX_APP_DATA to a temp dir}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lix-backend.XXXXXX")"
CLI_PID=""

say() { printf '%s\n' "$*"; }
fail() { say "FAIL: $*"; exit 1; }
pass() { say "PASS: $*"; }

cleanup() {
  if [[ -n "$CLI_PID" ]] && kill -0 "$CLI_PID" 2>/dev/null; then
    echo quit >&3 || true
    wait "$CLI_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

build() { (cd "$ROOT/src-tauri" && cargo build -q --example backend_cli); }

# Starts the backend; sets URL and STATUS. Args go to backend_cli.
start() {
  rm -f "$WORK/out" "$WORK/in"
  mkfifo "$WORK/in"
  "$CLI" --app-data "$APP_DATA" "$@" <"$WORK/in" >"$WORK/out" 2>"$WORK/err" &
  CLI_PID=$!
  exec 3>"$WORK/in"
  local t0=$SECONDS
  until [[ -s "$WORK/out" ]]; do
    kill -0 "$CLI_PID" 2>/dev/null || fail "backend_cli died: $(cat "$WORK/err")"
    sleep 0.1
  done
  STATUS="$(head -1 "$WORK/out")"
  READY_SECS=$((SECONDS - t0))
  URL="$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' <<<"$STATUS")"
}

stop() {
  echo quit >&3
  wait "$CLI_PID" || true
  exec 3>&-
  CLI_PID=""
  rm -f "$WORK/in"
  grep -q '"stopped"' "$WORK/out" || fail "no stop line"
  local left
  left="$(pgrep -fl "$OLLAMA_DIR/" || true)"
  [[ -z "$left" ]] || fail "processes left after stop: $left"
  [[ ! -e "$APP_DATA/ollama.pid" ]] || fail "pid file left"
  pass "stop: no process from $OLLAMA_DIR left, pid file removed"
}

need_ready() {
  [[ "$STATUS" == *'"state":"ready"'* ]] || fail "not ready: $STATUS"
  pass "ready in ${READY_SECS}s at $URL"
  ((READY_SECS <= 15)) || fail "ready took ${READY_SECS}s"
}

completed_bytes() {
  # Sum of the last completed value per digest in a pull stream.
  python3 -I -c '
import json, sys
layers = {}
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("digest") and e.get("total"): layers[e["digest"]] = e.get("completed", 0)
print(sum(layers.values()))' "$1"
}

first_completed() {
  python3 -I -c '
import json, sys
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("digest") and e.get("total"): print(e.get("completed", 0)); break
else: print(0)' "$1"
}

installed() { curl -sf "$URL/api/tags" | grep -q "\"name\":\"$MODEL\""; }

generate() {
  curl -sf --max-time 300 "$URL/api/generate" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"Schreibe einen kurzen Satz über einen Hund.\",\"stream\":false,\"think\":false,\"options\":{\"num_predict\":40,\"num_ctx\":4096}}"
}

check="${1:-}"
build
mkdir -p "$APP_DATA"

case "$check" in
  ready)
    start --keep-alive 10s
    need_ready
    stop
    ;;

  pull-cancel)
    limit=$(python3 -I -c "print(int(float('${2:-1}') * 1e9))")
    start
    need_ready
    curl -sN "$URL/api/pull" -d "{\"model\":\"$MODEL\",\"stream\":true}" >"$WORK/pull" &
    curl_pid=$!
    while :; do
      kill -0 "$curl_pid" 2>/dev/null || fail "pull ended before cancel: $(tail -2 "$WORK/pull")"
      done_bytes=$(completed_bytes "$WORK/pull")
      ((done_bytes >= limit)) && break
      sleep 1
    done
    kill "$curl_pid"
    wait "$curl_pid" 2>/dev/null || true
    say "cancelled at $done_bytes bytes"
    sleep 2
    installed && fail "model listed after cancel"
    pass "pull cancelled at $(python3 -I -c "print(round($done_bytes/1e9,2))") GB, model not listed"
    stop
    ;;

  pull)
    start
    need_ready
    t0=$SECONDS
    curl -sN --max-time 7200 "$URL/api/pull" -d "{\"model\":\"$MODEL\",\"stream\":true}" >"$WORK/pull"
    tail -1 "$WORK/pull" | grep -q '"success"' || fail "pull did not finish: $(tail -2 "$WORK/pull")"
    say "first completed bytes: $(first_completed "$WORK/pull") (> 0 = resumed)"
    installed || fail "model not listed after pull"
    pass "pull finished in $((SECONDS - t0))s, model listed"
    stop
    ;;

  full)
    start --keep-alive 10s
    need_ready
    curl -sN "$URL/api/pull" -d "{\"model\":\"$MODEL\",\"stream\":true}" >"$WORK/pull"
    tail -1 "$WORK/pull" | grep -q '"success"' || fail "pull: $(tail -2 "$WORK/pull")"
    installed || fail "model not listed"
    pass "model $MODEL installed"
    out="$(generate)" || fail "generate failed"
    text="$(python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["response"].strip())' <<<"$out")"
    [[ -n "$text" ]] || fail "empty response"
    pass "generate: $text"
    curl -sf "$URL/api/ps" | grep -q "\"name\":\"$MODEL\"" || fail "model not loaded after generate"
    say "model loaded; waiting 15 s (keep_alive 10s)"
    sleep 15
    ps="$(curl -sf "$URL/api/ps")"
    [[ "$ps" == *'"models":[]'* ]] || fail "model still loaded: $ps"
    pass "idle unload: /api/ps empty after 15 s"
    stop
    ;;

  port)
    python3 -I -c '
import socket, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", 11535)); s.listen(); time.sleep(120)' &
    dummy=$!
    sleep 0.5
    start
    need_ready
    [[ "$URL" == "http://127.0.0.1:11536" ]] || fail "expected port 11536, got $URL"
    curl -sf "$URL/api/version" >/dev/null || fail "no answer on $URL"
    pass "port 11535 taken: backend on $URL answers"
    stop
    kill "$dummy"
    ;;

  broken)
    start --bin "$WORK/no-such-ollama"
    [[ "$STATUS" == *'"state":"failed"'* ]] || fail "missing binary: $STATUS"
    pass "missing binary: $STATUS"
    stop
    printf '\xcf\xfa\xed\xfe broken' >"$WORK/ollama"
    chmod +x "$WORK/ollama"
    start --bin "$WORK/ollama"
    [[ "$STATUS" == *'"state":"failed"'* ]] || fail "corrupt binary: $STATUS"
    pass "corrupt binary: $STATUS"
    stop
    ;;

  offline)
    log="$APP_DATA/logs/ollama.log"
    start
    need_ready
    from=$(($(wc -l <"$log") + 1))
    generate >"$WORK/gen" &
    gen_pid=$!
    : >"$WORK/lsof"
    while kill -0 "$gen_pid" 2>/dev/null; do
      for pid in $(pgrep -f "$OLLAMA_DIR/"); do
        lsof -nP -a -p "$pid" -i >>"$WORK/lsof" 2>/dev/null || true
      done
      sleep 0.5
    done
    wait "$gen_pid" || fail "generate failed"
    grep -q '"response"' "$WORK/gen" || fail "no response"
    pass "generate ok"
    new="$(tail -n +"$from" "$log")"
    # Request lines for pull, download messages or network dials would mean outbound traffic.
    grep -E '"/api/pull"|msg="?(pulling|downloading)|dial tcp|no such host' <<<"$new" && fail "log shows pull or network lines"
    pass "log since start: $(grep -c 'GIN' <<<"$new" || true) request lines, none for pull or remote hosts"
    remote="$(grep -E 'TCP' "$WORK/lsof" | grep -vE '127\.0\.0\.1|\[::1\]|localhost' || true)"
    [[ -z "$remote" ]] || fail "non-loopback connection: $remote"
    pass "lsof during generate: $(grep -c TCP "$WORK/lsof" || true) socket rows, all loopback"
    stop
    ;;

  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
