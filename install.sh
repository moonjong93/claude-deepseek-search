#!/usr/bin/env bash
# Install the DeepSeek web-search bridge for Claude Code (and optionally pi).
#
#   ./install.sh                 install everything available on this machine
#   ./install.sh --skip-pi       Claude Code only (no pi extension/config)
#   ./install.sh --dry-run       print what would happen, change nothing
#
# Idempotent: safe to re-run after updating this repo.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${HOME:?HOME is not set}"

CLAUDE_DIR="$HOME_DIR/.claude"
MCP_DEST="$CLAUDE_DIR/mcp/deepseek-search.mjs"
SKILL_DEST="$CLAUDE_DIR/skills/deepseek-search"
PI_EXT_PARENT="$HOME_DIR/.pi/agent/extensions"
PI_CONFIG="$HOME_DIR/.pi/agent/deepseek-web-search.json"
PI_SETTINGS="$HOME_DIR/.pi/agent/settings.json"
SERVER_NAME="deepseek-search"
TOOLS='mcp__deepseek-search__deepseek_search mcp__deepseek-search__deepseek_fetch mcp__deepseek-search__deepseek_research mcp__deepseek-search__brief_read mcp__deepseek-search__brief_append'

SKIP_PI=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-pi) SKIP_PI=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

step "Checking prerequisites"
if ! have node; then
  say "ERROR: node is required (the MCP server runs on Node 18+)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  say "ERROR: node $NODE_MAJOR found, need >= 18." >&2
  exit 1
fi
say "node $(node -v)"
have claude && say "claude CLI found: $(command -v claude)" || say "claude CLI not found - MCP registration will be skipped"
if [ "$SKIP_PI" = 0 ]; then
  have pi && say "pi CLI found: $(command -v pi)" || say "pi CLI not found - skipping the pi extension (deepseek_research will be unavailable)"
fi

step "Installing the MCP server"
run mkdir -p "$CLAUDE_DIR/mcp"
run cp "$REPO_DIR/mcp/deepseek-search.mjs" "$MCP_DEST"
run chmod +x "$MCP_DEST"
say "  -> $MCP_DEST"

step "Installing the skill"
run mkdir -p "$SKILL_DEST"
run cp -R "$REPO_DIR/skills/deepseek-search/." "$SKILL_DEST/"
say "  -> $SKILL_DEST/SKILL.md (+ references/)"

step "Registering the MCP server with Claude Code"
if have claude; then
  if [ "$DRY_RUN" = 1 ]; then
    say "  [dry-run] claude mcp remove $SERVER_NAME --scope user"
    say "  [dry-run] claude mcp add --scope user $SERVER_NAME -- node $MCP_DEST"
  else
    claude mcp remove "$SERVER_NAME" --scope user >/dev/null 2>&1 || true
    claude mcp add --scope user "$SERVER_NAME" -- node "$MCP_DEST" >/dev/null
    say "  registered (user scope, all projects)"
  fi
else
  say "  skipped - run this later:"
  say "    claude mcp add --scope user $SERVER_NAME -- node $MCP_DEST"
fi

step "Pre-approving the tools in ~/.claude/settings.json"
if [ "$DRY_RUN" = 1 ]; then
  say "  [dry-run] add $TOOLS to permissions.allow"
elif node - "$CLAUDE_DIR/settings.json" $TOOLS <<'NODE'
const fs = require('node:fs')
const [file, ...tools] = process.argv.slice(2)
let json = {}
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (raw) json = JSON.parse(raw)
  fs.writeFileSync(`${file}.bak`, fs.readFileSync(file))
}
json.permissions ??= {}
json.permissions.allow ??= []
let added = 0
for (const tool of tools) {
  if (!json.permissions.allow.includes(tool)) {
    json.permissions.allow.push(tool)
    added += 1
  }
}
fs.mkdirSync(require('node:path').dirname(file), { recursive: true })
fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
console.log(`  ${added} tool permission(s) added`)
NODE
then :; fi

