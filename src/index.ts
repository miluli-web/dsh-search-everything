// dsh-search-everything — DeepSeek Harness (Cordis) plugin. Adapted from
// dsh-all-search for dsh 0.2.2-rc.1; dist/index.js is the runtime build.
//
// Registers one WebSearchProvider (id search-everything) and optional WebFetchProviders
// with ctx.web. AnySearch is a MCP gateway that aggregates exa / tavily /
// firecrawl / context7 behind one API key. When that key is set, queries stay
// on the gateway (developer-intent queries may try the Firecrawl Developer
// Index first). When the AnySearch key is absent, the same wrapper stays
// available and searches via Firecrawl POST /v1/search — no Authorization
// header unless firecrawl_api_key is set (then Bearer, own quota).
//
// DeepSeek Search/Fetch (DEEPSEEK_API_KEY / deepseek_api_key) compete inside
// the same wrapper — never as a second registered search provider, because
// dsh-web errors on WEB_PROVIDER_AMBIGUOUS. Harness already exposes DeepSeek
// search server-side; this path keeps all-search consistent with pi-all-search.
//
// The dsh-web seam errors on multiple usable providers
// (WEB_PROVIDER_AMBIGUOUS) unless one is configured explicitly, so this plugin
// registers exactly one search provider (the anysearch wrapper). TinyFish and
// DeepSeek compete inside it. Fetch registers only when explicitly enabled
// (tinyfish_fetch / deepseek_fetch), because the host already supplies a local
// fetch provider.
//
// Privacy: API keys live in the plugin config only; they are never logged.

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

export const name = 'search-everything'
export const inject = ['web']

export interface Config {
  /** AnySearch API key. When set, queries use the AnySearch gateway. */
  api_key?: string
  /** AnySearch MCP endpoint override. */
  base_url?: string
  /** Firecrawl API key — Bearer quota for /v1/search; also enables Developer Index when AnySearch is configured. */
  firecrawl_api_key?: string
  /** TinyFish API key — enables TinyFish search and the full-browser fetch provider. */
  tinyfish_api_key?: string
  /**
   * Register TinyFish as the fetch provider. Off by default: the host may
   * already provide a local fetch provider, and two usable fetch providers
   * raise WEB_PROVIDER_AMBIGUOUS. Enable when the host has no fetch provider
   * or when `fetchProvider` is pinned to `tinyfish`.
   */
  tinyfish_fetch?: boolean
  /** DeepSeek API key — enables DeepSeek Search inside the anysearch wrapper. */
  deepseek_api_key?: string
  /**
   * Register DeepSeek as a fetch provider. Off by default for the same reason
   * as `tinyfish_fetch` — the host usually already supplies a local fetch.
   * Enable when you want DeepSeek tools/fetch (same key as search).
   */
  deepseek_fetch?: boolean
}

export const Config: z<Config> = z.object({
  api_key: z.string().description('AnySearch API key (optional — without it, Firecrawl keyless search is used)'),
  base_url: z.string().description('AnySearch MCP endpoint override (default https://api.anysearch.com/mcp)'),
  firecrawl_api_key: z.string().description('Firecrawl API key (optional) — Bearer for Firecrawl quota; also enables Developer Index when AnySearch is configured'),
  tinyfish_api_key: z.string().description('TinyFish API key (optional) — enables TinyFish search and full-browser fetch'),
  tinyfish_fetch: z.boolean().description('Register TinyFish as the fetch provider (default false — the host usually supplies a local fetch provider)'),
  deepseek_api_key: z.string().description('DeepSeek API key (optional) — enables DeepSeek Search inside the anysearch wrapper'),
  deepseek_fetch: z.boolean().description('Register DeepSeek as a fetch provider (default false — the host usually supplies a local fetch provider)'),
})

const DEFAULT_BASE_URL = 'https://api.anysearch.com/mcp'
export const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v1/search'
export const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai'
export const TINYFISH_FETCH_URL = 'https://api.fetch.tinyfish.ai'
export const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'
export const DEEPSEEK_FETCH_URL = 'https://api.deepseek.com/v1/tools/fetch'
const DEVELOPER_QUERY_RE =
  /\b(repo|repos|repository|repositories|github|issue|issues|pull request|pull requests|commit|commits|branch|merge|openapi|readme|skill|skills|library|framework)\b/i
