import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resultToDict, type CollectionResult } from './models.ts'
import { classify } from './topics.ts'

export interface ExportBundle {
  generated_at: string
  platforms: Array<Record<string, unknown>>
}

export function stamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export function renderMarkdown(results: readonly CollectionResult[], digest?: string | null, now = new Date()): string {
  const items = results.flatMap((result) => result.items)
  const grouped = classify(items)
  const lines: string[] = [
    `# 收藏摘要 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    '',
    '## 总览',
  ]
  for (const result of results) {
    const name = result.platform === 'xiaohongshu' ? '小红书' : '抖音'
    lines.push(`- ${name}：${result.items.length} 条`)
    for (const warning of result.warnings) lines.push(`  - 注意：${warning}`)
  }
  lines.push('', '## 主题分组')
  for (const [topic, groupedItems] of grouped) {
    lines.push(`### ${topic}（${groupedItems.length}）`)
    for (const item of groupedItems.slice(0, 80)) {
      const author = item.author !== '' ? ` · ${item.author}` : ''
      lines.push(`- [${item.title}](${item.url})${author}`)
    }
    if (groupedItems.length > 80) lines.push(`- … 另有 ${groupedItems.length - 80} 条`)
    lines.push('')
  }
  if (digest !== undefined && digest !== null && digest.trim() !== '') {
    lines.push('## AI 综述', '', digest.trim(), '')
  }
  lines.push('## 完整清单')
  for (const result of results) {
    const name = result.platform === 'xiaohongshu' ? '小红书' : '抖音'
    lines.push(`### ${name}`)
    if (result.items.length === 0) {
      lines.push('（空）')
    } else {
      for (const item of result.items) {
        const author = item.author !== '' ? ` @${item.author}` : ''
        lines.push(`- [${item.title}](${item.url})${author}`)
      }
    }
    lines.push('')
  }
  return `${lines.join('\n').replace(/\s+$/u, '')}\n`
}

export function renderJson(results: readonly CollectionResult[], now = new Date()): string {
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const tz = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}${tz}`
  const payload: ExportBundle = {
    generated_at: generatedAt,
    platforms: results.map(resultToDict),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export async function writeArtifacts(
  dir: string,
  results: readonly CollectionResult[],
  digest?: string | null,
  now = new Date(),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(dir, { recursive: true })
  const base = join(dir, `favorites-${stamp(now)}`)
  const jsonPath = `${base}.json`
  const mdPath = `${base}.md`
  await writeFile(jsonPath, renderJson(results, now), 'utf8')
  await writeFile(mdPath, renderMarkdown(results, digest, now), 'utf8')
  return { jsonPath, mdPath }
}

export async function findLatestJson(dir: string): Promise<string | undefined> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return undefined
  }
  const files = names.filter((name) => /^favorites-.*\.json$/u.test(name)).sort()
  const last = files[files.length - 1]
  return last === undefined ? undefined : join(dir, last)
}
