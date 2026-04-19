"""Document ingestion utilities for the RAG knowledge base."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
import feedparser

from . import store


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
    start = 0

    i = 0
    while i < len(words):
        word = words[i]
        # +1 for the space separator (except first word)
        additional = len(word) + (1 if current_words else 0)

        if current_chars + additional > chunk_size and current_words:
            chunks.append(" ".join(current_words))

            # Move back by ~overlap characters worth of words
            back_chars = 0
            back_count = 0
            for w in reversed(current_words):
                back_chars += len(w) + 1
                back_count += 1
                if back_chars >= overlap:
                    break

            # Restart from the overlap window
            current_words = current_words[len(current_words) - back_count:]
            current_chars = sum(len(w) for w in current_words) + max(0, len(current_words) - 1)
            continue

        current_words.append(word)
        current_chars += additional
        i += 1

    if current_words:
        chunks.append(" ".join(current_words))

    return chunks


def ingest_text(
    title: str,
    text: str,
    source_type: str = "manual",
    source_url: str = "",
) -> str:
    """Chunk and ingest plain text. Returns doc_id."""
    doc_id = _generate_doc_id()
    created_at = datetime.now(timezone.utc).isoformat()
    chunks = _chunk_text(text)
    if not chunks:
        chunks = [text] if text.strip() else []
    metadata_list = [
        {
            "doc_id": doc_id,
            "title": title,
            "source_type": source_type,
            "source_url": source_url,
            "chunk_index": i,
            "created_at": created_at,
        }
        for i in range(len(chunks))
    ]
    store.add_documents(chunks, metadata_list)
    return doc_id


async def ingest_url(url: str) -> str:
    """Fetch a URL, extract text, and ingest it. Returns doc_id."""
    async with httpx.AsyncClient() as client:
        response = await client.get(url, follow_redirects=True)
        html = response.text

    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(separator=" ", strip=True)
    title = url
    if soup.title and soup.title.string:
        title = soup.title.string.strip()

    return ingest_text(title, text, source_type="url", source_url=url)


def ingest_file(filename: str, content_bytes: bytes, mime_type: str) -> str:
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

    return ingest_text(filename, text, source_type="file")


async def ingest_feed(
    feed_url: str,
    feed_name: str,
    seen_urls: set | None = None,
) -> list[str]:
    """Parse an RSS/Atom feed and ingest new entries. Returns list of new doc_ids."""
    if seen_urls is None:
        seen_urls = set()

    parsed = feedparser.parse(feed_url)
    new_doc_ids: list[str] = []

    for entry in parsed.entries:
        link = getattr(entry, "link", None)
        if not link:
            continue
        if link in seen_urls:
            continue

        try:
            doc_id = await ingest_url(link)
        except Exception:
            # Fall back to entry summary if fetch fails
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
            title = getattr(entry, "title", link)
            if summary.strip():
                doc_id = ingest_text(title, summary, source_type="rss", source_url=link)
            else:
                continue

        seen_urls.add(link)
        new_doc_ids.append(doc_id)

    return new_doc_ids
