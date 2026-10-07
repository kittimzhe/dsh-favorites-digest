import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { createPlaywrightEngine } from './collectors/run.ts'
import { writeArtifacts } from './export.ts'
import type { FavoritesConfig } from './command.ts'
import { maybeSummarize } from './summarize.ts'
import type { Platform } from './models.ts'

export const FAVORITES_TOOL_DESCRIPTION = [
  'Export the user\'s own Douyin and Xiaohongshu web favorites (using the logged-in browser profile) into Markdown and JSON on disk, with optional topic grouping and LLM digest.',
  'Use when the user asks to dump, summarize, or digest their 收藏 / 喜欢 from 抖音 or 小红书.',
  'Requires a prior /favorites login (or an attached Chrome via cdpUrl). Does not access anyone else\'s account.',
].join(' ')

export interface FavoritesToolResult {
  platforms: string[]
  xiaohongshu: number
  douyin: number
  written: string[]
  warnings: string[]
  error: string | null
}

function fail(message: string): FavoritesToolResult {
  return { platforms: [], xiaohongshu: 0, douyin: 0, written: [], warnings: [], error: message }
}

function renderResultText(result: FavoritesToolResult): string {
  if (result.error !== null) return `favorites_digest failed: ${result.error}`
  const warn = result.warnings.length === 0 ? '' : ` warnings: ${result.warnings.join('; ')}`
  return `Exported xiaohongshu=${result.xiaohongshu}, douyin=${result.douyin} → ${result.written.join(', ')}${warn}`
}

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    platforms: { type: 'array', items: { type: 'string' } },
    xiaohongshu: { type: 'integer' },
    douyin: { type: 'integer' },
    written: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    error: nullableString,
  },
} as const

export function createFavoritesTool(config?: FavoritesConfig): ToolDefinition {
  return defineTool({
    name: 'favorites_digest',
    description: FAVORITES_TOOL_DESCRIPTION,
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    parameters: {
      platform: { type: 'string', description: "Which site: 'all' (default), 'douyin', or 'xiaohongshu'." },
      limit: { type: 'integer', description: 'Max items per platform (omit for as many as the page loads).' },
      likes: { type: 'boolean', description: 'Also export Douyin 喜欢, not only 收藏.' },
      no_llm: { type: 'boolean', description: 'Skip the optional LLM digest section.' },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: renderResultText(value as FavoritesToolResult) }],
    },
    async execute(args: { platform?: string; limit?: number; likes?: boolean; no_llm?: boolean }): Promise<FavoritesToolResult> {
      const platform = args.platform === 'douyin' || args.platform === 'xiaohongshu' ? args.platform : 'all'
      const platforms: Platform[] = platform === 'all' ? ['xiaohongshu', 'douyin'] : [platform]
      const engine = config?.collect ?? createPlaywrightEngine()
      try {
        const results = await engine.collect({
          platforms,
          limit: args.limit ?? config?.limit,
          includeLikes: args.likes === true || config?.includeLikes === true,
          cdpUrl: config?.cdpUrl,
          profileDir: config?.profileDir,
          headless: config?.headless,
        })
        const digest = args.no_llm === true ? undefined : await maybeSummarize(results, config)
        const dir = config?.defaultDir ?? join(process.cwd(), 'dsh-favorites')
        const written = await writeArtifacts(dir, results, digest)
        const warnings: string[] = []
        let xiaohongshu = 0
        let douyin = 0
        for (const result of results) {
          if (result.platform === 'xiaohongshu') xiaohongshu = result.items.length
          if (result.platform === 'douyin') douyin = result.items.length
          warnings.push(...result.warnings)
        }
        return {
          platforms: results.map((result) => result.platform),
          xiaohongshu,
          douyin,
          written: [written.jsonPath, written.mdPath],
          warnings,
          error: null,
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    },
  })
}