const NEWS_QUERY_RE =
  /\b(news|latest|today|breaking|announced|announcement|update|released|release|happened|current|recent)\b/i
const ACADEMIC_QUERY_RE =
  /\b(paper|papers|research|journal|doi|arxiv|scholar|academic|study|thesis|citation|citations)\b/i

export function isDeveloperQuery(query: string): boolean {
  return DEVELOPER_QUERY_RE.test(query)
}

export function isNewsQuery(query: string): boolean {
  return NEWS_QUERY_RE.test(query)
}

export function isAcademicQuery(query: string): boolean {
  return ACADEMIC_QUERY_RE.test(query)
}

export class AnysearchProvider implements WebSearchProvider {
  readonly id = 'search-everything'
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  /** Cheap local check — no network. */
  available(): boolean {
    return Boolean(this.apiKey)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const resp = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: request.query, max_results: request.maxResults ?? 5 } },
      }),
    })
    if (!resp.ok) throw new Error(`AnySearch HTTP ${resp.status}`)
    const data = (await resp.json()) as {
      result?: { content?: Array<{ text?: string }> }
    }
    const text = data.result?.content?.[0]?.text ?? ''
    const sources = this.parseResults(text)
    const truncated = request.maxResults !== undefined && sources.length > request.maxResults
    return {
      sources: truncated ? sources.slice(0, request.maxResults) : sources,
      truncated,
    }
  }

  /** Parse the gateway's markdown answer, with a JSON fallback for schema drift. */
  private parseResults(text: string): WebSearchSource[] {
    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown> | Array<Record<string, unknown>>
        const list = Array.isArray(parsed)
          ? parsed
          : ((parsed.results ?? parsed.data ?? parsed.items ?? []) as Array<Record<string, unknown>>)
        if (Array.isArray(list) && list.length > 0) {
          const mapped = list
            .map((r) => ({
              url: String(r.url ?? r.link ?? r.href ?? ''),
              title: String(r.title ?? r.name ?? r.headline ?? ''),
              snippet: String(r.snippet ?? r.description ?? r.summary ?? r.content ?? '').slice(0, 300),
            }))
            .filter((r) => r.url)
          if (mapped.length > 0) return mapped
        }
      } catch {
        // fall through to the markdown parser
      }
    }
    const results: WebSearchSource[] = []
    const sections = trimmed.split(/^### \d+\. /m).slice(1)
    for (const section of sections) {
      const lines = section.trim().split('\n')
      const title = lines[0]?.trim() ?? ''
      const urlLine = lines.find((l) => l.startsWith('- **URL**:'))
      const url = urlLine?.replace('- **URL**: ', '').replace(/\*\*/g, '').trim() ?? ''
      const snippet = lines
        .filter((l) => !l.startsWith('- **URL**:') && l.trim() && !l.startsWith('#'))
        .join(' ')
        .slice(0, 300)
      if (title && url) results.push({ url, title, snippet })
    }
    return results
  }
}

