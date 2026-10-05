from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import urljoin

from .models import FavoriteItem

_HASHTAG = re.compile(r"#([^\s#]+)")
_XHS_ID = re.compile(r"^[0-9a-f]{16,32}$", re.I)
_DOUYIN_ID = re.compile(r"^\d{8,32}$")


def walk(obj: Any) -> Iterable[Any]:
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item)


def unique_tags(*texts: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for text in texts:
        for tag in _HASHTAG.findall(text or ""):
            clean = tag.strip().strip("，。！？,.!")
            if clean and clean not in seen:
                seen.add(clean)
                found.append(clean)
    return found


def text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def ingest_xiaohongshu(payload: Any) -> list[FavoriteItem]:
    items: dict[str, FavoriteItem] = {}
    for node in walk(payload):
        if not isinstance(node, dict):
            continue
        card = node.get("note_card") if isinstance(node.get("note_card"), dict) else None
        note_id = text(
            node.get("id"),
            node.get("note_id"),
            node.get("noteId"),
            (card or {}).get("note_id"),
            (card or {}).get("id"),
        )
        title = text(
            node.get("display_title"),
            node.get("title"),
            (card or {}).get("display_title"),
            (card or {}).get("title"),
        )
        if not note_id or not _XHS_ID.match(note_id):
            continue
        if not title and not card and not node.get("xsec_token") and not node.get("xsecToken"):
            continue
        user = node.get("user") if isinstance(node.get("user"), dict) else {}
        if card and isinstance(card.get("user"), dict):
            user = card.get("user") or user
        interact = (card or {}).get("interact_info") if isinstance((card or {}).get("interact_info"), dict) else {}
        xsec = text(node.get("xsec_token"), node.get("xsecToken"))
        url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if xsec:
            url += f"?xsec_token={xsec}"
        cover = ""
        cover_obj = (card or {}).get("cover") if isinstance((card or {}).get("cover"), dict) else node.get("cover")
        if isinstance(cover_obj, dict):
            cover = text(cover_obj.get("url"), cover_obj.get("url_default"))
        elif isinstance(cover_obj, str):
            cover = cover_obj
        desc = text((card or {}).get("desc"), node.get("desc"))
        item = FavoriteItem(
            platform="xiaohongshu",
            item_id=note_id,
            title=title or desc[:40] or note_id,
            url=url,
            author=text(user.get("nickname"), user.get("nick_name"), user.get("name")),
            kind=text((card or {}).get("type"), node.get("type"), "note"),
            cover=cover,
            tags=unique_tags(title, desc),
            extra={"desc": desc, "liked_count": interact.get("liked_count")},
        )
        items[item.item_id] = item
    return list(items.values())


def ingest_douyin(payload: Any) -> list[FavoriteItem]:
    items: dict[str, FavoriteItem] = {}
    for node in walk(payload):
        if not isinstance(node, dict):
            continue
        aweme_id = text(node.get("aweme_id"), node.get("awemeId"), node.get("group_id"))
        desc = text(node.get("desc"), node.get("title"), node.get("preview_title"))
        if not aweme_id or not _DOUYIN_ID.match(aweme_id):
            continue
        if not desc and "share_url" not in node and "share_info" not in node:
            continue
        author = node.get("author") if isinstance(node.get("author"), dict) else {}
        share = node.get("share_info") if isinstance(node.get("share_info"), dict) else {}
        stats = node.get("statistics") if isinstance(node.get("statistics"), dict) else {}
        video = node.get("video") if isinstance(node.get("video"), dict) else {}
        cover_obj = video.get("cover") if isinstance(video.get("cover"), dict) else {}
        url_list = cover_obj.get("url_list") if isinstance(cover_obj.get("url_list"), list) else []
        share_url = text(node.get("share_url"), share.get("share_url"))
        kind = "note" if "/note/" in (share_url or "") else "video"
        url = share_url or urljoin("https://www.douyin.com/", f"{kind}/{aweme_id}")
        if url.startswith("//"):
            url = "https:" + url
        item = FavoriteItem(
            platform="douyin",
            item_id=aweme_id,
            title=desc or aweme_id,
            url=url,
            author=text(author.get("nickname"), author.get("nick_name")),
            kind=kind,
            cover=text(url_list[0] if url_list else "", node.get("cover")),
            tags=unique_tags(desc),
            extra={"digg_count": stats.get("digg_count"), "create_time": node.get("create_time")},
        )
        items[item.item_id] = item
    return list(items.values())
