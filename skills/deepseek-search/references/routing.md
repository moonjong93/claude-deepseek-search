# Routing and cost model

## Decision flow

```
Does the task need web data at all?
├─ no  → answer from context/code; do not search (searches are billed)
└─ yes
   ├─ Is it one fact, one page, one release note, one price?
   │     → deepseek_search (1 call), maybe + deepseek_fetch (1 URL)
   ├─ Is it "read this URL the user gave me"?
   │     → deepseek_fetch
   └─ Is the scope broad / comparative / multi-source / needs a narrative?
         → deepseek_research  (pi runs multi-step search + page reads + synthesis)
```

## Cost (official, 2026)

| Item | Price | Billed when |
|---|---|---|
| Search | $0.75 / 1,000 | HTTP 200 with a non-empty `results` array |
| Fetch | $0.75 / 1,000 | HTTP 200 with page content |
| `deepseek_research` | searches+fetches × $0.00075 + pi's tokens | per call, typically 2–5 searches + 3–10 fetches |

Measured on this setup:

- `deepseek_search` with `count: 3` → **$0.00075**
- `deepseek_fetch` → **$0.00075**
- `deepseek_research`, pricing question → 56 s, 3 searches + 9 fetches ≈ **$0.009**

Token cost of `deepseek_research` uses pi's `deepseek-flash` rates: $0.15 per 1M input (cache miss), $0.003 cache hit, $0.60 output, off-peak. Peak (weekdays 01:00–04:00 and 06:00–10:00 UTC) doubles token prices; per-search fees do not change.

## When not to use these tools

- The answer is in the repository, in the conversation, or in the user's pasted text.
- The user asked a stable, well-known fact (arithmetic, standard library API, language syntax).
- The user gave you the page content already — summarize it directly.

## Cheaper than the alternative

Claude Code's built-in `WebSearch` consumes no DeepSeek quota but is not controllable and cannot hand off to pi. Both can coexist: this skill applies when live web data is needed and the task also touches the pi-side workflow, or when the user asks for DeepSeek/pi search explicitly.
