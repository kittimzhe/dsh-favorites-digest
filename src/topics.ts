import type { FavoriteItem } from './models.ts'

export const CATEGORIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['求职 / 职场', ['简历', '面试', '职场', 'offer', '秋招', '春招', '实习', '晋升', '领导', '汇报']],
  ['学习 / 成长', ['学习', '读书', '英语', '考研', '考试', '笔记', '方法论', '效率', '知识']],
  ['AI / 数码', ['ai', 'gpt', '大模型', '提示词', 'prompt', '编程', '代码', '数码', '电脑', '手机']],
  ['美食', ['美食', '食谱', '餐厅', '探店', '做饭', '烘焙', '小吃']],
  ['穿搭 / 美妆', ['穿搭', '搭配', '美妆', '护肤', '口红', '发型', '衣服']],
  ['旅行 / 探店', ['旅行', '旅游', '攻略', '酒店', '景点', '出行']],
  ['健身 / 健康', ['健身', '减肥', '运动', '瑜伽', '睡眠', '养生']],
  ['家居 / 生活', ['家居', '装修', '收纳', '生活', '好物']],
  ['影视 / 娱乐', ['电影', '剧', '综艺', '音乐', '明星']],
]

export function classify(items: readonly FavoriteItem[]): Map<string, FavoriteItem[]> {
  const buckets = new Map<string, FavoriteItem[]>()
  for (const [name] of CATEGORIES) buckets.set(name, [])
  buckets.set('其他', [])
  for (const item of items) {
    const blob = [item.title, item.author, item.tags.join(' '), String(item.extra.desc ?? '')].join(' ').toLowerCase()
    let placed = false
    for (const [name, keywords] of CATEGORIES) {
      if (keywords.some((keyword) => blob.includes(keyword.toLowerCase()))) {
        buckets.get(name)!.push(item)
        placed = true
        break
      }
    }
    if (!placed) buckets.get('其他')!.push(item)
  }
  for (const [name, grouped] of [...buckets.entries()]) {
    if (grouped.length === 0) buckets.delete(name)
  }
  return buckets
}
