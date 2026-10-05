from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class FavoriteItem:
    platform: str
    item_id: str
    title: str
    url: str
    author: str = ""
    kind: str = ""
    cover: str = ""
    tags: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def key(self) -> str:
        return f"{self.platform}:{self.item_id}"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CollectionResult:
    platform: str
    collected_at: str
    items: list[FavoriteItem]
    warnings: list[str] = field(default_factory=list)
    source: str = "browser"

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "collected_at": self.collected_at,
            "item_count": len(self.items),
            "warnings": self.warnings,
            "source": self.source,
            "items": [item.to_dict() for item in self.items],
        }
