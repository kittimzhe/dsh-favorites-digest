from __future__ import annotations

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout

from ..ingest import ingest_xiaohongshu
from ..models import CollectionResult, FavoriteItem, utc_now
from . import NetworkBag, dump_json_from_page, scroll_until_stable

XHS_HOME = "https://www.xiaohongshu.com/"
XHS_EXPLORE = "https://www.xiaohongshu.com/explore"


def _looks_logged_in(page: Page) -> bool:
    return page.evaluate(
        """() => {
          const text = document.body ? document.body.innerText : '';
          if (text.includes('扫码登录') && text.includes('验证码登录')) return false;
          const cookie = document.cookie || '';
          return cookie.includes('web_session') || cookie.includes('a1=') || cookie.includes('webId');
        }"""
    )


def _open_favorites_tab(page: Page) -> bool:
    return page.evaluate(
        """() => {
          const nodes = [...document.querySelectorAll('a, span, div, li')];
          const hit = nodes.find(el => (el.textContent || '').trim() === '收藏');
          if (!hit) return false;
          hit.dispatchEvent(new MouseEvent('click', {bubbles: true}));
          return true;
        }"""
    )


def _goto_profile(page: Page) -> None:
    page.evaluate(
        """() => {
          const anchors = [...document.querySelectorAll('a[href*="/user/profile/"]')];
          const mine = anchors.find(a => /\\/user\\/profile\\/[a-z0-9]+/i.test(a.getAttribute('href') || ''));
          if (mine) mine.click();
        }"""
    )


def _dom_items(page: Page) -> list[FavoriteItem]:
    rows = page.evaluate(
        """() => {
          const out = [];
          const seen = new Set();
          for (const a of document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]')) {
            const href = a.href || '';
            const match = href.match(/(?:explore|item)\\/([0-9a-f]+)/i);
            if (!match || seen.has(match[1])) continue;
            seen.add(match[1]);
            const title = (a.innerText || a.getAttribute('title') || '').trim().split('\\n')[0];
            out.push({id: match[1], href, title});
          }
          return out;
        }"""
    )
    items: list[FavoriteItem] = []
    for row in rows:
        items.append(
            FavoriteItem(
                platform="xiaohongshu",
                item_id=row["id"],
                title=row["title"] or row["id"],
                url=row["href"],
                kind="note",
            )
        )
    return items


def collect_xiaohongshu(
    page: Page,
    *,
    limit: int | None = None,
    wait_login: bool = True,
) -> CollectionResult:
    warnings: list[str] = []
    bag = NetworkBag(ingest_xiaohongshu)
    bag.bind(page)

    try:
        page.goto(XHS_HOME, wait_until="domcontentloaded", timeout=90_000)
    except PlaywrightTimeout:
        warnings.append("打开小红书首页超时。")
        return CollectionResult("xiaohongshu", utc_now(), [], warnings)

    page.wait_for_timeout(2000)
    if wait_login and not _looks_logged_in(page):
        warnings.append("小红书看起来还没登录。请在弹出的浏览器里扫码登录，然后重新运行 collect。")

    _goto_profile(page)
    page.wait_for_timeout(1500)
    if "/user/profile/" not in page.url:
        try:
            page.locator("text=我").first.click(timeout=4000)
            page.wait_for_timeout(1500)
        except Exception:
            page.goto(XHS_EXPLORE, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            _goto_profile(page)
            page.wait_for_timeout(1500)

    if not _open_favorites_tab(page):
        warnings.append("没有找到「收藏」标签，尝试继续从当前页滚动抓取。")
    page.wait_for_timeout(1500)

    try:
        notes_tab = page.locator("text=笔记").first
        if notes_tab.count():
            notes_tab.click(timeout=2500)
            page.wait_for_timeout(800)
    except Exception:
        pass

    state = dump_json_from_page(page)
    if state:
        bag.merge(ingest_xiaohongshu(state))

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
        warnings.append("没有读到小红书收藏。确认已登录，并进入「我 → 收藏 → 笔记」。")
    return CollectionResult(
        platform="xiaohongshu",
        collected_at=utc_now(),
        items=items,
        warnings=warnings,
        source="network+dom",
    )
