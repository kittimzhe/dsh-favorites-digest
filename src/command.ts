/**
 * `/favorites` command grammar and execution.
 *
 *   /favorites [login|collect|digest|run]
 *              [--platform all|douyin|xiaohongshu]
 *              [--limit N] [--likes] [--cdp-url <url>] [--no-llm]
 *              [--out <dir>] [--input <json>]
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { openSession } from './browser.ts'
import { looksLoggedInDouyin, DOUYIN_HOME } from './collectors/douyin.ts'
import { createPlaywrightEngine, type CollectEngine } from './collectors/run.ts'
import { looksLoggedInXiaohongshu, XHS_HOME } from './collectors/xiaohongshu.ts'
import { findLatestJson, writeArtifacts } from './export.ts'
import { emptyItem, type CollectionResult, type FavoriteItem, type Platform } from './models.ts'
import { maybeSummarize, type SummarizeConfig } from './summarize.ts'

export const USAGE =
  'Usage: /favorites [login|collect|digest|run] [--platform all|douyin|xiaohongshu] [--limit N] [--likes] [--cdp-url <url>] [--no-llm] [--out <dir>] [--input <json>]'

export type FavoritesAction = 'login' | 'collect' | 'digest' | 'run'

export interface FavoritesArgs {
  readonly action: FavoritesAction
  readonly platform: 'all' | Platform
  readonly limit?: number
  readonly likes: boolean
  readonly cdpUrl?: string
  readonly noLlm: boolean
  readonly outDir?: string
  readonly input?: string
}

export interface FavoritesConfig extends SummarizeConfig {
  readonly defaultDir?: string
  readonly profileDir?: string
  readonly cdpUrl?: string
  readonly headless?: boolean
  readonly includeLikes?: boolean
  readonly limit?: number
  readonly loginTimeoutMs?: number
  readonly exposeTool?: boolean
  readonly collect?: CollectEngine
}

export function parseFavoritesArgs(rawInput: string): FavoritesArgs | string {
  const trimmed = rawInput.trim()
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/u)
  const args: {
    action: FavoritesAction
    platform: 'all' | Platform
    limit?: number
    likes: boolean
    cdpUrl?: string
    noLlm: boolean
    outDir?: string
    input?: string
  } = { action: 'run', platform: 'all', likes: false, noLlm: false }
  let i = 0
  if (tokens[0] === 'login' || tokens[0] === 'collect' || tokens[0] === 'digest' || tokens[0] === 'run') {
    args.action = tokens[0]
    i = 1
  }
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === undefined) break
    if (token === '--platform') {
      const value = tokens[i + 1]
      if (value !== 'all' && value !== 'douyin' && value !== 'xiaohongshu') {
        return `--platform requires all, douyin, or xiaohongshu.\n${USAGE}`
      }
      args.platform = value
      i += 2
      continue
    }
    if (token === '--limit') {
      const value = tokens[i + 1]
      const n = Number(value)
      if (value === undefined || !Number.isInteger(n) || n <= 0) return `--limit requires a positive integer.\n${USAGE}`
      args.limit = n
      i += 2
      continue
    }
    if (token === '--likes') {
      args.likes = true
      i += 1
      continue
    }
    if (token === '--no-llm') {
      args.noLlm = true
      i += 1
      continue
    }
    if (token === '--cdp-url') {
      const value = tokens[i + 1]
      if (value === undefined || value.startsWith('--')) return `--cdp-url requires a URL.\n${USAGE}`
      args.cdpUrl = value
      i += 2
      continue
    }
    if (token === '--out') {
      const value = tokens[i + 1]
      if (value === undefined || value.startsWith('--')) return `--out requires a directory.\n${USAGE}`
      args.outDir = value
      i += 2
      continue
    }
    if (token === '--input') {
      const value = tokens[i + 1]
      if (value === undefined || value.startsWith('--')) return `--input requires a JSON path.\n${USAGE}`
      args.input = value
      i += 2
      continue
    }
    return `Unknown option: ${token}\n${USAGE}`
  }
  return args
}

function platformsOf(name: 'all' | Platform): Platform[] {
  return name === 'all' ? ['xiaohongshu', 'douyin'] : [name]
}

/**
 * Runtime slice used to resolve the session cwd; absent in profiles that do
 * not mount the sessionQuery service (the output dir then falls back to
 * process.cwd()).
 */
