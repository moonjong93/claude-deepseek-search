#!/usr/bin/env node
// DeepSeek search bridge for Claude Code (MCP stdio server, no dependencies).
//
// Tools
//   deepseek_search   — raw results from POST /v1/tools/search   ($0.75 / 1,000 successful)
//   deepseek_fetch    — page as Markdown from POST /v1/tools/fetch ($0.75 / 1,000 successful)
//   deepseek_research — synthesised, cited answer via the pi CLI (pi's deepseek_web_search
//                       extension; slower and pricier, for broad/multi-angle research)
//   brief_read / brief_append — shared .pi/bridge/brief.md so pi and Claude Code share context
//
// Auth: DEEPSEEK_API_KEY, else the key in ~/.pi/agent/auth.json (deepseek.key).
// Usage log: ~/.claude/mcp/deepseek-usage.jsonl (one JSON line per billable action).

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const API_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const AUTH_FILE = join(homedir(), '.pi/agent/auth.json')
const KEY_FILE = join(homedir(), '.claude/deepseek-api-key')
const USAGE_LOG = join(homedir(), '.claude/mcp/deepseek-usage.jsonl')
const PRICE_PER_CALL = 0.00075 // $0.75 / 1,000 successful search or fetch
const MAX_OUTPUT_CHARS = 50_000
const PI_TIMEOUT_MS = Number(process.env.DEEPSEEK_PI_TIMEOUT_MS || 240_000)

