"""APScheduler-based periodic feed refresh scheduler."""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from . import feeds as _feeds
from . import store as _store
from .ingestion import ingest_feed

scheduler = AsyncIOScheduler()


async def refresh_feed(feed: dict) -> None:
    """Refresh a single feed, skipping already-ingested URLs."""
    # Build seen_urls from existing docs with matching source_url and source_type "rss"
    all_docs = _store.list_documents()
    seen_urls: set[str] = set()
    for doc in all_docs:
        if doc.get("source_type") in ("rss", "url") and doc.get("source_url"):
            seen_urls.add(doc["source_url"])

    new_doc_ids = await ingest_feed(feed["url"], feed["name"], seen_urls)

    # Compute total doc count for this feed (existing + new)
    updated_docs = _store.list_documents()
    feed_url = feed["url"]
    doc_count = sum(
        1 for d in updated_docs
        if d.get("source_url") == feed_url or d.get("source_url", "").startswith(feed_url)
    )
    _feeds.update_feed_stats(feed["url"], doc_count + len(new_doc_ids))


async def refresh_all_feeds(feed_url: str | None = None) -> None:
    """Refresh all feeds, or only the feed matching feed_url if provided."""
    all_feeds = _feeds.load_feeds()
    if feed_url is not None:
        all_feeds = [f for f in all_feeds if f["url"] == feed_url]
    for feed in all_feeds:
        await refresh_feed(feed)


def start_scheduler() -> None:
    """Load feeds and schedule periodic refresh jobs, then start the scheduler."""
    all_feeds = _feeds.load_feeds()
    for feed in all_feeds:
        interval_hours = feed.get("interval_hours", 1)
        scheduler.add_job(
            refresh_feed,
            trigger="interval",
            hours=interval_hours,
            args=[feed],
            id=f"feed_{feed['url']}",
            replace_existing=True,
        )
    scheduler.start()


def stop_scheduler() -> None:
    """Shut down the scheduler."""
    scheduler.shutdown()
