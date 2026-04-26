"""APScheduler-based periodic Google News refresh scheduler."""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from . import store as _store
from . import log as _log

scheduler = AsyncIOScheduler()


async def refresh_google_news_search(search: dict) -> None:
    """Refresh a single Google News keyword search."""
    from . import google_news as _gn
    from .ingestion import ingest_feed

    all_docs = _store.list_documents()
    seen_urls: set[str] = set()
    for doc in all_docs:
        if doc.get("source_type") in ("rss", "url") and doc.get("source_url"):
            seen_urls.add(doc["source_url"])

    rss_url = _gn._rss_url(search["keywords"])
    lookback_days = search.get("lookback_days", 1.0)

    result = await ingest_feed(
        rss_url, search["name"], seen_urls,
        keywords=search.get("keywords"),
        lookback_days=lookback_days,
    )
    result["search_mode"] = "google_news"

    _gn.update_stats(search["id"], result["ingested"])
    _log.log_feed_refresh(search["name"], rss_url, search["keywords"], lookback_days, result)


async def refresh_all_google_news(search_id: str | None = None) -> None:
    """Refresh all Google News searches, or only the one with the given ID."""
    from . import google_news as _gn
    searches = _gn.load_searches()
    if search_id is not None:
        searches = [s for s in searches if s["id"] == search_id]
    for search in searches:
        await refresh_google_news_search(search)


def start_scheduler() -> None:
    """Schedule Google News searches for periodic refresh, then start."""
    from . import google_news as _gn
    for search in _gn.load_searches():
        interval_hours = search.get("interval_hours", 24)
        scheduler.add_job(
            refresh_google_news_search,
            trigger="interval",
            hours=interval_hours,
            args=[search],
            id=f"gn_{search['id']}",
            replace_existing=True,
        )
    scheduler.start()


def stop_scheduler() -> None:
    """Shut down the scheduler."""
    scheduler.shutdown()
