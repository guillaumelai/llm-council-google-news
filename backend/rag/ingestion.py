"""Document ingestion utilities for the RAG knowledge base."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
import feedparser

from . import store

# Limit concurrent summary-generation calls to avoid hammering OpenRouter
_summary_sem = asyncio.Semaphore(3)


def _generate_doc_id() -> str:
    return str(uuid.uuid4())


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split text into overlapping chunks on whitespace boundaries."""
    words = text.split()
    if not words:
        return []

    chunks = []
    current_chars = 0
    current_words: list[str] = []

    i = 0
    while i < len(words):
        word = words[i]
        additional = len(word) + (1 if current_words else 0)

        if current_chars + additional > chunk_size and current_words:
            chunks.append(" ".join(current_words))

            back_chars = 0
            back_count = 0
            for w in reversed(current_words):
                back_chars += len(w) + 1
                back_count += 1
                if back_chars >= overlap:
                    break

            current_words = current_words[len(current_words) - back_count:]
            current_chars = sum(len(w) for w in current_words) + max(0, len(current_words) - 1)
            continue

        current_words.append(word)
        current_chars += additional
        i += 1

    if current_words:
        chunks.append(" ".join(current_words))

    return chunks


async def generate_summary(title: str, text: str) -> str:
    """Generate a 2-3 sentence factual summary using a cheap LLM."""
    from ..config import OPENROUTER_API_KEY, OPENROUTER_API_URL, RAG_SUMMARY_MODEL
    if not OPENROUTER_API_KEY or not text.strip():
        return ""
    truncated = text[:3000]
    prompt = (
        "Write a 2-3 sentence factual summary of the following article. "
        "Output only the summary, no preamble.\n\n"
        f"Title: {title}\n\n{truncated}"
    )
    async with _summary_sem:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    OPENROUTER_API_URL,
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                    json={
                        "model": RAG_SUMMARY_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 150,
                    },
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            return ""


def _extract_outlet(entry: object, link: str, feed_name: str) -> str:
    """Derive the source outlet name from a feed entry."""
    # Atom entries may carry a <source> element with a title
    src = getattr(entry, "source", None)
    if src and isinstance(src, dict) and src.get("title"):
        return src["title"]
    # Google News / many aggregators format titles as "Headline - Outlet"
    title = getattr(entry, "title", "") or ""
    if " - " in title:
        candidate = title.rsplit(" - ", 1)[-1].strip()
        if 2 < len(candidate) < 60:
            return candidate
    # Fall back to domain of the article URL
    try:
        return urlparse(link).netloc.replace("www.", "")
    except Exception:
        return feed_name


def ingest_text(
    title: str,
    text: str,
    source_type: str = "manual",
    source_url: str = "",
    feed_name: str = "",
    published_date: str = "",
    source_outlet: str = "",
    keywords_matched: str = "",
    summary: str = "",
) -> str | None:
    """Chunk and ingest plain text.

    Returns doc_id on success, or None if all chunks were deduplicated.
    """
    doc_id = _generate_doc_id()
    created_at = datetime.now(timezone.utc).isoformat()
    chunks = _chunk_text(text)
    if not chunks:
        chunks = [text] if text.strip() else []
    if not chunks:
        return None
    metadata_list = [
        {
            "doc_id": doc_id,
            "title": title,
            "source_type": source_type,
            "source_url": source_url,
            "feed_name": feed_name,
            "chunk_index": i,
            "created_at": created_at,
            "published_date": published_date,
            "source_outlet": source_outlet,
            "keywords_matched": keywords_matched,
            "summary": summary,
        }
        for i in range(len(chunks))
    ]
    result = store.add_documents(chunks, metadata_list)
    if result["added"] == 0:
        return None
    return doc_id


