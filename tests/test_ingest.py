from favorites_digest.ingest import ingest_douyin, ingest_xiaohongshu
from favorites_digest.topics import classify
from favorites_digest.models import FavoriteItem
from favorites_digest.export import save_markdown


def test_ingest_xiaohongshu_note_card():
    payload = {
        "data": {
            "notes": [
                {
                    "id": "64f0a1b2c3d4e5f678901234",
                    "xsec_token": "tok",
                    "note_card": {
                        "display_title": "周末探店 #美食",
                        "type": "normal",
                        "user": {"nickname": "阿菜"},
                        "desc": "推荐一家面馆",
                    },
                }
            ]
        }
    }
    items = ingest_xiaohongshu(payload)
    assert len(items) == 1
    assert items[0].title == "周末探店 #美食"
    assert items[0].author == "阿菜"
    assert "美食" in items[0].tags
    assert "xsec_token=tok" in items[0].url


def test_ingest_douyin_aweme_list():
    payload = {
        "aweme_list": [
            {
                "aweme_id": "7322323500700601640",
                "desc": "面试复盘 #求职",
                "author": {"nickname": "HR笔记"},
                "share_url": "https://www.douyin.com/video/7322323500700601640",
                "statistics": {"digg_count": 12},
            }
        ]
    }
    items = ingest_douyin(payload)
    assert items[0].item_id == "7322323500700601640"
    assert items[0].author == "HR笔记"


def test_classify_and_markdown(tmp_path):
    items = [
        FavoriteItem("xiaohongshu", "a" * 24, "秋招面试经验", "https://example.com/a", "小明"),
        FavoriteItem("douyin", "1234567890123456", "探店火锅", "https://example.com/b", "小红"),
    ]
    grouped = classify(items)
    assert "求职 / 职场" in grouped
    assert "美食" in grouped
    from favorites_digest.models import CollectionResult

    path = save_markdown(
        [CollectionResult("xiaohongshu", "t", items[:1]), CollectionResult("douyin", "t", items[1:])],
        path=tmp_path / "out.md",
    )
    text = path.read_text(encoding="utf-8")
    assert "秋招面试经验" in text
    assert "探店火锅" in text
