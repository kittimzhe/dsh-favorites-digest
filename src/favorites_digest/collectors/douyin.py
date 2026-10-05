from __future__ import annotations

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout

from ..ingest import ingest_douyin
from ..models import CollectionResult, FavoriteItem, utc_now
from . import NetworkBag, dump_json_from_page, scroll_until_stable

DOUYIN_HOME = "https://www.douyin.com/"
DOUYIN_FAVORITES = "https://www.douyin.com/user/self?showTab=favorite_collection"
DOUYIN_LIKES = "https://www.douyin.com/user/self?showTab=like"


def _looks_logged_in(page: Page) -> bool:
    url = page.url
    if "login" in url:
        return False
    return page.evaluate(
        """() => {
          const text = document.body ? document.body.innerText : '';
          const qr = text.includes('扫码登录') || text.includes('验证码登录');
          const self = location.href.includes('/user/self') ||
            !!document.querySelector('a[href*="/user/self"]');
          return !qr && (self || text.includes('我') || text.includes('消息'));
        }"""
    )


def _dom_items(page: Page) -> list[FavoriteItem]:
    rows = page.evaluate(
        """() => {
          const out = [];
          const seen = new Set();
          for (const a of document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')) {
            const href = a.href || a.getAttribute('href') || '';
            const match = href.match(/\\/(video|note)\\/(\\d+)/);
            if (!match || seen.has(match[2])) continue;
            seen.add(match[2]);
            const title = (a.getAttribute('aria-label') || a.innerText || '').trim();
            out.push({kind: match[1], id: match[2], href, title});
          }
          return out;
        }"""
    )
    items: list[FavoriteItem] = []
    for row in rows:
        items.append(
            FavoriteItem(
                platform="douyin",
                item_id=row["id"],
                title=row["title"] or row["id"],
                url=row["href"] if row["href"].startswith("http") else f"https://www.douyin.com{row['href']}",
                kind=row["kind"],
            )
        )
    return items


def collect_douyin(
    page: Page,
    *,
    include_likes: bool = False,
    limit: int | None = None,
    wait_login: bool = True,
) -> CollectionResult:
    warnings: list[str] = []
    bag = NetworkBag(ingest_douyin)
    bag.bind(page)

    page.goto(DOUYIN_HOME, wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_timeout(1500)
    if wait_login and not _looks_logged_in(page):
        warnings.append("抖音看起来还没登录。请在弹出的浏览器里扫码登录，然后重新运行 collect。")

    targets = [("收藏", DOUYIN_FAVORITES)]
    if include_likes:
        targets.append(("喜欢", DOUYIN_LIKES))

    for label, url in targets:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        except PlaywrightTimeout:
            warnings.append(f"打开抖音{label}页超时：{url}")
            continue
        page.wait_for_timeout(2500)
        try:
            tabs = page.locator("text=收藏").first
            if tabs.count() and label == "收藏":
                tabs.click(timeout=3000)
                page.wait_for_timeout(800)
        except Exception:
            pass
        state = dump_json_from_page(page)
        if state:
            bag.merge(ingest_douyin(state))
        scroll_until_stable(
            page,
            lambda: len(bag.items) or len(_dom_items(page)),
            limit=limit,
        )
        bag.merge(_dom_items(page))

    items = list(bag.items.values())
    if limit:
        items = items[:limit]
    if not items:
        warnings.append("没有读到抖音收藏。确认 web 端已登录，并打开过「我 → 收藏」。")
    return CollectionResult(
        platform="douyin",
        collected_at=utc_now(),
        items=items,
        warnings=warnings,
        source="network+dom",
    )