step "Checking the DeepSeek API key"
KEY_SOURCES=()
[ -n "${DEEPSEEK_API_KEY:-}" ] && KEY_SOURCES+=("DEEPSEEK_API_KEY environment variable")
[ -f "$HOME_DIR/.pi/agent/auth.json" ] && KEY_SOURCES+=("~/.pi/agent/auth.json (pi credentials)")
[ -f "$CLAUDE_DIR/deepseek-api-key" ] && KEY_SOURCES+=("~/.claude/deepseek-api-key")
if [ ${#KEY_SOURCES[@]} -eq 0 ]; then
  say "  No key found. Add one of these:"
  say "    export DEEPSEEK_API_KEY=sk-...            (shell profile)"
  say "    printf 'sk-...' > ~/.claude/deepseek-api-key && chmod 600 ~/.claude/deepseek-api-key"
  say "    install and log in to pi (reuses ~/.pi/agent/auth.json)"
  if [ "$DRY_RUN" = 0 ] && [ -t 0 ]; then
    printf '  Paste a key now to save it to ~/.claude/deepseek-api-key (or press Enter to skip): '
    read -r KEY_INPUT || true
    if [ -n "${KEY_INPUT:-}" ]; then
      umask 077
      printf '%s' "$KEY_INPUT" > "$CLAUDE_DIR/deepseek-api-key"
      say "  saved to ~/.claude/deepseek-api-key"
      KEY_SOURCES+=("~/.claude/deepseek-api-key")
    fi
  fi
else
  say "  found: ${KEY_SOURCES[*]}"
fi

if [ "$SKIP_PI" = 1 ]; then
  step "Skipping pi (--skip-pi)"
elif have pi; then
  step "Installing the pi extension (deepseek_web_search on deepseek-flash)"
  run mkdir -p "$PI_EXT_PARENT"
  run cp -R "$REPO_DIR/pi/extensions/pi-deepseek-web-search" "$PI_EXT_PARENT/"
  say "  -> $PI_EXT_PARENT/pi-deepseek-web-search"
  if [ -f "$PI_CONFIG" ]; then
    say "  config kept: $PI_CONFIG"
  else
    run cp "$REPO_DIR/pi/deepseek-web-search.json" "$PI_CONFIG"
    say "  -> $PI_CONFIG"
  fi
  if [ -f "$PI_SETTINGS" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      say "  [dry-run] drop \"npm:pi-deepseek-web-search\" from $PI_SETTINGS"
    elif node -e '
      const fs = require("node:fs")
      const file = process.argv[1]
      const json = JSON.parse(fs.readFileSync(file, "utf8"))
      const before = (json.packages || []).length
      json.packages = (json.packages || []).filter(p => p !== "npm:pi-deepseek-web-search")
      if (json.packages.length === 0) delete json.packages
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n")
      if (before !== (json.packages || []).length) console.log("  removed the npm package entry (replaces it)")
    ' "$PI_SETTINGS"; then :; fi
  fi
  say "  run /reload inside pi (or restart it) to load the extension"
else
  step "pi not installed - skipping the pi extension"
  say "  deepseek_search / deepseek_fetch work without pi; deepseek_research needs it."
fi

step "Verifying the MCP server"
if [ "$DRY_RUN" = 0 ]; then
  if node "$MCP_DEST" <<'JSON' | node -e '
    let out = ""
    process.stdin.on("data", d => out += d).on("end", () => {
      const tools = out.trim().split("\n").map(l => JSON.parse(l)).find(m => m.id === 2)
      if (!tools?.result?.tools) { console.error("verification failed"); process.exit(1) }
      console.log("  tools: " + tools.result.tools.map(t => t.name).join(", "))
    })'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"install","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
JSON
  then :; else
    say "  WARNING: the server did not answer tools/list; run 'node $MCP_DEST' manually." >&2
  fi
fi

step "Done"
say "Restart Claude Code (MCP servers load at startup), then try:"
say "  \"오늘 서울 날씨 deepseek_search로 확인해줘\""
say "  \"요즘 나온 Rust 웹프레임워크 비교 조사해줘\"   (broad -> deepseek_research)"
say ""
say "Cost: \$0.75 per 1,000 searches. Usage log: ~/.claude/mcp/deepseek-usage.jsonl"
