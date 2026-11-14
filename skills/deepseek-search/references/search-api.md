# DeepSeek Search & Fetch API

Base URL `https://api.deepseek.com`, bearer auth with the same key as the chat API. The MCP server
wraps both endpoints, so you normally never call them directly.

## deepseek_search → POST /v1/tools/search

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `query` | string | yes | — | 1–128 characters, not blank. Operators allowed. |
| `count` | integer | no | 10 | 1–50. Does not affect price. |
| `need_content` | boolean | no | false | Adds extracted page content (large). Use `deepseek_fetch` instead when you only need one page. |
| `ori_question` | string | no | — | Original user question (≤128 chars) to improve query understanding. |
| `localization` | string | no | "" | IP address used to localize results. |

### Query operators

| Operator | Example | Effect |
|---|---|---|
| `site:` | `site:github.com OR site:huggingface.co` | restrict to sites (join alternatives with OR) |
| `-site:` | `-site:example.com` | exclude a site |
| `-` | `-advertisement` | exclude pages containing a term |
| `"..."` | `"release notes"` | exact phrase |
| `-"..."` | `-"release notes"` | exclude exact phrase |
| `lang:` | `lang:ko,en` | language filter |
| `after:` / `before:` | `after:2026-01-01`, `before:2026` | publication-date range |

### Result item

`rerank_score` (0–3; ≥1.5 is high quality), `title`, `url`, `snippet` (~100–200 chars, for display),
`summary` (~600–800 chars, written for a model), `content` (empty unless `need_content`),
`site_name`, `site_icon`, `date` (RFC 3339 UTC or null), `authority` (0–4, ≥3 = highly authoritative, -1 unknown).

Prefer `summary` over `snippet` when reasoning about a result. Weight `authority` and `rerank_score`
when sources conflict.

## deepseek_fetch → POST /v1/tools/fetch

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | HTTP(S), ≤8192 chars, must have a host, no credentials in the URL |

Returns `{ "title": string, "content": string }` where `content` is Markdown. Subject to the target
site's policy.

## Errors

OpenAI-compatible envelope: `{ "error": { "message", "type", "param": null, "code" } }`.

| Status | Meaning | Retry? |
|---|---|---|
| 400 | bad request/field | no — fix the request |
| 401 | bad key | no |
| 402 | insufficient balance | no — top up |
| 403 | blocked by security policy (fetch) | no |
| 404 | page unavailable / unextractable | no |
| 408 / 429 / 5xx | timeout, QPS, server error | yes, after a pause |

## Rate limits (per account, independent of model concurrency)

- Search: 100 QPS
- Fetch: 25 QPS, plus a per-domain limit

## Billing

Per **successful** request (HTTP 200 with results/content): $0.75 per 1,000 for both search and fetch.
`count` does not change the price. Failed requests, empty searches and timeouts are free. Usage is
logged to `~/.claude/mcp/deepseek-usage.jsonl` by the MCP server.
