from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from .models import CollectionResult
from .topics import classify


def maybe_summarize(results: list[CollectionResult]) -> str | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    items = [item for result in results for item in result.items]
    grouped = classify(items)
    catalog = []
    for topic, grouped_items in grouped.items():
        catalog.append(
            {
                "topic": topic,
                "count": len(grouped_items),
                "samples": [
                    {"title": item.title, "author": item.author, "platform": item.platform}
                    for item in grouped_items[:25]
                ],
            }
        )
    prompt = (
        "下面是用户自己从抖音和小红书导出的收藏目录（仅标题与作者）。"
        "请用中文写一份可读的收藏综述：1）整体兴趣画像 2）按主题归纳 3）值得优先回看的 8-12 条。"
        "不要编造目录里没有的标题。输出 Markdown 小节即可。\n\n"
        + json.dumps(catalog, ensure_ascii=False)
    )
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是克制、准确的中文编辑，只基于给定目录总结。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        return f"（AI 综述调用失败：{exc}）"
    return payload["choices"][0]["message"]["content"]
