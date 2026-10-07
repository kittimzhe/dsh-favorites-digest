import type { Page } from 'playwright'
import { dumpJsonFromPage, NetworkBag, scrollUntilStable } from '../browser.ts'
import { ingestDouyin } from '../ingest.ts'
import { emptyItem, utcNow, type CollectionResult, type FavoriteItem } from '../models.ts'

export const DOUYIN_HOME = 'https://www.douyin.com/'
export const DOUYIN_FAVORITES = 'https://www.douyin.com/user/self?showTab=favorite_collection'
export const DOUYIN_LIKES = 'https://www.douyin.com/user/self?showTab=like'

export async function looksLoggedInDouyin(page: Page): Promise<boolean> {
  if (page.url().includes('login')) return false
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : ''
    const qr = text.includes('扫码登录') || text.includes('验证码登录')
    const self = location.href.includes('/user/self') || !!document.querySelector('a[href*="/user/self"]')
    return !qr && (self || text.includes('我') || text.includes('消息'))
  })
}

async function domItems(page: Page): Promise<FavoriteItem[]> {
  const rows = await page.evaluate(() => {
    const out: Array<{ kind: string; id: string; href: string; title: string }> = []
    const seen = new Set<string>()
    for (const a of document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')) {
      const href = (a as HTMLAnchorElement).href || a.getAttribute('href') || ''
      const match = href.match(/\/(video|note)\/(\d+)/)
      if (match?.[1] === undefined || match[2] === undefined || seen.has(match[2])) continue
      seen.add(match[2])
      const title = (a.getAttribute('aria-label') || (a as HTMLElement).innerText || '').trim()
      out.push({ kind: match[1], id: match[2], href, title })
    }
    return out
  })
  return rows.map((row) =>
    emptyItem({
      platform: 'douyin',
      item_id: row.id,
      title: row.title !== '' ? row.title : row.id,
      url: row.href.startsWith('http') ? row.href : `https://www.douyin.com${row.href}`,
      kind: row.kind,
    }),
  )
}

export async function collectDouyin(
  page: Page,
  options: { includeLikes?: boolean; limit?: number } = {},
): Promise<CollectionResult> {
  const warnings: string[] = []
  const bag = new NetworkBag(ingestDouyin)
  bag.bind(page)
  await page.goto(DOUYIN_HOME, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(1500)
  if (!(await looksLoggedInDouyin(page))) {
    warnings.push('抖音看起来还没登录。请先运行 /favorites login，在弹出的浏览器里扫码。')
  }

  const targets: Array<[string, string]> = [['收藏', DOUYIN_FAVORITES]]
  if (options.includeLikes === true) targets.push(['喜欢', DOUYIN_LIKES])

  for (const [label, url] of targets) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        warnings.push(`打开抖音${label}页超时：${url}`)
        continue
      }
      throw error
    }
    await page.waitForTimeout(2500)
    try {
      const tab = page.locator('text=收藏').first()
      if ((await tab.count()) > 0 && label === '收藏') {
        await tab.click({ timeout: 3000 })
        await page.waitForTimeout(800)
      }
    } catch {
      /* optional */
    }
    const state = await dumpJsonFromPage(page)
    if (state !== null) bag.merge(ingestDouyin(state))
    await scrollUntilStable(page, () => bag.items.size || 0, { limit: options.limit })
    bag.merge(await domItems(page))
  }

  let items = [...bag.items.values()]
  if (options.limit !== undefined) items = items.slice(0, options.limit)
  if (items.length === 0) warnings.push('没有读到抖音收藏。确认 web 端已登录，并打开过「我 → 收藏」。')
  return { platform: 'douyin', collected_at: utcNow(), items, warnings, source: 'network+dom' }
}
