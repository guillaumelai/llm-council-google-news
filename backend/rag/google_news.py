"""Google News RSS search management."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

GOOGLE_NEWS_FILE = "data/google_news.json"


def _rss_url(keywords: list[str]) -> str:
    query = " ".join(keywords)
    return (
        f"https://news.google.com/rss/search"
        f"?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    )


def load_searches() -> list[dict]:
    path = Path(GOOGLE_NEWS_FILE)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_searches(searches: list[dict]) -> None:
    path = Path(GOOGLE_NEWS_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(searches, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def add_search(
    keywords: list[str],
    name: str = "",
    interval_hours: int = 24,
    lookback_days: float = 1.0,
) -> dict:
    searches = load_searches()
    auto_name = name.strip() or ", ".join(keywords)
    entry = {
        "id": str(uuid.uuid4()),
        "name": auto_name,
        "keywords": [k.strip() for k in keywords if k.strip()],
        "interval_hours": interval_hours,
        "lookback_days": lookback_days,
        "rss_url": _rss_url(keywords),
        "last_fetched": None,
        "doc_count": 0,
    }
    searches.append(entry)
    save_searches(searches)
    return entry


def update_search(
    search_id: str,
    keywords: list[str] | None = None,
    name: str | None = None,
    interval_hours: int | None = None,
    lookback_days: float | None = None,
) -> dict | None:
    searches = load_searches()
    for s in searches:
        if s["id"] == search_id:
            if keywords is not None:
                s["keywords"] = [k.strip() for k in keywords if k.strip()]
                s["rss_url"] = _rss_url(s["keywords"])
            if name is not None:
                s["name"] = name.strip() or ", ".join(s["keywords"])
            if interval_hours is not None:
                s["interval_hours"] = interval_hours
            if lookback_days is not None:
                s["lookback_days"] = lookback_days
            save_searches(searches)
            return s
    return None


def remove_search(search_id: str) -> bool:
    searches = load_searches()
    filtered = [s for s in searches if s["id"] != search_id]
    if len(filtered) == len(searches):
        return False
    save_searches(filtered)
    return True


def update_stats(search_id: str, additional_docs: int) -> None:
    searches = load_searches()
    for s in searches:
        if s["id"] == search_id:
            s["last_fetched"] = datetime.now(timezone.utc).isoformat()
            s["doc_count"] = s.get("doc_count", 0) + additional_docs
            break
    save_searches(searches)
