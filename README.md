# deepseek-search-bridge

Web search for **Claude Code** (and optional hand-off to **pi**) through the DeepSeek API.
One copy of this repo configures any machine.

- Claude Code gets 5 MCP tools: `deepseek_search`, `deepseek_fetch`, `deepseek_research`, `brief_read`, `brief_append`
- A `deepseek-search` skill teaches Claude when to use which (progressive disclosure: 41-line `SKILL.md`, details in `references/`)
- On machines with pi, `deepseek_research` routes broad questions through pi's `deepseek_web_search` extension (native server tool on `deepseek-flash`)
- Both agents share one hand-off file: `<project>/.pi/bridge/brief.md`

Cost: **$0.75 per 1,000 searches/fetches**. A mediated research call is typically $0.005–0.02.

## Quick start

```bash
git clone <this-repo> ~/Works/deepseek-search-bridge   # or copy the folder over
cd ~/Works/deepseek-search-bridge
./install.sh
```

Then **restart Claude Code** and ask something time-sensitive.

Requirements: Node 18+, Claude Code CLI. pi is optional.

## What the installer does

| Step | Location |
|---|---|
| Copies the MCP server | `~/.claude/mcp/deepseek-search.mjs` |
| Copies the skill | `~/.claude/skills/deepseek-search/` |
| Registers the server (user scope, every project) | `~/.claude.json` |
| Pre-approves the 5 tools so no permission prompt appears | `~/.claude/settings.json` (`permissions.allow`, backup written) |
| Installs the pi extension + config — only if `pi` is on PATH | `~/.pi/agent/extensions/pi-deepseek-web-search/`, `~/.pi/agent/deepseek-web-search.json` |
| Removes the stock `npm:pi-deepseek-web-search` entry | `~/.pi/agent/settings.json` |

Flags: `--skip-pi` (Claude Code only), `--dry-run` (print, change nothing). Re-running is safe.

## API key

Resolved in this order:

1. `DEEPSEEK_API_KEY` environment variable
2. `~/.pi/agent/auth.json` → `deepseek.key` (present if pi is logged in)
3. `~/.claude/deepseek-api-key` (standalone file, `chmod 600`)

The installer offers to write option 3 interactively.

## Verify

```bash
claude mcp list | grep deepseek          # -> ✔ Connected
node ~/.claude/mcp/deepseek-search.mjs   # reads JSON-RPC on stdin, Ctrl-D to exit
```

In Claude Code, a first good prompt is *"오늘 서울 날씨 deepseek_search로 확인해줘"*.

## Layout

```
mcp/deepseek-search.mjs        # stdio MCP server, zero dependencies
skills/deepseek-search/        # SKILL.md + references/{routing,search-api,pi-bridge,brief}.md
pi/extensions/pi-deepseek-web-search/   # fork: native deepseek_web_search on deepseek-flash
pi/deepseek-web-search.json    # pi extension config (model, timeouts, cache)
install.sh / uninstall.sh
```

## Security

No credentials are stored in this repository. The installer reads the key from
`DEEPSEEK_API_KEY`, `~/.pi/agent/auth.json`, or `~/.claude/deepseek-api-key`, and never prints it.
The MCP server makes outbound requests only to `api.deepseek.com` (configurable via
`DEEPSEEK_BASE_URL`) and runs `pi` locally when `deepseek_research` is used.

## Why the pi extension is forked

The npm package sends the OpenAI-shaped `web_search` tool with a forced `tool_choice`. DeepSeek
documents that server-side `web_search` as **`deepseek-v4-pro` only**; on `deepseek-flash` it is
ignored silently, so every query returned "I can't access live data" while still billing tokens.
The fork uses the native `deepseek_web_search` tool (works on flash, ~4x cheaper, cannot be forced),
fixes the price table, and bills the per-search fee. See
`pi/extensions/pi-deepseek-web-search/LOCAL_MODIFICATIONS.md`.

## Credits

The pi extension is a modified copy of [pi-deepseek-web-search](https://github.com/zzwtsy/pi-deepseek-web-search)
by [zzwtsy](https://github.com/zzwtsy) (MIT). The original license is kept at
`pi/extensions/pi-deepseek-web-search/LICENSE`; the changes are listed in its `LOCAL_MODIFICATIONS.md`.

Search and page content come from DeepSeek's [Search & Fetch API](https://api-docs.deepseek.com/guides/search).

## License

MIT — see [LICENSE](LICENSE).

## Uninstall

```bash
./uninstall.sh            # Claude Code only
./uninstall.sh --with-pi  # also remove the pi extension
```