/** Firecrawl general web search. Works keyless; Bearer only when an API key is provided. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = 'firecrawl'
  constructor(private readonly apiKey?: string) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    const resp = await fetch(FIRECRAWL_SEARCH_URL, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ query: request.query, limit: request.maxResults ?? 5 }),
    })
    if (!resp.ok) throw new Error(`Firecrawl HTTP ${resp.status}`)
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> }
    const sources: WebSearchSource[] = (data.data ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    }))
    const truncated = request.maxResults !== undefined && sources.length > request.maxResults
    return {
      sources: truncated ? sources.slice(0, request.maxResults) : sources,
      truncated,
    }
  }
}

export class FirecrawlDevProvider implements WebSearchProvider {
  readonly id = 'firecrawl-dev'
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return Boolean(this.apiKey)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const resp = await fetch('https://api.firecrawl.dev/v2/search/developer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({ query: request.query, limit: request.maxResults ?? 5 }),
    })
    if (!resp.ok) throw new Error(`Firecrawl Developer Index HTTP ${resp.status}`)
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> }
    const sources: WebSearchSource[] = (data.data ?? []).map((r: any) => ({
      title: r.title ?? r.id ?? '',
      url: r.url ?? '',
      snippet:
        r.description ??
        (Array.isArray(r.passages) ? r.passages.slice(0, 3).join(' ') : '') ??
        '',
    }))
    const truncated = request.maxResults !== undefined && sources.length > request.maxResults
    return {
      sources: truncated ? sources.slice(0, request.maxResults) : sources,
      truncated,
    }
  }
}

/** TinyFish search — free structured results, with news and academic modes. */
export class TinyFishSearchProvider implements WebSearchProvider {
  readonly id = 'tinyfish'
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return Boolean(this.apiKey)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const params = new URLSearchParams({ query: request.query })
    if (isNewsQuery(request.query)) params.set('domain_type', 'news')
    else if (isAcademicQuery(request.query)) params.set('domain_type', 'research_paper')

    const resp = await fetch(`${TINYFISH_SEARCH_URL}?${params.toString()}`, {
      headers: { 'X-API-Key': this.apiKey },
      signal,
    })
    if (!resp.ok) throw new Error(`TinyFish search HTTP ${resp.status}`)
    const data = (await resp.json()) as { results?: Array<Record<string, unknown>> }
    const sources: WebSearchSource[] = (data.results ?? []).map((r: any) => ({
      url: r.url ?? '',
      title: r.title ?? '',
      snippet: r.snippet ?? '',
      ...(r.date ? { publishedAt: String(r.date) } : {}),
    }))
    const truncated = request.maxResults !== undefined && sources.length > request.maxResults
    return { sources: truncated ? sources.slice(0, request.maxResults) : sources, truncated }
  }
}

/**
 * TinyFish fetch — full-browser rendering and clean extraction.
 *
 * The seam's fetch result carries only url/statusCode/body, so a per-URL
 * failure is surfaced as a non-2xx status with the error text as the body.
 */
export class TinyFishFetchProvider implements WebFetchProvider {
  readonly id = 'tinyfish'
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return Boolean(this.apiKey)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const resp = await fetch(TINYFISH_FETCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      signal,
      body: JSON.stringify({ urls: [request.url], format: 'markdown', per_url_timeout_ms: 45000 }),
    })
    if (!resp.ok) throw new Error(`TinyFish fetch HTTP ${resp.status}`)
    const data = (await resp.json()) as {
      results?: Array<{ url: string; final_url?: string; text?: string | null }>
      errors?: Array<{ url: string; error: string }>
    }
    const page = data.results?.find((r) => r.text)
    if (page?.text !== undefined && page.text !== null) {
      return {
        url: page.final_url ?? page.url,
        statusCode: 200,
        body: { kind: 'text', content: page.text },
        truncated: false,
      }
    }
    const failure = data.errors?.[0]
    return {
      url: failure?.url ?? request.url,
      statusCode: 502,
      body: { kind: 'text', content: failure?.error ?? 'TinyFish fetch returned no content' },
      truncated: false,
    }
  }
}


/** DeepSeek Search — self-hosted search API (same Bearer key as chat). */
export class DeepSeekSearchProvider implements WebSearchProvider {
  readonly id = 'deepseek'
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return Boolean(this.apiKey)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const count = Math.min(Math.max(request.maxResults ?? 5, 1), 50)
    const resp = await fetch(DEEPSEEK_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({ query: request.query, count, need_content: false }),
    })
    if (!resp.ok) throw new Error(`DeepSeek search HTTP ${resp.status}`)
    const data = (await resp.json()) as {
      results?: Array<{
        title?: string
        url?: string
        snippet?: string
        summary?: string
        date?: string | null
        rerank_score?: number
      }>
    }
    const sources: WebSearchSource[] = (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.summary || r.snippet || '').trim(),
      ...(r.date ? { publishedAt: String(r.date) } : {}),
    }))
    const truncated = request.maxResults !== undefined && sources.length > request.maxResults
    return {
      sources: truncated ? sources.slice(0, request.maxResults) : sources,
      truncated,
    }
  }
}

