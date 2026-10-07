export type Platform = 'xiaohongshu' | 'douyin'

export interface FavoriteItem {
  platform: Platform
  item_id: string
  title: string
  url: string
  author: string
  kind: string
  cover: string
  tags: string[]
  extra: Record<string, unknown>
}

export interface CollectionResult {
  platform: Platform
  collected_at: string
  items: FavoriteItem[]
  warnings: string[]
  source: string
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function emptyItem(partial: Partial<FavoriteItem> & Pick<FavoriteItem, 'platform' | 'item_id' | 'title' | 'url'>): FavoriteItem {
  return {
    author: '',
    kind: '',
    cover: '',
    tags: [],
    extra: {},
    ...partial,
  }
}

export function resultToDict(result: CollectionResult): Record<string, unknown> {
  return {
    platform: result.platform,
    collected_at: result.collected_at,
    item_count: result.items.length,
    warnings: result.warnings,
    source: result.source,
    items: result.items,
  }
}
