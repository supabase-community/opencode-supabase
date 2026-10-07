#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${1:-${TMPDIR:-/tmp}/opencode-supabase-tui-$RANDOM}"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode)}"
SOCKET="tmux.sock"
SESSION="opencode-supabase-$$"
PASSED=false
START_TS="$(date -u +%FT%TZ)"

if [[ -e "$ARTIFACT_DIR" ]]; then
  printf 'Artifact directory already exists: %s\n' "$ARTIFACT_DIR" >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"/{home,tmp,config,data,cache,state,runtime,config-dirs,data-dirs,work,package,npm/cache,npm/config}
touch "$ARTIFACT_DIR/npm/config/userconfig" "$ARTIFACT_DIR/npm/config/globalconfig"
chmod 700 "$ARTIFACT_DIR/runtime"
cd "$ARTIFACT_DIR"

diagnostics() {
  tmux -S "$SOCKET" capture-pane -p -t "$SESSION" -S - >"$ARTIFACT_DIR/pane.txt" 2>/dev/null || true
  "$OPENCODE_BIN" --version >"$ARTIFACT_DIR/opencode-version.txt" 2>&1 || true
  if [[ -n "${TARBALL:-}" && -f "$TARBALL" ]]; then
    sha256sum "$TARBALL" >"$ARTIFACT_DIR/tarball.sha256"
    tar -tzvf "$TARBALL" >"$ARTIFACT_DIR/tarball-contents.txt"
  fi
  for file in "$ARTIFACT_DIR/work/.opencode/opencode.json" "$ARTIFACT_DIR/work/.opencode/tui.json"; do
    [[ -f "$file" ]] && { printf '=== %s ===\n' "$file"; cat "$file"; }
  done >"$ARTIFACT_DIR/plugin-metadata.txt" 2>&1 || true
  {
    printf 'started: %s\n' "$START_TS"
    printf 'finished: %s\n' "$(date -u +%FT%TZ)"
    printf 'passed: %s\n' "$PASSED"
    printf 'tmux: %s\n' "$(tmux -V 2>&1)"
    printf 'opencode: %s\n' "$("$OPENCODE_BIN" --version 2>&1)"
    printf 'platform: %s\n' "$(uname -a)"
    [[ -f "$ARTIFACT_DIR/tarball.sha256" ]] && cat "$ARTIFACT_DIR/tarball.sha256"
  } >"$ARTIFACT_DIR/run-metadata.txt" 2>&1 || true
  if [[ "$PASSED" != true ]]; then
    printf 'OpenCode TUI regression failed. Diagnostics retained: %s\n' "$ARTIFACT_DIR" >&2
    for file in install.stdout install.stderr pane.txt tui.stderr failure-reason.txt; do
      [[ -f "$ARTIFACT_DIR/$file" ]] && { printf '\n=== %s ===\n' "$file" >&2; cat "$ARTIFACT_DIR/$file" >&2; }
    done
    file=data/opencode/log/opencode.log
    [[ -f "$ARTIFACT_DIR/$file" ]] && { printf '\n=== %s ===\n' "$file" >&2; cat "$ARTIFACT_DIR/$file" >&2; }
    for file in opencode-version.txt tarball.sha256 plugin-metadata.txt run-metadata.txt; do
      [[ -f "$ARTIFACT_DIR/$file" ]] && { printf '\n=== %s ===\n' "$file" >&2; cat "$ARTIFACT_DIR/$file" >&2; }
    done
  fi
  tmux -S "$SOCKET" kill-session -t "$SESSION" 2>/dev/null || true
  tmux -S "$SOCKET" kill-server 2>/dev/null || true
  rm -f "$SOCKET"
  # OpenCode caches the installed plugin under
  # <XDG_CACHE_HOME>/opencode/packages/<raw spec>, and the spec is
  # `file:<tarball>` — so the cache tree contains a `file:` directory.
  # upload-artifact@v4 rejects ':' in any uploaded path (every canary and the
  # 2026-07-23 main CI diagnostics upload failed on it). The same trees plus
  # npm's cacache and the host's dependency installs are also >100MB of
  # non-diagnostic junk. All evidence files (pane, logs, metadata, tarball,
  # lockfiles) live outside these trees, so drop them before evidence upload.
  rm -rf "$ARTIFACT_DIR/cache/opencode/packages" "$ARTIFACT_DIR/npm/cache" "$ARTIFACT_DIR/config/opencode/node_modules" "$ARTIFACT_DIR/work/.opencode/node_modules" "$ARTIFACT_DIR/tmp"
}
trap diagnostics EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# wait_for <seconds> <description> <pattern> [pattern...]
# Polls the tmux pane until every extended-regex pattern is visible or the
# deadline passes. Fails fast if the tmux session dies. Readiness and render
# checks use only visible pane output, never OpenCode log internals.
wait_for() {
  local seconds="$1" desc="$2"
  shift 2
  local deadline=$((SECONDS + seconds))
  while ((SECONDS < deadline)); do
    if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
      printf 'tmux session died while waiting for %s\n' "$desc" >&2
      printf '%s\n' "dead session: $desc" >>"$ARTIFACT_DIR/failure-reason.txt"
      return 1
    fi
    tmux -S "$SOCKET" capture-pane -p -t "$SESSION" -S - >"$ARTIFACT_DIR/pane.txt" 2>/dev/null || true
    local ok=true pattern
    for pattern in "$@"; do
      grep -Eq -- "$pattern" "$ARTIFACT_DIR/pane.txt" 2>/dev/null || {
        ok=false
        break
      }
    done
    if [[ "$ok" == true ]]; then
      return 0
    fi
    sleep 1
  done
  printf 'Timed out after %ss waiting for %s\n' "$seconds" "$desc" >&2
  printf '%s\n' "timeout (${seconds}s): $desc" >>"$ARTIFACT_DIR/failure-reason.txt"
  return 1
}

