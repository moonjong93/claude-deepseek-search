# Local modifications (vs npm pi-deepseek-web-search@0.2.1)

Forked to `~/.pi/agent/extensions/pi-deepseek-web-search/` because the upstream
build silently fails to search on `deepseek-flash`.

## Why

Upstream sends the OpenAI-compatible tool `{"type":"web_search"}` with
`tool_choice: {"type":"web_search"}`. Per DeepSeek docs that server-side
`web_search` call is **`deepseek-v4-pro` only**:

- https://api-docs.deepseek.com/guides/responses_api
  (`response.web_search_call.*` — "deepseek-v4-pro only")

On `deepseek-flash` the tool is ignored without any error, so every query came
back as "I can't access live data" while still costing tokens.

## What changed

1. `src/deepseek.ts`
   - `tools: [{"type":"deepseek_web_search"}]` (official native server tool)
   - forced `tool_choice` removed — the native tool **cannot** be forced
     (`400 tool_choice: deepseek_web_search cannot be forced`), the model decides
   - `DEFAULT_MODEL` → `deepseek-flash`
2. `src/config.ts`
   - default model `deepseek-flash` (V4.1-Flash-1017; legacy `deepseek-v4-flash` is an alias)
   - default prices corrected to official off-peak flash rates
     `0.15 / 0.003 / 0.60` USD per 1M (input-miss / cache-hit / output)
3. `src/format.ts`
   - `computeCost()` now bills server tools: `$0.75 / 1,000` searches and
     fetches (`SERVER_TOOL_PRICE_PER_CALL`), reported as `cost.serverTools`
   - when a query produced no search action, the tool content is annotated with
     `[No web search was executed ...]` so the caller never mistakes model
     memory for a search result
4. `src/index.ts`
   - counts `search` vs `open_page`/`find_in_page` actions for cost accounting
   - tool description mentions the per-search price

## Price reference (2026)

| | deepseek-flash | deepseek-v4-pro |
|---|---|---|
| input miss / hit / output (off-peak, per 1M) | $0.15 / $0.003 / $0.60 | $0.66 / $0.022 / $1.98 |
| searches & fetches | $0.75 / 1,000 calls (both models) | same |

Peak = 2x, weekdays 01:00-04:00 and 06:00-10:00 UTC.

## Install notes

- Enabled by auto-discovery: `~/.pi/agent/extensions/*/package.json` (`pi.extensions`).
- `npm:pi-deepseek-web-search` was removed from `~/.pi/agent/settings.json` to
  avoid registering the same tool name twice.
- Config: `~/.pi/agent/deepseek-web-search.json`.
- Run `/reload` (or restart pi) after edits.