/**
 * DeepSeek fetch — single-URL markdown extraction via tools/fetch.
 * Opt-in via `deepseek_fetch` so the host local fetch stays the default.
 */
export class DeepSeekFetchProvider implements WebFetchProvider {
  readonly id = 'deepseek'
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return Boolean(this.apiKey)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const resp = await fetch(DEEPSEEK_FETCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({ url: request.url }),
    })
    if (!resp.ok) {
      return {
        url: request.url,
        statusCode: resp.status,
        body: { kind: 'text', content: `DeepSeek fetch HTTP ${resp.status}` },
        truncated: false,
      }
    }
    const data = (await resp.json()) as { title?: string; content?: string }
    const content = (data.content ?? '').trim()
    if (!content) {
      return {
        url: request.url,
        statusCode: 404,
        body: { kind: 'text', content: 'DeepSeek fetch returned no content' },
        truncated: false,
      }
    }
    const body = data.title ? `# ${data.title}\n\n${content}` : content
    return {
      url: request.url,
      statusCode: 200,
      body: { kind: 'text', content: body },
      truncated: false,
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  const anysearch = new AnysearchProvider(config.api_key ?? '', config.base_url ?? DEFAULT_BASE_URL)
  const firecrawl = new FirecrawlSearchProvider(config.firecrawl_api_key)
  const devIndex = config.firecrawl_api_key ? new FirecrawlDevProvider(config.firecrawl_api_key) : null
  const tinyfish = config.tinyfish_api_key ? new TinyFishSearchProvider(config.tinyfish_api_key) : null
  const deepseek = config.deepseek_api_key ? new DeepSeekSearchProvider(config.deepseek_api_key) : null

  // Single provider to avoid dsh-web's WEB_PROVIDER_AMBIGUOUS on multiple
  // usable providers. Priority: Dev Index (developer queries) → TinyFish
  // (news/academic) → DeepSeek → AnySearch gateway → TinyFish → Firecrawl.
  const wrapper: WebSearchProvider = {
    id: 'search-everything',
    available: () =>
      Boolean(config.api_key) ||
      Boolean(config.tinyfish_api_key) ||
      Boolean(config.deepseek_api_key) ||
      firecrawl.available(),
    async search(request, signal) {
      if (devIndex && isDeveloperQuery(request.query)) {
        try {
          const dev = await devIndex.search(request, signal)
          if (dev.sources.length > 0) return dev
        } catch {
          // fall through to the next provider
        }
      }
      if (tinyfish && (isNewsQuery(request.query) || isAcademicQuery(request.query))) {
        try {
          const tf = await tinyfish.search(request, signal)
          if (tf.sources.length > 0) return tf
        } catch {
          // fall through to the next provider
        }
      }
      if (deepseek) {
        try {
          const ds = await deepseek.search(request, signal)
          if (ds.sources.length > 0) return ds
        } catch {
          // fall through to the next provider
        }
      }
      if (config.api_key) {
        return anysearch.search(request, signal)
      }
      if (tinyfish) {
        try {
          const tf = await tinyfish.search(request, signal)
          if (tf.sources.length > 0) return tf
        } catch {
          // fall through to Firecrawl
        }
      }
      return firecrawl.search(request, signal)
    },
  }
  ctx.web.registerSearchProvider(wrapper)

  if (config.tinyfish_fetch && config.tinyfish_api_key && typeof ctx.web.registerFetchProvider === 'function') {
    ctx.web.registerFetchProvider(new TinyFishFetchProvider(config.tinyfish_api_key))
  }
  if (config.deepseek_fetch && config.deepseek_api_key && typeof ctx.web.registerFetchProvider === 'function') {
    ctx.web.registerFetchProvider(new DeepSeekFetchProvider(config.deepseek_api_key))
  }
}
