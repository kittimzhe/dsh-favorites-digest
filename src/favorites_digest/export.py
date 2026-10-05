from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from .models import CollectionResult
from .topics import classify

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output"


def save_json(results: list[CollectionResult], path: Path | None = None) -> Path:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = path or OUTPUT / f"favorites-{_stamp()}.json"
    payload = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platforms": [result.to_dict() for result in results],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def save_markdown(
    results: list[CollectionResult],
    digest: str | None = None,
    path: Path | None = None,
) -> Path:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = path or OUTPUT / f"favorites-{_stamp()}.md"
    items = [item for result in results for item in result.items]
    grouped = classify(items)
    lines = [
        f"# 收藏摘要 {datetime.now().strftime('%Y-%m-%d')}",
        "",
        "## 总览",
    ]
    for result in results:
        name = "小红书" if result.platform == "xiaohongshu" else "抖音"
        lines.append(f"- {name}：{len(result.items)} 条")
        for warning in result.warnings:
            lines.append(f"  - 注意：{warning}")
    lines += ["", "## 主题分组"]
    for topic, grouped_items in grouped.items():
        lines.append(f"### {topic}（{len(grouped_items)}）")
        for item in grouped_items[:80]:
            author = f" · {item.author}" if item.author else ""
            lines.append(f"- [{item.title}]({item.url}){author}")
        if len(grouped_items) > 80:
            lines.append(f"- … 另有 {len(grouped_items) - 80} 条")
        lines.append("")
    if digest:
        lines += ["## AI 综述", "", digest.strip(), ""]
    lines += ["## 完整清单"]
    for result in results:
        name = "小红书" if result.platform == "xiaohongshu" else "抖音"
        lines.append(f"### {name}")
        if not result.items:
            lines.append("（空）")
            continue
        for item in result.items:
            author = f" @{item.author}" if item.author else ""
            lines.append(f"- [{item.title}]({item.url}){author}")
        lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M")
