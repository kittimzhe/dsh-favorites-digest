from __future__ import annotations

from pathlib import Path
from typing import Any

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PROFILE_DIR = ROOT / "data" / "profile"


def launch_context(
    playwright: Playwright,
    *,
    cdp_url: str | None = None,
    headless: bool = False,
) -> tuple[BrowserContext, Any]:
    """Open a persistent Chromium profile, or attach to an already-running Chrome.

    Attach mode: start Chrome yourself with
    `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`
    then pass `--cdp-url http://127.0.0.1:9222`.
    """
    if cdp_url:
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        return context, browser

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    launch_kwargs: dict[str, Any] = {
        "user_data_dir": str(PROFILE_DIR),
        "headless": headless,
        "viewport": {"width": 1440, "height": 960},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "args": ["--disable-blink-features=AutomationControlled"],
    }
    try:
        context = playwright.chromium.launch_persistent_context(channel="chrome", **launch_kwargs)
    except Exception:
        context = playwright.chromium.launch_persistent_context(**launch_kwargs)
    return context, None


class Session:
    def __init__(self, cdp_url: str | None = None, headless: bool = False) -> None:
        self.cdp_url = cdp_url
        self.headless = headless
        self._pw: Playwright | None = None
        self.context: BrowserContext | None = None
        self._external_browser: Any = None

    def __enter__(self) -> Session:
        self._pw = sync_playwright().start()
        self.context, self._external_browser = launch_context(
            self._pw, cdp_url=self.cdp_url, headless=self.headless
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.context and not self.cdp_url:
            self.context.close()
        if self._pw:
            self._pw.stop()

    def page(self) -> Page:
        assert self.context is not None
        for existing in self.context.pages:
            if existing.url and existing.url != "about:blank":
                return existing
        if self.context.pages:
            return self.context.pages[0]
        return self.context.new_page()


def wait_for_enter(prompt: str) -> None:
    try:
        input(prompt)
    except EOFError:
        pass
