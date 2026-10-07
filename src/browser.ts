import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { FavoriteItem } from './models.ts'

export interface BrowserSession {
  context: BrowserContext
  cdp: boolean
  close(): Promise<void>
  page(): Page
}

export function defaultProfileDir(override?: string): string {
  return override ?? join(homedir(), '.dsh', 'favorites-digest', 'profile')
}

export async function openSession(options: {
  profileDir?: string
  cdpUrl?: string
  headless?: boolean
}): Promise<BrowserSession> {
  if (options.cdpUrl !== undefined && options.cdpUrl !== '') {
    const browser: Browser = await chromium.connectOverCDP(options.cdpUrl)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    return {
      context,
      cdp: true,
      async close() {
        /* attach mode: leave the user's Chrome running */
      },
      page() {
        return pickPage(context)
      },
    }
  }

  const launch = {
    headless: options.headless === true,
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: ['--disable-blink-features=AutomationControlled'],
  }
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(defaultProfileDir(options.profileDir), {
      ...launch,
      channel: 'chrome',
    })
  } catch {
    context = await chromium.launchPersistentContext(defaultProfileDir(options.profileDir), launch)
  }
  return {
    context,
    cdp: false,
    async close() {
      await context.close()
    },
    page() {
      return pickPage(context)
    },
  }
}

function pickPage(context: BrowserContext): Page {
  for (const existing of context.pages()) {
    if (existing.url() !== '' && existing.url() !== 'about:blank') return existing
  }
  const first = context.pages()[0]
  if (first === undefined) throw new Error('browser context has no pages')
  return first
}

export class NetworkBag {
  readonly items = new Map<string, FavoriteItem>()
  rawHits = 0

  constructor(private readonly ingest: (payload: unknown) => FavoriteItem[]) {}

  bind(page: Page): void {
    page.on('response', (response) => {
      void this.onResponse(response)
    })
  }

  private async onResponse(response: { url(): string; status(): number; headers(): Record<string, string>; json(): Promise<unknown> }): Promise<void> {
    const url = response.url().toLowerCase()
    if (response.status() !== 200) return
    const interesting = ['collect', 'favorite', 'aweme', 'note/', 'board', 'user/post'].some((token) => url.includes(token))
    if (!interesting) return
    const contentType = (response.headers()['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('json') && !contentType.includes('javascript')) return
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return
    }
    const found = this.ingest(payload)
    if (found.length > 0) {
      this.rawHits += 1
      for (const item of found) this.items.set(item.item_id, item)
    }
  }

  merge(extra: readonly FavoriteItem[]): FavoriteItem[] {
    for (const item of extra) {
      if (!this.items.has(item.item_id)) this.items.set(item.item_id, item)
    }
    return [...this.items.values()]
  }
}

export async function scrollUntilStable(
  page: Page,
  countFn: () => number,
  options: { maxScrolls?: number; idleRounds?: number; pauseMs?: number; limit?: number } = {},
): Promise<void> {
  const maxScrolls = options.maxScrolls ?? 180
  const idleRounds = options.idleRounds ?? 8
  const pauseMs = options.pauseMs ?? 900
  let last = -1
  let idle = 0
  for (let i = 0; i < maxScrolls; i += 1) {
    const current = countFn()
    if (options.limit !== undefined && current >= options.limit) return
    await page.mouse.wheel(0, 2200)
    await page.evaluate(() => {
      const root = document.scrollingElement
      if (root) root.scrollBy(0, 2200)
      const boxes = [...document.querySelectorAll('div, section, main')]
        .filter((el) => el.scrollHeight > el.clientHeight + 80)
        .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))
      boxes[0]?.scrollBy(0, 2200)
    })
    await page.waitForTimeout(pauseMs)
    if (current <= last) {
      idle += 1
      if (idle >= idleRounds) return
    } else {
      idle = 0
      last = current
    }
  }
}

export async function dumpJsonFromPage(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')]
    for (const script of scripts) {
      const text = script.textContent ?? ''
      if (!text.includes('window.__INITIAL_STATE__') && !text.includes('__INITIAL_SSR_STATE__')) continue
      const matched = text.match(/__INITIAL(?:_SSR)?_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:window\.|$)/)
      if (matched?.[1] === undefined) continue
      try {
        return JSON.parse(matched[1]) as unknown
      } catch {
        /* continue */
      }
    }
    return null
  })
}
