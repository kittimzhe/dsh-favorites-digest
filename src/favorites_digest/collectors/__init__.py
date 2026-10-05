from __future__ import annotations

import json
from typing import Any, Callable

from playwright.sync_api import Page, Response

from ..models import FavoriteItem


class NetworkBag:
    def __init__(self, ingest: Callable[[Any], list[FavoriteItem]]) -> None:
        self.ingest = ingest
        self.items: dict[str, FavoriteItem] = {}
        self.raw_hits = 0

    def bind(self, page: Page) -> None:
        page.on("response", self._on_response)

    def _on_response(self, response: Response) -> None:
        url = response.url.lower()
        if response.status != 200:
            return
        interesting = any(
            token in url
            for token in (
                "collect",
                "favorite",
                "aweme",
                "note/",
                "board",
                "user/post",
            )
        )
        if not interesting:
            return
        content_type = (response.headers.get("content-type") or "").lower()
        if "json" not in content_type and "javascript" not in content_type:
            return
        try:
            payload = response.json()
        except Exception:
            return
        found = self.ingest(payload)
        if found:
            self.raw_hits += 1
            for item in found:
                self.items[item.item_id] = item

    def merge(self, extra: list[FavoriteItem]) -> list[FavoriteItem]:
        for item in extra:
            self.items.setdefault(item.item_id, item)
        return list(self.items.values())


def scroll_until_stable(
    page: Page,
    count_fn: Callable[[], int],
    *,
    max_scrolls: int = 180,
    idle_rounds: int = 8,
    pause_ms: int = 900,
    limit: int | None = None,
) -> None:
    last = -1
    idle = 0
    for _ in range(max_scrolls):
        current = count_fn()
        if limit and current >= limit:
            return
        page.mouse.wheel(0, 2200)
        page.evaluate(
            """() => {
              const root = document.scrollingElement;
              if (root) root.scrollBy(0, 2200);
              const boxes = [...document.querySelectorAll('div, section, main')]
                .filter(el => el.scrollHeight > el.clientHeight + 80)
                .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
              if (boxes[0]) boxes[0].scrollBy(0, 2200);
            }"""
        )
        page.wait_for_timeout(pause_ms)
        if current <= last:
            idle += 1
            if idle >= idle_rounds:
                return
        else:
            idle = 0
            last = current


def dump_json_from_page(page: Page) -> Any:
    return page.evaluate(
        """() => {
          const scripts = [...document.querySelectorAll('script')];
          for (const script of scripts) {
            const text = script.textContent || '';
            const marker = 'window.__INITIAL_STATE__';
            if (!text.includes(marker) && !text.includes('__INITIAL_SSR_STATE__')) continue;
            const matched = text.match(/__INITIAL(?:_SSR)?_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;?\\s*(?:window\\.|$)/);
            if (!matched) continue;
            try { return JSON.parse(matched[1]); } catch (e) {}
          }
          return null;
        }"""
    )


def pretty(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
