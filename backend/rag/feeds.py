"""Feed management: persist RSS/Atom feed configurations to JSON."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from ..config import RAG_FEEDS_FILE


def load_feeds() -> list[dict]:
    """Load feeds from the JSON file. Returns empty list if file not found."""
    path = Path(RAG_FEEDS_FILE)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_feeds(feeds: list[dict]) -> None:
    """Write feeds list to the JSON file, creating parent directories as needed."""
    path = Path(RAG_FEEDS_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(feeds, f, indent=2)


def add_feed(url: str, name: str, interval_hours: int = 1) -> dict:
    """Append a new feed entry, save, and return the new feed dict."""
    feeds = load_feeds()
    new_feed = {
        "url": url,
        "name": name,
        "interval_hours": interval_hours,
        "last_fetched": None,
        "doc_count": 0,
    }
    feeds.append(new_feed)
    save_feeds(feeds)
    return new_feed


def remove_feed(url: str) -> bool:
    """Remove feed by URL. Returns True if a feed was removed."""
    feeds = load_feeds()
    original_len = len(feeds)
    feeds = [f for f in feeds if f["url"] != url]
    if len(feeds) < original_len:
        save_feeds(feeds)
        return True
    return False


def update_feed_stats(url: str, doc_count: int) -> None:
    """Update last_fetched timestamp and doc_count for the matching feed."""
    feeds = load_feeds()
    now = datetime.now(timezone.utc).isoformat()
    for feed in feeds:
        if feed["url"] == url:
            feed["last_fetched"] = now
            feed["doc_count"] = doc_count
            break
    save_feeds(feeds)
