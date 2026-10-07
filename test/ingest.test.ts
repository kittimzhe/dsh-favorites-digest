import { describe, expect, it } from 'vitest'
import { ingestDouyin, ingestXiaohongshu } from '../src/ingest.ts'
import { classify } from '../src/topics.ts'
import { renderMarkdown } from '../src/export.ts'
import { emptyItem } from '../src/models.ts'
import { parseFavoritesArgs, USAGE, parseStoredResults, executeFavorites } from '../src/command.ts'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'

describe('ingestXiaohongshu', () => {
  it('reads note_card payloads', () => {
    const items = ingestXiaohongshu({
      data: {
        notes: [
          {
            id: '64f0a1b2c3d4e5f678901234',
            xsec_token: 'tok',
            note_card: {
              display_title: '周末探店 #美食',
              type: 'normal',
              user: { nickname: '阿菜' },
              desc: '推荐一家面馆',
            },
          },
        ],
      },
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('周末探店 #美食')
    expect(items[0]?.author).toBe('阿菜')
    expect(items[0]?.tags).toContain('美食')
    expect(items[0]?.url).toContain('xsec_token=tok')
  })
})

describe('ingestDouyin', () => {
  it('reads aweme_list payloads', () => {
    const items = ingestDouyin({
      aweme_list: [
        {
          aweme_id: '7322323500700601640',
          desc: '面试复盘 #求职',
          author: { nickname: 'HR笔记' },
          share_url: 'https://www.douyin.com/video/7322323500700601640',
          statistics: { digg_count: 12 },
        },
      ],
    })
    expect(items[0]?.item_id).toBe('7322323500700601640')
    expect(items[0]?.author).toBe('HR笔记')
  })
})

describe('classify', () => {
  it('buckets by keywords', () => {
    const grouped = classify([
      emptyItem({ platform: 'xiaohongshu', item_id: 'a'.repeat(24), title: '秋招面试经验', url: 'https://example.com/a', author: '小明' }),
      emptyItem({ platform: 'douyin', item_id: '1234567890123456', title: '探店火锅', url: 'https://example.com/b', author: '小红' }),
    ])
    expect(grouped.has('求职 / 职场')).toBe(true)
    expect(grouped.has('美食')).toBe(true)
  })
})

describe('renderMarkdown', () => {
  it('includes titles', () => {
    const text = renderMarkdown(
      [
        {
          platform: 'xiaohongshu',
          collected_at: 't',
          items: [emptyItem({ platform: 'xiaohongshu', item_id: 'a'.repeat(24), title: '秋招面试经验', url: 'https://example.com/a' })],
          warnings: [],
          source: 'test',
        },
        {
          platform: 'douyin',
          collected_at: 't',
          items: [emptyItem({ platform: 'douyin', item_id: '1234567890123456', title: '探店火锅', url: 'https://example.com/b' })],
          warnings: [],
          source: 'test',
        },
      ],
      undefined,
      new Date('2026-10-05T12:00:00'),
    )
    expect(text).toContain('秋招面试经验')
    expect(text).toContain('探店火锅')
  })
})

describe('parseFavoritesArgs', () => {
  it('defaults to run', () => {
    expect(parseFavoritesArgs('')).toEqual({ action: 'run', platform: 'all', likes: false, noLlm: false })
  })
  it('parses login and flags', () => {
    expect(parseFavoritesArgs('login --platform xiaohongshu')).toEqual({
      action: 'login',
      platform: 'xiaohongshu',
      likes: false,
      noLlm: false,
    })
  })
  it('parses collect flags', () => {
    expect(parseFavoritesArgs('collect --limit 20 --likes --no-llm --cdp-url http://127.0.0.1:9222 --out /tmp/out')).toEqual({
      action: 'collect',
      platform: 'all',
      limit: 20,
      likes: true,
      noLlm: true,
      cdpUrl: 'http://127.0.0.1:9222',
      outDir: '/tmp/out',
    })
  })
  it('rejects unknown flags', () => {
    expect(parseFavoritesArgs('--nope')).toBe(`Unknown option: --nope\n${USAGE}`)
  })
})

describe('executeFavorites with injected collector', () => {
  it('writes markdown from mocked collect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fav-dsh-'))
    try {
      const invocation = {
        commandId: 'cmd-1',
        rawInput: `--out ${dir} --no-llm`,
        attachments: [],
        signal: new AbortController().signal,
        agent: { session: { cwd: dir } },
      } as unknown as CommandInvocation
      const result = await executeFavorites(invocation, {
        collect: {
          async collect() {
            return [
              {
                platform: 'xiaohongshu',
                collected_at: 't',
                items: [emptyItem({ platform: 'xiaohongshu', item_id: 'a'.repeat(24), title: '周末探店', url: 'https://xhs.example/n' })],
                warnings: [],
                source: 'mock',
              },
            ]
          },
        },
      })
      expect(result.kind).toBe('success')
      if (result.kind !== 'success') return
      expect(result.text).toContain('小红书')
      expect(result.text).toContain(dir)
      const md = readdirSync(dir).find((name) => name.endsWith('.md'))
      expect(md).toBeDefined()
      expect(readFileSync(join(dir, md!), 'utf8')).toContain('周末探店')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseStoredResults', () => {
  it('round-trips export json', () => {
    const parsed = parseStoredResults({
      platforms: [
        {
          platform: 'douyin',
          items: [{ item_id: '1234567890123456', title: 't', url: 'https://d', platform: 'douyin' }],
          warnings: ['w'],
        },
      ],
    })
    expect(typeof parsed).not.toBe('string')
    if (typeof parsed === 'string') return
    expect(parsed[0]?.items[0]?.title).toBe('t')
  })
})