function apiKey() {
  const fromEnv = (process.env.DEEPSEEK_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  // pi's credential store, when pi is installed on this machine
  try {
    const parsed = JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
    const key = (parsed?.deepseek?.key || '').trim()
    if (key) return key
  } catch {}
  // standalone key file for machines without pi
  try {
    const key = readFileSync(KEY_FILE, 'utf8').trim()
    if (key) return key
  } catch {}
  throw new Error(
    'DeepSeek API key not found. Set DEEPSEEK_API_KEY, write ~/.claude/deepseek-api-key, or configure ~/.pi/agent/auth.json.',
  )
}

/** pi is only needed for deepseek_research; everything else works without it. */
function piBinary() {
  const configured = (process.env.PI_BIN || '').trim()
  if (configured) return configured
  const dirs = (process.env.PATH || '').split(':')
  for (const dir of dirs) {
    if (!dir) continue
    for (const name of ['pi', 'pi.js']) {
      const candidate = join(dir, name)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {}
    }
  }
  return null
}

function logUsage(entry) {
  try {
    mkdirSync(dirname(USAGE_LOG), { recursive: true })
    appendFileSync(USAGE_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
  } catch {}
}

function truncate(text, max = MAX_OUTPUT_CHARS) {
  if (typeof text !== 'string' || text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max)}\n\n...[truncated ${text.length - max} chars]`, truncated: true }
}

async function callApi(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const raw = await res.text()
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    json = undefined
  }
  if (!res.ok) {
    const message = json?.error?.message || raw.slice(0, 500) || `HTTP ${res.status}`
    const error = new Error(message)
    error.status = res.status
    throw error
  }
  return json
}

function formatSearch(query, json) {
  const results = Array.isArray(json?.results) ? json.results : []
  if (results.length === 0) return `No results for "${query}". Empty searches are not billed.`
  const lines = [`Query: ${query}`, `Results: ${results.length} (billed 1 search = $${PRICE_PER_CALL})`, '']
  results.forEach((item, i) => {
    const meta = [
      item.site_name,
      item.date ? String(item.date).slice(0, 10) : null,
      item.authority >= 0 ? `authority ${item.authority}` : null,
      typeof item.rerank_score === 'number' ? `score ${item.rerank_score}` : null,
    ].filter(Boolean)
    lines.push(`[${i + 1}] ${item.title || '(untitled)'}`)
    lines.push(`    ${item.url}`)
    if (meta.length) lines.push(`    ${meta.join(' · ')}`)
    if (item.summary) lines.push(`    ${item.summary}`)
    if (item.snippet && item.snippet !== item.summary) lines.push(`    > ${item.snippet}`)
    if (item.content) {
      const { text } = truncate(item.content, 2000)
      lines.push(`    ---\n${text.replace(/\n/g, '\n    ')}`)
    }
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

function briefPath() {
  return join(process.cwd(), '.pi/bridge/brief.md')
}

function runPi(question) {
  const prompt = [
    'You are a research worker. Use deepseek_web_search (one call, well-formed query) to answer.',
    'Then reply with ONLY the research answer: key facts, numbers, dates, and a "Sources:" list of the URLs you actually used.',
    'Do not ask questions and do not mention tools. Keep it under 400 words.',
    '',
    `Question: ${question}`,
  ].join('\n')

  return new Promise(resolve => {
    const binary = piBinary()
    if (!binary) {
      resolve({
        ok: false,
        error: 'pi CLI not found on PATH. deepseek_research needs pi (https://github.com/earendil-works/pi) plus the deepseek-web-search extension; use deepseek_search instead.',
      })
      return
    }
    // stdio[0] must be 'ignore': with a pipe pi waits for stdin EOF in print mode (child_process.execFile
    // ignores the stdio option, which is why the bridge uses spawn).
    const child = spawn(
      binary,
      ['-p', prompt, '--no-session', '--mode', 'json', '-t', 'deepseek_web_search'],
      { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `pi timed out after ${PI_TIMEOUT_MS}ms` })
    }, PI_TIMEOUT_MS)

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
    })
    child.on('error', error => finish({ ok: false, error: error.message }))
    child.on('close', code => {
      const events = []
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        try {
          events.push(JSON.parse(trimmed))
        } catch {}
      }
      let search = undefined
      let lastText = ''
      for (const event of events) {
        if (event.type === 'tool_execution_end' && event.toolName === 'deepseek_web_search') {
          const details = event.result?.details || {}
          search = { answer: details.answer || '', actions: details.searches || [], model: details.model, usage: details.usage }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          const text = (event.message.content || [])
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('')
          if (text.trim()) lastText = text
        }
      }
      if (!search && !lastText)
        return finish({ ok: false, error: `pi exited ${code} without output: ${stderr.slice(-800)}` })
      finish({ ok: true, search, summary: lastText, stderr })
    })
  })
}

async function callTool(name, args) {
  if (name === 'deepseek_search') {
    const query = String(args?.query || '').trim()
    if (!query) throw new Error('query is required')
    if (query.length > 128) throw new Error('query must be at most 128 characters')
    const count = Math.min(Math.max(Number(args?.count ?? 10) || 10, 1), 50)
    const json = await callApi('/v1/tools/search', {
      query,
      count,
      need_content: args?.need_content === true,
    })
    logUsage({ tool: 'search', query, results: json?.results?.length ?? 0, cost: PRICE_PER_CALL })
    return formatSearch(query, json)
  }

  if (name === 'deepseek_fetch') {
    const url = String(args?.url || '').trim()
    if (!url) throw new Error('url is required')
    const json = await callApi('/v1/tools/fetch', { url })
    logUsage({ tool: 'fetch', url, cost: PRICE_PER_CALL })
    const { text, truncated } = truncate(json?.content || '')
    return [`URL: ${url}`, `Title: ${json?.title || '(untitled)'}`, '', text, truncated ? '\n[content truncated]' : '']
      .join('\n')
      .trimEnd()
  }

  if (name === 'deepseek_research') {
    const question = String(args?.question || '').trim()
    if (!question) throw new Error('question is required')
    const startedAt = Date.now()
    const result = await runPi(question)
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10
    if (!result.ok) throw new Error(`pi research failed: ${result.error}`)

    const answer = result.search?.answer?.trim() || result.summary.trim()
    const actions = result.search?.actions || []
    const searches = actions.filter(a => a.type === 'search').length
    const fetches = actions.length - searches
    const sourceLine = actions
      .filter(a => a.url)
      .map(a => `- ${a.url}`)
      .join('\n')
    const sources = sourceLine || (actions[0]?.queries || []).map(q => `- searched: ${q}`).join('\n')

    logUsage({
      tool: 'research',
      question,
      model: result.search?.model,
      searches,
      fetches,
      seconds,
      cost: (searches + fetches) * PRICE_PER_CALL,
      usage: result.search?.usage,
    })

    return [
      answer,
      '',
      `Research trail (${seconds}s, model ${result.search?.model || 'n/a'}):`,
      sources || '- none',
      searches || fetches ? `\nBilled: ${searches} search + ${fetches} fetch ≈ $${((searches + fetches) * PRICE_PER_CALL).toFixed(5)}` : '',
    ]
      .join('\n')
      .trimEnd()
  }

  if (name === 'brief_read') {
    const path = briefPath()
    if (!existsSync(path)) return `No brief yet at ${path}.`
    const content = readFileSync(path, 'utf8')
    const { text } = truncate(content, 20_000)
    return `${path}\n\n${text}`
  }

  if (name === 'brief_append') {
    const section = String(args?.section || 'note').trim() || 'note'
    const content = String(args?.content || '').trim()
    if (!content) throw new Error('content is required')
    const path = briefPath()
    mkdirSync(dirname(path), { recursive: true })
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const header = existsSync(path) && statSync(path).size > 0 ? '' : '# Shared brief (pi ↔ Claude Code)\n'
    appendFileSync(path, `${header}\n## ${section} — ${stamp}\n${content}\n`)
    return `Appended to ${path}`
  }

  throw new Error(`Unknown tool: ${name}`)
}

