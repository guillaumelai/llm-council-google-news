"""Append-only retrieval log for feed refresh activity."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

LOG_FILE = "data/retrieval_log.jsonl"


def append_entry(entry: dict) -> None:
    path = Path(LOG_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def load_entries(limit: int = 200) -> list[dict]:
    """Return the most recent `limit` log entries, newest first."""
    path = Path(LOG_FILE)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    entries = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(entries) >= limit:
            break
    return entries


def log_feed_refresh(
    feed_name: str,
    feed_url: str,
    keywords: list[str],
    lookback_days: float,
    stats: dict,
) -> None:
    append_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "feed_name": feed_name,
        "feed_url": feed_url,
        "keywords": keywords,
        "lookback_days": lookback_days,
        "total_entries": stats.get("total_entries", 0),
        "ingested": stats.get("ingested", 0),
        "skipped_seen": stats.get("skipped_seen", 0),
        "skipped_date": stats.get("skipped_date", 0),
        "skipped_keyword": stats.get("skipped_keyword", 0),
        "skipped_no_content": stats.get("skipped_no_content", 0),
        "skipped_similar": stats.get("skipped_similar", 0),
        "articles": stats.get("articles", []),
        "search_mode": stats.get("search_mode", "rss"),
    })
