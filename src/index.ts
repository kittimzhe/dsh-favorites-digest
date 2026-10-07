/**
 * dsh-favorites-digest — export the operator's own Douyin / Xiaohongshu
 * web favorites into Markdown using a logged-in Playwright session.
 *
 * Registers `/favorites` on ctx.commands. Optionally registers the
 * model-facing `favorites_digest` tool when the plugin row sets exposeTool.
 */
import type { Context, Disposable } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { executeFavorites, type FavoritesConfig } from './command.ts'
import { createFavoritesTool } from './tool.ts'

export const name = 'favorites-digest'
export const inject = ['commands', 'sessionQuery']

export type { FavoritesConfig, FavoritesArgs, FavoritesAction } from './command.ts'
export { parseFavoritesArgs, USAGE, executeFavorites, parseStoredResults } from './command.ts'
export { ingestDouyin, ingestXiaohongshu } from './ingest.ts'
export { classify, CATEGORIES } from './topics.ts'
export { renderMarkdown, renderJson, writeArtifacts } from './export.ts'
export { createFavoritesTool, FAVORITES_TOOL_DESCRIPTION } from './tool.ts'
export type { FavoritesToolResult } from './tool.ts'
export type { FavoriteItem, CollectionResult, Platform } from './models.ts'

export function apply(ctx: Context, config?: FavoritesConfig): void {
  ctx.effect(
    function* () {
      yield ctx.commands.register({
        name: 'favorites',
        description: 'Export your Douyin / Xiaohongshu web favorites to Markdown (login, collect, digest, or run)',
        input: { hint: 'login | collect | digest | run  [--platform …] [--limit N]' },
        handler: (invocation) => executeFavorites(invocation, config, ctx),
      })
    },
    'favorites-digest lifecycle',
  )

  if (config?.exposeTool === true) {
    ctx.effect(
      function* () {
        const tools = (ctx as { tools?: { register(tool: ToolDefinition): Disposable } }).tools
        if (tools == null || typeof tools.register !== 'function') return
        yield tools.register(createFavoritesTool(config))
      },
      'favorites-digest tool lifecycle',
    )
  }
}