const TOOLS = [
  {
    name: 'deepseek_search',
    description:
      'Search the web with the DeepSeek search engine and return raw ranked results (title, URL, summary, optional page content). Fast (~0.5-2s) and cheap ($0.75 per 1,000 searches). Supports query operators: site:, -site:, -, "", lang:, after:, before:. Use this for normal lookups; use deepseek_research when the scope is broad or needs synthesis across many sources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, 1-128 characters. Operators allowed.' },
        count: { type: 'integer', minimum: 1, maximum: 50, description: 'Number of results (default 10). Does not change the price.' },
        need_content: { type: 'boolean', description: 'Also return extracted page content (larger, slower). Default false.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'deepseek_fetch',
    description:
      'Fetch a single web page and return it as Markdown. $0.75 per 1,000 fetches. Use after deepseek_search to read a specific result in full.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'HTTP(S) URL, max 8192 chars.' } },
      required: ['url'],
    },
  },
  {
    name: 'deepseek_research',
    description:
      'Run a broad research question through the pi CLI, whose DeepSeek extension performs multi-step server-side search, opens pages and synthesises a cited answer. Slower (10-60s) and pricier than deepseek_search. Use when the scope is wide, sources must be cross-checked, or the user wants a researched answer rather than a link list. Requires pi to be installed; if it is missing this tool reports an error and you should use deepseek_search instead.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The research question, with scope and any constraints.' } },
      required: ['question'],
    },
  },
  {
    name: 'brief_read',
    description: 'Read the shared brief at <project>/.pi/bridge/brief.md, the hand-off file between pi and Claude Code.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'brief_append',
    description: 'Append a timestamped entry to <project>/.pi/bridge/brief.md so the other agent (pi) can pick up your findings.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Short heading, e.g. "findings", "next steps", "open questions".' },
        content: { type: 'string', description: 'Markdown content to append.' },
      },
      required: ['content'],
    },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

let buffer = ''
process.stdin.setEncoding('utf8')
// Exit when the client closes the pipe, so one-shot probes and `node server.mjs < requests.jsonl` terminate.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('data', chunk => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    newline = buffer.indexOf('\n')
    if (line) handle(line)
  }
})

async function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return replyError(null, -32700, 'Parse error')
  }
  const { id, method, params } = message
  const isNotification = id === undefined || id === null

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'deepseek-search', version: '1.0.0' },
    })
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: TOOLS })
  if (method === 'tools/call') {
    const name = params?.name
    try {
      const text = await callTool(name, params?.arguments || {})
      return reply(id, { content: [{ type: 'text', text }] })
    } catch (error) {
      const text = error?.status ? `${error.message} (HTTP ${error.status})` : error?.message || String(error)
      return reply(id, { content: [{ type: 'text', text }], isError: true })
    }
  }
  if (method === 'resources/list') return reply(id, { resources: [] })
  if (method === 'prompts/list') return reply(id, { prompts: [] })
  if (isNotification) return
  return replyError(id, -32601, `Method not found: ${method}`)
}

process.on('uncaughtException', error => {
  process.stderr.write(`deepseek-search fatal: ${error?.stack || error}\n`)
})
process.on('unhandledRejection', error => {
  process.stderr.write(`deepseek-search unhandled: ${error?.stack || error}\n`)
})
