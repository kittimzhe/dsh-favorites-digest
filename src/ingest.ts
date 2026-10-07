import { emptyItem, type FavoriteItem } from './models.ts'

const HASHTAG = /#([^\s#]+)/g
const XHS_ID = /^[0-9a-f]{16,32}$/i
const DOUYIN_ID = /^\d{8,32}$/

export function* walk(obj: unknown): Generator<unknown> {
  if (obj !== null && typeof obj === 'object') {
    yield obj
    if (Array.isArray(obj)) {
      for (const item of obj) yield* walk(item)
    } else {
      for (const value of Object.values(obj as Record<string, unknown>)) yield* walk(value)
    }
  }
}

export function uniqueTags(...texts: Array<string | undefined>): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const text of texts) {
    if (text === undefined || text === '') continue
    HASHTAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HASHTAG.exec(text)) !== null) {
      const clean = match[1]?.replace(/[，。！？,.!]+$/u, '').trim() ?? ''
      if (clean !== '' && !seen.has(clean)) {
        seen.add(clean)
        found.push(clean)
      }
    }
  }
  return found
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function ingestXiaohongshu(payload: unknown): FavoriteItem[] {
  const items = new Map<string, FavoriteItem>()
  for (const nodeUnknown of walk(payload)) {
    const node = asRecord(nodeUnknown)
    if (node === undefined) continue
    const card = asRecord(node.note_card)
    const noteId = text(node.id, node.note_id, node.noteId, card?.note_id, card?.id)
    const title = text(node.display_title, node.title, card?.display_title, card?.title)
    if (noteId === '' || !XHS_ID.test(noteId)) continue
    if (title === '' && card === undefined && node.xsec_token === undefined && node.xsecToken === undefined) continue
    let user = asRecord(node.user) ?? {}
    const cardUser = asRecord(card?.user)
    if (cardUser !== undefined) user = cardUser
    const interact = asRecord(card?.interact_info) ?? {}
    const xsec = text(node.xsec_token, node.xsecToken)
    let url = `https://www.xiaohongshu.com/explore/${noteId}`
    if (xsec !== '') url += `?xsec_token=${xsec}`
    let cover = ''
    const coverObj = asRecord(card?.cover) ?? node.cover
    if (asRecord(coverObj) !== undefined) {
      const rec = asRecord(coverObj)!
      cover = text(rec.url, rec.url_default)
    } else if (typeof coverObj === 'string') {
      cover = coverObj
    }
    const desc = text(card?.desc, node.desc)
    items.set(
      noteId,
      emptyItem({
        platform: 'xiaohongshu',
        item_id: noteId,
        title: title !== '' ? title : desc.slice(0, 40) || noteId,
        url,
        author: text(user.nickname, user.nick_name, user.name),
        kind: text(card?.type, node.type, 'note'),
        cover,
        tags: uniqueTags(title, desc),
        extra: { desc, liked_count: interact.liked_count },
      }),
    )
  }
  return [...items.values()]
}

export function ingestDouyin(payload: unknown): FavoriteItem[] {
  const items = new Map<string, FavoriteItem>()
  for (const nodeUnknown of walk(payload)) {
    const node = asRecord(nodeUnknown)
    if (node === undefined) continue
    const awemeId = text(node.aweme_id, node.awemeId, node.group_id)
    const desc = text(node.desc, node.title, node.preview_title)
    if (awemeId === '' || !DOUYIN_ID.test(awemeId)) continue
    if (desc === '' && node.share_url === undefined && node.share_info === undefined) continue
    const author = asRecord(node.author) ?? {}
    const share = asRecord(node.share_info) ?? {}
    const stats = asRecord(node.statistics) ?? {}
    const video = asRecord(node.video) ?? {}
    const coverObj = asRecord(video.cover) ?? {}
    const urlList = Array.isArray(coverObj.url_list) ? coverObj.url_list : []
    let shareUrl = text(node.share_url, share.share_url)
    const kind = shareUrl.includes('/note/') ? 'note' : 'video'
    let url = shareUrl !== '' ? shareUrl : `https://www.douyin.com/${kind}/${awemeId}`
    if (url.startsWith('//')) url = `https:${url}`
    items.set(
      awemeId,
      emptyItem({
        platform: 'douyin',
        item_id: awemeId,
        title: desc !== '' ? desc : awemeId,
        url,
        author: text(author.nickname, author.nick_name),
        kind,
        cover: text(typeof urlList[0] === 'string' ? urlList[0] : '', node.cover),
        tags: uniqueTags(desc),
        extra: { digg_count: stats.digg_count, create_time: node.create_time },
      }),
    )
  }
  return [...items.values()]
}
