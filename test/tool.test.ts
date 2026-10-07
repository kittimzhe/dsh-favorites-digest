import { describe, expect, it } from 'vitest'
import { createFavoritesTool, FAVORITES_TOOL_DESCRIPTION } from '../src/tool.ts'
import { emptyItem } from '../src/models.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('favorites_digest tool', () => {
  it('declares the name and a long timeout for scrolling', () => {
    const tool = createFavoritesTool()
    expect(tool.timeoutMs).toBe(600_000)
    expect(FAVORITES_TOOL_DESCRIPTION).toContain('Douyin')
  })

  it('writes artifacts through an injected collector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fav-tool-'))
    try {
      const tool = createFavoritesTool({
        defaultDir: dir,
        collect: {
          async collect() {
            return [
              {
                platform: 'douyin',
                collected_at: 't',
                items: [emptyItem({ platform: 'douyin', item_id: '1234567890123456', title: '面试', url: 'https://d.example/v' })],
                warnings: [],
                source: 'mock',
              },
            ]
          },
        },
      })
      const result = (await tool.execute(
        { platform: 'douyin', no_llm: true },
        { callId: 'c1', name: 'favorites_digest', arguments: {}, signal: new AbortController().signal } as never,
      )) as { error: string | null; douyin: number; written: string[] }
      expect(result.error).toBeNull()
      expect(result.douyin).toBe(1)
      expect(result.written.some((path) => path.endsWith('.md'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
