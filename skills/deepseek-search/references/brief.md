# Shared brief — handing work between pi and Claude Code

Both agents read and write one file: `<project>/.pi/bridge/brief.md`.

- **Claude Code** uses the `brief_read` / `brief_append` MCP tools.
- **pi** uses its normal `read` / `edit` / `write` tools on the same path.

## Format

```markdown
# Shared brief (pi ↔ Claude Code)

## findings — 2026-11-14 11:58
- current DeepSeek search price: $0.75 / 1,000 successful requests
- peak hours: weekdays 01:00–04:00, 06:00–10:00 UTC
```

`brief_append` writes the `## <section> — <timestamp>` heading for you. Keep sections short and
factual; the other agent pays context for every line it reads.

## Conventions

| Section | Written by | Use |
|---|---|---|
| `findings` | either | verified facts with sources, so the other agent does not re-search |
| `next steps` | either | what the other agent should do next, with file paths |
| `open questions` | either | blocking unknowns and what would resolve them |

## When to use it

- The user switches between pi and Claude Code in the same task.
- A research result should survive the end of this conversation.
- You need pi to run something long (a full research pass) while you keep working: append a
  `next steps` entry instead of blocking on it.

Do not use the brief as scratch space for reasoning or as a copy of the conversation; it is a
hand-off channel, not a transcript.