async def ingest_url(url: str) -> str | None:
    """Fetch a URL via trafilatura, extract text, and ingest. Returns doc_id."""
    import trafilatura

    downloaded = await asyncio.to_thread(trafilatura.fetch_url, url)
    text = ""
    title = url

    if downloaded:
        text = await asyncio.to_thread(trafilatura.extract, downloaded) or ""
        soup = BeautifulSoup(downloaded, "html.parser")
        if soup.title and soup.title.string:
            title = soup.title.string.strip()

    if not text.strip():
        # Fallback: plain httpx + BS4
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, follow_redirects=True)
                soup = BeautifulSoup(resp.text, "html.parser")
                text = soup.get_text(separator=" ", strip=True)
                if soup.title and soup.title.string:
                    title = soup.title.string.strip()
        except Exception:
            pass

    if not text.strip():
        return None

    try:
        outlet = urlparse(url).netloc.replace("www.", "")
    except Exception:
        outlet = ""

    summary = await generate_summary(title, text)
    return ingest_text(
        title, text,
        source_type="url",
        source_url=url,
        source_outlet=outlet,
        summary=summary,
    )


async def ingest_file(filename: str, content_bytes: bytes, mime_type: str) -> str | None:
    """Ingest an uploaded file (PDF or plain text). Returns doc_id."""
    if mime_type == "application/pdf" or filename.lower().endswith(".pdf"):
        import io
        reader = PdfReader(io.BytesIO(content_bytes))
        pages_text = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                pages_text.append(page_text)
        text = "\n".join(pages_text)
    else:
        text = content_bytes.decode("utf-8", errors="replace")

    summary = await generate_summary(filename, text)
    return ingest_text(filename, text, source_type="file", summary=summary)


async def ingest_feed(
    feed_url: str,
    feed_name: str,
    seen_urls: set | None = None,
    keywords: list[str] | None = None,
    lookback_days: float = 1.0,
) -> dict:
    """Parse an RSS/Atom feed and ingest entries matching keyword and date filters.

    Returns a dict with ingestion statistics.
    """
    if seen_urls is None:
        seen_urls = set()

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    kw_lower = [k.lower() for k in (keywords or []) if k.strip()]

    parsed = feedparser.parse(feed_url)
    new_doc_ids: list[str] = []
    articles: list[dict] = []
    skipped_seen = skipped_date = skipped_keyword = skipped_no_content = skipped_similar = 0

    for entry in parsed.entries:
        link = getattr(entry, "link", None) or getattr(entry, "id", None)
        if not link or link in seen_urls:
            skipped_seen += 1
            continue

        published = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        entry_dt: datetime | None = None
        if published is not None:
            entry_dt = datetime.fromtimestamp(time.mktime(published), tz=timezone.utc)
            if entry_dt < cutoff:
                skipped_date += 1
                continue

        title = getattr(entry, "title", link)

        raw_content = ""
        if hasattr(entry, "content") and entry.content:
            raw_content = entry.content[0].get("value", "")
        if not raw_content:
            raw_content = getattr(entry, "summary", "") or getattr(entry, "description", "")

        if raw_content:
            soup = BeautifulSoup(raw_content, "html.parser")
            raw_content = soup.get_text(separator=" ", strip=True)

        if not raw_content.strip():
            skipped_no_content += 1
            continue

        if kw_lower:
            haystack = (title + " " + raw_content + " " + (link or "")).lower()
            if not any(kw in haystack for kw in kw_lower):
                skipped_keyword += 1
                continue
            matched_kws = [kw for kw in kw_lower if kw in haystack]
            keywords_matched_str = ", ".join(matched_kws)
        else:
            keywords_matched_str = ""

        published_date_str = entry_dt.isoformat() if entry_dt else ""
        source_outlet = _extract_outlet(entry, link, feed_name)
        summary = await generate_summary(title, raw_content)

        doc_id = ingest_text(
            title, raw_content,
            source_type="rss",
            source_url=link,
            feed_name=feed_name,
            published_date=published_date_str,
            source_outlet=source_outlet,
            keywords_matched=keywords_matched_str,
            summary=summary,
        )
        seen_urls.add(link)
        if doc_id is None:
            skipped_similar += 1
        else:
            new_doc_ids.append(doc_id)
            articles.append({"title": title, "url": link})

    return {
        "doc_ids": new_doc_ids,
        "total_entries": len(parsed.entries),
        "ingested": len(new_doc_ids),
        "skipped_seen": skipped_seen,
        "skipped_date": skipped_date,
        "skipped_keyword": skipped_keyword,
        "skipped_no_content": skipped_no_content,
        "skipped_similar": skipped_similar,
        "articles": articles,
        "search_mode": "rss",
    }
