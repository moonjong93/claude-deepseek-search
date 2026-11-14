# deepseek_research — the pi bridge

## What happens on a call

1. The MCP server spawns:
   `pi -p "<research prompt>" --no-session --mode json -t deepseek_web_search`
   with `cwd` = the current project and stdin ignored.
2. pi's `deepseek_web_search` extension calls DeepSeek's Responses API with the **native server tool**
   `deepseek_web_search` on `deepseek-flash`. DeepSeek does the searching, page opening and synthesis
   server-side (multiple `web_search_call` items per call).
3. The server reads pi's JSONL event stream, takes the tool result (`answer` + search actions) and
   returns it with the research trail and the per-call cost.

## Why flash and not pro

The OpenAI-compatible `web_search` tool type is documented as `deepseek-v4-pro` only; on flash it is
silently ignored. The native `deepseek_web_search` tool works on `deepseek-flash` and is ~4x cheaper,
but it **cannot be forced** (`tool_choice` naming it returns HTTP 400) — the model decides whether to
search. When it decides not to, the tool output is annotated with
`[No web search was executed ...]` so a memory-only answer is never mistaken for research.

## Cost and latency

Measured: a pricing question took 56 s, 3 searches + 9 fetches ≈ $0.009 (plus pi's flash tokens).
Anything below ~20 s usually means the model answered from memory instead of researching.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PI_BIN` | `pi` | path to the pi CLI |
| `DEEPSEEK_PI_TIMEOUT_MS` | 240000 | hard kill timeout for the pi subprocess |
| `DEEPSEEK_API_KEY` | `~/.pi/agent/auth.json` → `deepseek.key` | API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | proxy support |

pi's own settings live in `~/.pi/agent/deepseek-web-search.json` (model, reasoning effort, timeouts,
price overrides). The extension source is a local fork at
`~/.pi/agent/extensions/pi-deepseek-web-search/` — see its `LOCAL_MODIFICATIONS.md`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `pi research failed: pi exited … without output` | pi printed no JSON events | run the same `pi -p …` command manually to see stderr |
| `pi timed out after 240000ms` | model looping, or pi waiting on stdin (must be ignored) | raise `DEEPSEEK_PI_TIMEOUT_MS`; never give pi a pipe on stdin |
| answer lacks sources | model skipped the search | re-ask with "search the web before answering", or use `deepseek_search` directly |
| `[No web search was executed …]` in output | model answered from memory | treat as unverified; retry or fall back to `deepseek_search` |
