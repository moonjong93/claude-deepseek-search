#!/usr/bin/env bash
# Remove what install.sh added. Keeps ~/.pi/agent/deepseek-web-search.json and the settings backups.
#
#   ./uninstall.sh              Claude Code side only
#   ./uninstall.sh --with-pi    also remove the forked pi extension

set -euo pipefail

HOME_DIR="${HOME:?HOME is not set}"
CLAUDE_DIR="$HOME_DIR/.claude"
SERVER_NAME="deepseek-search"
TOOLS='mcp__deepseek-search__deepseek_search mcp__deepseek-search__deepseek_fetch mcp__deepseek-search__deepseek_research mcp__deepseek-search__brief_read mcp__deepseek-search__brief_append'

WITH_PI=0
for arg in "$@"; do
  case "$arg" in
    --with-pi) WITH_PI=1 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "Unregistering the MCP server"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "$SERVER_NAME" --scope user >/dev/null 2>&1 && echo "  removed" || echo "  not registered"
else
  echo "  claude CLI not found; remove manually from ~/.claude.json"
fi

step "Removing files"
rm -f "$CLAUDE_DIR/mcp/deepseek-search.mjs" && echo "  ~/.claude/mcp/deepseek-search.mjs"
rm -rf "$CLAUDE_DIR/skills/deepseek-search" && echo "  ~/.claude/skills/deepseek-search/"

step "Revoking tool permissions"
if node - "$CLAUDE_DIR/settings.json" $TOOLS <<'NODE'
const fs = require('node:fs')
const [file, ...tools] = process.argv.slice(2)
if (!fs.existsSync(file)) process.exit(0)
const json = JSON.parse(fs.readFileSync(file, 'utf8') || '{}')
const allow = json.permissions?.allow
if (Array.isArray(allow)) {
  json.permissions.allow = allow.filter(entry => !tools.includes(entry))
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`  ${allow.length - json.permissions.allow.length} permission(s) removed`)
}
NODE
then :; fi

if [ "$WITH_PI" = 1 ]; then
  step "Removing the pi extension"
  rm -rf "$HOME_DIR/.pi/agent/extensions/pi-deepseek-web-search" && echo "  removed extension"
  echo "  kept config: ~/.pi/agent/deepseek-web-search.json"
  echo "  to restore the stock package:  pi install npm:pi-deepseek-web-search"
fi

step "Done"
echo "Restart Claude Code to drop the server."
