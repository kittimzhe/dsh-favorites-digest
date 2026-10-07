import type { Page } from 'playwright'
import { dumpJsonFromPage, NetworkBag, scrollUntilStable } from '../browser.ts'
import { ingestXiaohongshu } from '../ingest.ts'
import { emptyItem, utcNow, type CollectionResult, type FavoriteItem } from '../models.ts'

export const XHS_HOME = 'https://www.xiaohongshu.com/'
export const XHS_EXPLORE = 'https://www.xiaohongshu.com/explore'

export async function looksLoggedInXiaohongshu(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : ''
    if (text.includes('扫码登录') && text.includes('验证码登录')) return false
    const cookie = document.cookie || ''
    return cookie.includes('web_session') || cookie.includes('a1=') || cookie.includes('webId')
  })
}

async function openFavoritesTab(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('a, span, div, li')]
    const hit = nodes.find((el) => (el.textContent || '').trim() === '收藏')
    if (hit === undefined) return false
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
}

async function gotoProfile(page: Page): Promise<void> {
  await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href*="/user/profile/"]')]
    const mine = anchors.find((a) => /\/user\/profile\/[a-z0-9]+/i.test(a.getAttribute('href') || ''))
    if (mine !== undefined) (mine as HTMLElement).click()
  })
}

async function domItems(page: Page): Promise<FavoriteItem[]> {
  const rows = await page.evaluate(() => {
    const out: Array<{ id: string; href: string; title: string }> = []
    const seen = new Set<string>()
    for (const a of document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]')) {
      const href = (a as HTMLAnchorElement).href || ''
      const match = href.match(/(?:explore|item)\/([0-9a-f]+)/i)
      if (match?.[1] === undefined || seen.has(match[1])) continue
      seen.add(match[1])
      const title = ((a as HTMLElement).innerText || a.getAttribute('title') || '').trim().split('\n')[0] ?? ''
      out.push({ id: match[1], href, title })
    }
    return out
  })
  return rows.map((row) =>
    emptyItem({
      platform: 'xiaohongshu',
      item_id: row.id,
      title: row.title !== '' ? row.title : row.id,
      url: row.href,
      kind: 'note',
    }),
  )
}

export async function collectXiaohongshu(page: Page, options: { limit?: number } = {}): Promise<CollectionResult> {
  const warnings: string[] = []
  const bag = new NetworkBag(ingestXiaohongshu)
  bag.bind(page)
  try {
    await page.goto(XHS_HOME, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { platform: 'xiaohongshu', collected_at: utcNow(), items: [], warnings: ['打开小红书首页超时。'], source: 'network+dom' }
    }
    throw error
  }
  await page.waitForTimeout(2000)
  if (!(await looksLoggedInXiaohongshu(page))) {
    warnings.push('小红书看起来还没登录。请先运行 /favorites login，在弹出的浏览器里扫码。')
  }

  await gotoProfile(page)
  await page.waitForTimeout(1500)
  if (!page.url().includes('/user/profile/')) {
    try {
      await page.locator('text=我').first().click({ timeout: 4000 })
      await page.waitForTimeout(1500)
    } catch {
      await page.goto(XHS_EXPLORE, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      await gotoProfile(page)
      await page.waitForTimeout(1500)
    }
  }

  if (!(await openFavoritesTab(page))) warnings.push('没有找到「收藏」标签，尝试继续从当前页滚动抓取。')
  await page.waitForTimeout(1500)
  try {
    const notesTab = page.locator('text=笔记').first()
    if ((await notesTab.count()) > 0) {
      await notesTab.click({ timeout: 2500 })
      await page.waitForTimeout(800)
    }
  } catch {
    /* optional */
  }

  const state = await dumpJsonFromPage(page)
  if (state !== null) bag.merge(ingestXiaohongshu(state))
  await scrollUntilStable(page, () => bag.items.size || 0, { limit: options.limit })
  bag.merge(await domItems(page))
  let items = [...bag.items.values()]
  if (options.limit !== undefined) items = items.slice(0, options.limit)
  if (items.length === 0) warnings.push('没有读到小红书收藏。确认已登录，并进入「我 → 收藏 → 笔记」。')
  return { platform: 'xiaohongshu', collected_at: utcNow(), items, warnings, source: 'network+dom' }
}
