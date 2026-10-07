import type { CollectionResult } from './models.ts'
import { classify } from './topics.ts'

export interface SummarizeConfig {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

export function resolveLlmConfig(config?: SummarizeConfig): { apiKey: string; baseUrl: string; model: string } | undefined {
  const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY
  if (apiKey === undefined || apiKey === '') return undefined
  const deepseek = process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== '' && process.env.OPENAI_API_KEY === undefined
  const baseUrl = (config?.baseUrl ?? process.env.OPENAI_BASE_URL ?? (deepseek ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1')).replace(/\/$/u, '')
  const model = config?.model ?? process.env.OPENAI_MODEL ?? (deepseek ? 'deepseek-chat' : 'gpt-4o-mini')
  return { apiKey, baseUrl, model }
}

export async function maybeSummarize(results: readonly CollectionResult[], config?: SummarizeConfig): Promise<string | undefined> {
  const llm = resolveLlmConfig(config)
  if (llm === undefined) return undefined
  const items = results.flatMap((result) => result.items)
  const grouped = classify(items)
  const catalog = [...grouped.entries()].map(([topic, groupedItems]) => ({
    topic,
    count: groupedItems.length,
    samples: groupedItems.slice(0, 25).map((item) => ({
      title: item.title,
      author: item.author,
      platform: item.platform,
    })),
  }))
  const prompt =
    '下面是用户自己从抖音和小红书导出的收藏目录（仅标题与作者）。' +
    '请用中文写一份可读的收藏综述：1）整体兴趣画像 2）按主题归纳 3）值得优先回看的 8-12 条。' +
    '不要编造目录里没有的标题。输出 Markdown 小节即可。\n\n' +
    JSON.stringify(catalog)
  try {
    const response = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: 'system', content: '你是克制、准确的中文编辑，只基于给定目录总结。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) return `（AI 综述调用失败：HTTP ${response.status}）`
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return payload.choices?.[0]?.message?.content
  } catch (error) {
    return `（AI 综述调用失败：${error instanceof Error ? error.message : String(error)}）`
  }
}