export interface SessionLogLookup {
  sessionQuery?: {
    readSession(sessionId: string): Promise<{ session?: { cwd?: string } }>
  }
}

async function resolveSessionCwd(ctx: SessionLogLookup | undefined, sessionId: string): Promise<string | undefined> {
  if (ctx?.sessionQuery == null) return undefined
  try {
    const log = await ctx.sessionQuery.readSession(sessionId)
    const cwd = log?.session?.cwd
    return cwd !== undefined && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

function outputDir(cwd: string | undefined, config: FavoritesConfig | undefined, args: FavoritesArgs): string {
  if (args.outDir !== undefined) return args.outDir
  if (config?.defaultDir !== undefined) return config.defaultDir
  return join(cwd ?? process.cwd(), 'dsh-favorites')
}

export function parseStoredResults(payload: unknown): CollectionResult[] | string {
  if (payload === null || typeof payload !== 'object' || !('platforms' in payload)) return 'JSON 缺少 platforms 字段。'
  const platforms = (payload as { platforms: unknown }).platforms
  if (!Array.isArray(platforms)) return 'JSON platforms 必须是数组。'
  const results: CollectionResult[] = []
  for (const block of platforms) {
    if (block === null || typeof block !== 'object') continue
    const rec = block as Record<string, unknown>
    const platform = rec.platform === 'douyin' || rec.platform === 'xiaohongshu' ? rec.platform : undefined
    if (platform === undefined) continue
    const items: FavoriteItem[] = []
    if (Array.isArray(rec.items)) {
      for (const item of rec.items) {
        if (item === null || typeof item !== 'object') continue
        const row = item as Record<string, unknown>
        if (typeof row.item_id !== 'string' || typeof row.title !== 'string' || typeof row.url !== 'string') continue
        items.push(
          emptyItem({
            platform: row.platform === 'douyin' || row.platform === 'xiaohongshu' ? row.platform : platform,
            item_id: row.item_id,
            title: row.title,
            url: row.url,
            author: typeof row.author === 'string' ? row.author : '',
            kind: typeof row.kind === 'string' ? row.kind : '',
            cover: typeof row.cover === 'string' ? row.cover : '',
            tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
            extra: row.extra !== null && typeof row.extra === 'object' ? (row.extra as Record<string, unknown>) : {},
          }),
        )
      }
    }
    results.push({
      platform,
      collected_at: typeof rec.collected_at === 'string' ? rec.collected_at : '',
      items,
      warnings: Array.isArray(rec.warnings) ? rec.warnings.filter((w): w is string => typeof w === 'string') : [],
      source: typeof rec.source === 'string' ? rec.source : 'json',
    })
  }
  return results
}

function formatCollectText(results: readonly CollectionResult[], written: string[]): string {
  const lines = results.map((result) => {
    const name = result.platform === 'xiaohongshu' ? '小红书' : '抖音'
    const warns = result.warnings.length === 0 ? '' : `\n  ! ${result.warnings.join('\n  ! ')}`
    return `- ${name}: ${result.items.length} 条${warns}`
  })
  return `已导出 ${results.reduce((n, r) => n + r.items.length, 0)} 条收藏 → ${written.join(', ')}\n${lines.join('\n')}`
}

async function executeLogin(args: FavoritesArgs, config: FavoritesConfig | undefined): Promise<CommandResult> {
  const timeout = config?.loginTimeoutMs ?? 300_000
  const session = await openSession({
    cdpUrl: args.cdpUrl ?? config?.cdpUrl,
    profileDir: config?.profileDir,
    headless: config?.headless === true,
  })
  try {
    const wanted = platformsOf(args.platform)
    const page = session.page()
    if (wanted.includes('xiaohongshu')) await page.goto(XHS_HOME, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    if (wanted.includes('douyin')) {
      const dy = wanted.includes('xiaohongshu') ? await session.context.newPage() : page
      await dy.goto(DOUYIN_HOME, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    }
    const deadline = Date.now() + timeout
    let xhsOk = !wanted.includes('xiaohongshu')
    let dyOk = !wanted.includes('douyin')
    while (Date.now() < deadline && (!xhsOk || !dyOk)) {
      for (const p of session.context.pages()) {
        if (!xhsOk && p.url().includes('xiaohongshu.com')) xhsOk = await looksLoggedInXiaohongshu(p)
        if (!dyOk && p.url().includes('douyin.com')) dyOk = await looksLoggedInDouyin(p)
      }
      if (xhsOk && dyOk) break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const profile = config?.profileDir ?? join(homedir(), '.dsh', 'favorites-digest', 'profile')
    if (xhsOk && dyOk) {
      return { kind: 'success', text: `登录成功。会话保存在 ${session.cdp ? args.cdpUrl ?? config?.cdpUrl ?? 'CDP Chrome' : profile}` }
    }
    return {
      kind: 'error',
      text: `登录未完成（小红书 ${xhsOk ? '已登录' : '未登录'}，抖音 ${dyOk ? '已登录' : '未登录'}）。请在弹出的浏览器里扫码后重试 /favorites login。`,
    }
  } finally {
    await session.close()
  }
}

async function executeDigestFromResults(
  results: readonly CollectionResult[],
  dir: string,
  withLlm: boolean,
  config: FavoritesConfig | undefined,
): Promise<CommandResult> {
  const digest = withLlm ? await maybeSummarize(results, config) : undefined
  const written = await writeArtifacts(dir, results, digest)
  return { kind: 'success', text: formatCollectText(results, [written.jsonPath, written.mdPath]) }
}

export async function executeFavorites(
  invocation: CommandInvocation,
  config?: FavoritesConfig,
  ctx?: SessionLogLookup,
): Promise<CommandResult> {
  const parsed = parseFavoritesArgs(invocation.rawInput)
  if (typeof parsed === 'string') return { kind: 'error', text: parsed }
  const cwd = await resolveSessionCwd(ctx, String(invocation.agent.id))
  const dir = outputDir(cwd, config, parsed)
  const engine = config?.collect ?? createPlaywrightEngine()

  if (parsed.action === 'login') return executeLogin(parsed, config)

  if (parsed.action === 'digest') {
    const path = parsed.input ?? (await findLatestJson(dir))
    if (path === undefined) return { kind: 'error', text: `找不到收藏 JSON，请先运行 /favorites collect 或 /favorites。目录：${dir}` }
    let payload: unknown
    try {
      payload = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      return { kind: 'error', text: `无法读取 ${path}: ${error instanceof Error ? error.message : String(error)}` }
    }
    const results = parseStoredResults(payload)
    if (typeof results === 'string') return { kind: 'error', text: results }
    return executeDigestFromResults(results, dir, !parsed.noLlm, config)
  }

  let results: CollectionResult[]
  try {
    results = await engine.collect({
      platforms: platformsOf(parsed.platform),
      limit: parsed.limit ?? config?.limit,
      includeLikes: parsed.likes || config?.includeLikes === true,
      cdpUrl: parsed.cdpUrl ?? config?.cdpUrl,
      profileDir: config?.profileDir,
      headless: config?.headless,
    })
  } catch (error) {
    return { kind: 'error', text: `抓取失败：${error instanceof Error ? error.message : String(error)}` }
  }

  if (parsed.action === 'collect') {
    const written = await writeArtifacts(dir, results)
    return { kind: 'success', text: formatCollectText(results, [written.jsonPath, written.mdPath]) }
  }

  return executeDigestFromResults(results, dir, !parsed.noLlm, config)
}
