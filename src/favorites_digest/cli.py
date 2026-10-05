from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from .browser import Session, wait_for_enter
from .collectors.douyin import DOUYIN_HOME, collect_douyin
from .collectors.xiaohongshu import XHS_HOME, collect_xiaohongshu
from .export import OUTPUT, save_json, save_markdown
from .models import CollectionResult, FavoriteItem
from .summarize import maybe_summarize

ROOT = Path(__file__).resolve().parents[2]


def main(argv: list[str] | None = None) -> int:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(
        description="把已登录的抖音 / 小红书 web 收藏导出并总结成 Markdown。"
    )
    parser.add_argument(
        "command",
        choices=["login", "collect", "digest", "run"],
        help="login=扫码登录并保持会话；collect=抓取收藏；digest=把已有 JSON 写成文档；run=抓取+总结",
    )
    parser.add_argument("--platform", choices=["all", "douyin", "xiaohongshu"], default="all")
    parser.add_argument("--limit", type=int, default=0, help="每个平台最多条数，0 表示尽量全部")
    parser.add_argument("--likes", action="store_true", help="抖音同时导出「喜欢」")
    parser.add_argument("--cdp-url", default="", help="连接到已开启远程调试的 Chrome，例如 http://127.0.0.1:9222")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--input", default="", help="digest 使用的 JSON 路径")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    limit = args.limit or None
    cdp = args.cdp_url or None

    if args.command == "login":
        return cmd_login(args.platform, cdp, args.headless)
    if args.command == "digest":
        return cmd_digest(args.input, not args.no_llm)
    return cmd_collect(
        platforms=_platforms(args.platform),
        limit=limit,
        likes=args.likes,
        cdp_url=cdp,
        headless=args.headless,
        with_llm=not args.no_llm,
        digest_after=args.command == "run",
    )


def _platforms(name: str) -> list[str]:
    if name == "all":
        return ["xiaohongshu", "douyin"]
    return [name]


def cmd_login(platform: str, cdp_url: str | None, headless: bool) -> int:
    with Session(cdp_url=cdp_url, headless=headless) as session:
        page = session.page()
        if platform in ("all", "xiaohongshu"):
            page.goto(XHS_HOME, wait_until="domcontentloaded")
            wait_for_enter("请在浏览器中完成小红书登录，然后回到终端按回车…")
        if platform in ("all", "douyin"):
            page = session.context.new_page() if session.context and platform == "all" else page
            page.goto(DOUYIN_HOME, wait_until="domcontentloaded")
            wait_for_enter("请在浏览器中完成抖音登录，然后回到终端按回车…")
        print(f"登录会话已保存在 {ROOT / 'data' / 'profile'}")
    return 0


def cmd_collect(
    *,
    platforms: list[str],
    limit: int | None,
    likes: bool,
    cdp_url: str | None,
    headless: bool,
    with_llm: bool,
    digest_after: bool,
) -> int:
    results: list[CollectionResult] = []
    with Session(cdp_url=cdp_url, headless=headless) as session:
        page = session.page()
        if "xiaohongshu" in platforms:
            print("正在读取小红书收藏…")
            results.append(collect_xiaohongshu(page, limit=limit))
        if "douyin" in platforms:
            print("正在读取抖音收藏…")
            page = session.context.new_page() if session.context else page
            results.append(collect_douyin(page, include_likes=likes, limit=limit))
    json_path = save_json(results)
    print(f"JSON 已写入 {json_path}")
    for result in results:
        print(f"- {result.platform}: {len(result.items)} 条")
        for warning in result.warnings:
            print(f"  ! {warning}")
    if digest_after:
        _write_digest(results, with_llm)
    return 0


def cmd_digest(input_path: str, with_llm: bool) -> int:
    path = Path(input_path) if input_path else _latest_json()
    if not path or not path.exists():
        print("找不到收藏 JSON，请先运行 collect / run。")
        return 1
    payload = json.loads(path.read_text(encoding="utf-8"))
    results = [
        CollectionResult(
            platform=block["platform"],
            collected_at=block.get("collected_at", ""),
            items=[FavoriteItem(**item) for item in block.get("items", [])],
            warnings=block.get("warnings", []),
        )
        for block in payload.get("platforms", [])
    ]
    _write_digest(results, with_llm)
    return 0


def _write_digest(results: list[CollectionResult], with_llm: bool) -> None:
    digest = maybe_summarize(results) if with_llm else None
    md_path = save_markdown(results, digest=digest)
    print(f"文档已写入 {md_path}")


def _latest_json() -> Path | None:
    files = sorted(OUTPUT.glob("favorites-*.json"))
    return files[-1] if files else None


if __name__ == "__main__":
    raise SystemExit(main())