if [[ -n "${PACKAGE_TARBALL:-}" ]]; then
  [[ "$PACKAGE_TARBALL" = /* && -f "$PACKAGE_TARBALL" ]] || {
    printf 'PACKAGE_TARBALL must be an absolute existing file: %s\n' "$PACKAGE_TARBALL" >&2
    exit 1
  }
  TARBALL="$PACKAGE_TARBALL"
else
  if ! PACK_JSON="$(cd "$ROOT" && timeout 120 env -i \
    PATH="$PATH" \
    HOME="$ARTIFACT_DIR/home" \
    NPM_CONFIG_CACHE="$ARTIFACT_DIR/npm/cache" \
    NPM_CONFIG_USERCONFIG="$ARTIFACT_DIR/npm/config/userconfig" \
    NPM_CONFIG_GLOBALCONFIG="$ARTIFACT_DIR/npm/config/globalconfig" \
    NPM_CONFIG_IGNORE_SCRIPTS=false \
    npm pack --json --pack-destination "$ARTIFACT_DIR/package")"; then
    printf 'npm pack failed or timed out\n' >&2
    exit 1
  fi
  TARBALL="$ARTIFACT_DIR/package/$(jq -r '.[0].filename' <<<"$PACK_JSON")"
  printf '%s\n' "$PACK_JSON" >"$ARTIFACT_DIR/npm-pack.json"
fi
printf 'Tarball SHA-256: %s\n' "$(sha256sum "$TARBALL" | cut -d ' ' -f 1)"

git -C "$ARTIFACT_DIR/work" init -q
clean_env=(
  env -i
  "PATH=$PATH"
  "HOME=$ARTIFACT_DIR/home"
  "USER=${USER:-$(id -un)}"
  "LOGNAME=${LOGNAME:-${USER:-$(id -un)}}"
  "TMPDIR=$ARTIFACT_DIR/tmp"
  "NPM_CONFIG_CACHE=$ARTIFACT_DIR/npm/cache"
  "NPM_CONFIG_USERCONFIG=$ARTIFACT_DIR/npm/config/userconfig"
  "NPM_CONFIG_GLOBALCONFIG=$ARTIFACT_DIR/npm/config/globalconfig"
  "NPM_CONFIG_IGNORE_SCRIPTS=false"
  "OPENCODE_DISABLE_AUTOUPDATE=1"
  "XDG_CONFIG_HOME=$ARTIFACT_DIR/config"
  "XDG_DATA_HOME=$ARTIFACT_DIR/data"
  "XDG_CACHE_HOME=$ARTIFACT_DIR/cache"
  "XDG_STATE_HOME=$ARTIFACT_DIR/state"
  "XDG_RUNTIME_DIR=$ARTIFACT_DIR/runtime"
  "XDG_CONFIG_DIRS=$ARTIFACT_DIR/config-dirs"
  "XDG_DATA_DIRS=$ARTIFACT_DIR/data-dirs"
)

[[ ! -e "$ARTIFACT_DIR/home/.opencode" ]]
if ! (
  cd "$ARTIFACT_DIR/work"
  timeout 180 "${clean_env[@]}" "$OPENCODE_BIN" plugin "file:$TARBALL" --print-logs --log-level DEBUG
) >"$ARTIFACT_DIR/install.stdout" 2>"$ARTIFACT_DIR/install.stderr"; then
  printf 'opencode plugin install failed or timed out\n' >&2
  exit 1
fi

grep -q 'Plugin package ready' "$ARTIFACT_DIR/install.stdout"
for metadata in opencode.json tui.json; do
  jq -e --arg spec "file:$TARBALL" '.plugin == [$spec]' "$ARTIFACT_DIR/work/.opencode/$metadata" >/dev/null
done

cat >"$ARTIFACT_DIR/launch.sh" <<EOF
#!/bin/sh
exec env -i PATH="$PATH" HOME="$ARTIFACT_DIR/home" USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-${USER:-$(id -un)}}" TMPDIR="$ARTIFACT_DIR/tmp" NPM_CONFIG_CACHE="$ARTIFACT_DIR/npm/cache" NPM_CONFIG_USERCONFIG="$ARTIFACT_DIR/npm/config/userconfig" NPM_CONFIG_GLOBALCONFIG="$ARTIFACT_DIR/npm/config/globalconfig" NPM_CONFIG_IGNORE_SCRIPTS=false OPENCODE_DISABLE_AUTOUPDATE=1 XDG_CONFIG_HOME="$ARTIFACT_DIR/config" XDG_DATA_HOME="$ARTIFACT_DIR/data" XDG_CACHE_HOME="$ARTIFACT_DIR/cache" XDG_STATE_HOME="$ARTIFACT_DIR/state" XDG_RUNTIME_DIR="$ARTIFACT_DIR/runtime" XDG_CONFIG_DIRS="$ARTIFACT_DIR/config-dirs" XDG_DATA_DIRS="$ARTIFACT_DIR/data-dirs" TERM=xterm-256color "$OPENCODE_BIN" --print-logs --log-level DEBUG 2>"$ARTIFACT_DIR/tui.stderr"
EOF
chmod +x "$ARTIFACT_DIR/launch.sh"

tmux -S "$SOCKET" new-session -d -s "$SESSION" -x 120 -y 40 -c "$ARTIFACT_DIR/work" "$ARTIFACT_DIR/launch.sh"

wait_for 120 "TUI readiness" 'Ask anything'

tmux -S "$SOCKET" send-keys -t "$SESSION" -l '/supabase'
wait_for 15 "/supabase command registration" '/supabase\s+Connect to Supabase'
tmux -S "$SOCKET" send-keys -t "$SESSION" Enter
wait_for 15 "/supabase command dialog" 'Open your browser to authorize OpenCode' 'Supabase account\.'

tmux -S "$SOCKET" send-keys -t "$SESSION" Enter
wait_for 30 "rich /supabase dialog" 'Connect to Supabase' 'Starting authorization|Waiting for browser authorization' 'Dismiss'

for evidence in "$ARTIFACT_DIR/pane.txt" "$ARTIFACT_DIR/tui.stderr" "$ARTIFACT_DIR/data/opencode/log/opencode.log"; do
  if [[ -f "$evidence" ]] && grep -Eqi "No renderer found|failed to load tui plugin|Cannot find module 'react/jsx-dev-runtime'" "$evidence"; then
    printf 'Forbidden runtime error found in %s\n' "$evidence" >&2
    exit 1
  fi
done

tmux -S "$SOCKET" send-keys -t "$SESSION" Escape
sleep 1

PASSED=true
printf 'OpenCode %s rendered rich /supabase dialog\n' "$("$OPENCODE_BIN" --version)"
printf 'Tarball SHA-256: %s\n' "$(sha256sum "$TARBALL" | cut -d ' ' -f 1)"
printf 'Plugin metadata: %s/.opencode/{opencode.json,tui.json}\n' "$ARTIFACT_DIR/work"
printf 'Evidence retained: %s\n' "$ARTIFACT_DIR"
