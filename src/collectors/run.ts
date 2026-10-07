import { openSession } from '../browser.ts'
import { collectDouyin } from './douyin.ts'
import { collectXiaohongshu } from './xiaohongshu.ts'
import type { CollectionResult, Platform } from '../models.ts'

export interface CollectOptions {
  platforms: readonly Platform[]
  limit?: number
  includeLikes?: boolean
  cdpUrl?: string
  profileDir?: string
  headless?: boolean
}

export interface CollectEngine {
  collect(options: CollectOptions): Promise<CollectionResult[]>
}

export function createPlaywrightEngine(): CollectEngine {
  return {
    async collect(options) {
      const session = await openSession({
        cdpUrl: options.cdpUrl,
        profileDir: options.profileDir,
        headless: options.headless,
      })
      try {
        const results: CollectionResult[] = []
        if (options.platforms.includes('xiaohongshu')) {
          results.push(await collectXiaohongshu(session.page(), { limit: options.limit }))
        }
        if (options.platforms.includes('douyin')) {
          const page =
            options.platforms.includes('xiaohongshu') ? await session.context.newPage() : session.page()
          results.push(await collectDouyin(page, { includeLikes: options.includeLikes, limit: options.limit }))
        }
        return results
      } finally {
        await session.close()
      }
    },
  }
}
