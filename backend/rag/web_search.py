"""Website search scraping for keyword-driven article discovery."""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from urllib.parse import urljoin, urlparse, quote_plus, parse_qs, unquote

import httpx
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

SEARCH_PATTERNS = [
    "{base}/search?q={query}",
    "{base}/?s={query}",
    "{base}/?q={query}",
    "{base}/search?query={query}",
    "{base}/search?term={query}",
    "{base}/search/{query}",
    "{base}/search?keyword={query}",
]

ARTICLE_EXCLUDES = [
    "/tag/", "/category/", "/author/", "/page/", "/feed", "/rss",
    "/login", "/register", "/about", "/contact", "/privacy",
    "/search", "/sitemap", "javascript:", "#",
]


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


async def _fetch(client: httpx.AsyncClient, url: str) -> tuple[str | None, int]:
    """Returns (html, status_code). html is None on network error."""
    try:
        r = await client.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        if r.status_code == 200:
            return r.text, 200
        return None, r.status_code
    except Exception:
        return None, 0


def _ddg_date_param(lookback_days: float) -> str:
    if lookback_days <= 1:
        return "d"
    elif lookback_days <= 7:
        return "w"
    elif lookback_days <= 30:
        return "m"
    return "y"


def _extract_ddg_url(href: str) -> str | None:
    """Unwrap a DuckDuckGo redirect href to the real target URL."""
    if not href:
        return None
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc:
        params = parse_qs(parsed.query)
        uddg = params.get("uddg", [""])[0]
        return unquote(uddg) if uddg else None
    return href


async def _ddg_site_search(
    origin: str,
    keywords: list[str],
    lookback_days: float,
    client: httpx.AsyncClient,
) -> list[dict]:
    """
    Use DuckDuckGo HTML to find site-specific articles matching keywords.
    Returns list of {url, title, snippet}.
    DDG's date filter is applied at the search level; exact date filtering
    happens later when we fetch individual articles.
    """
    domain = urlparse(origin).netloc
    query = f"site:{domain} {' '.join(keywords)}"
    df = _ddg_date_param(lookback_days)
    ddg_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}&df={df}"

    html, _ = await _fetch(client, ddg_url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    for div in soup.select(".web-result"):
        a = div.select_one(".result__a")
        snippet_el = div.select_one(".result__snippet")
        if not a:
            continue
        real_url = _extract_ddg_url(a.get("href", ""))
        if not real_url:
            continue
        # Accept any URL from the target domain, even if it doesn't pass the
        # article heuristic — DDG already filtered for relevance.
        parsed = urlparse(real_url)
        if urlparse(origin).netloc not in parsed.netloc:
            continue
        title = a.get_text(strip=True)
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        results.append({"url": real_url, "title": title, "snippet": snippet})

    return results


def _find_search_endpoint(html: str, page_url: str) -> tuple[str, str] | None:
    """Scan page HTML for a search form. Returns (action_url, query_param) or None."""
    soup = BeautifulSoup(html, "html.parser")
    candidates: list = []
    for el in soup.find_all(attrs={"role": "search"}):
        form = el if el.name == "form" else el.find("form")
        if form and form not in candidates:
            candidates.insert(0, form)
    for form in soup.find_all("form"):
        if form not in candidates:
            candidates.append(form)
    for form in candidates:
        for inp in form.find_all("input"):
            itype = (inp.get("type") or "text").lower()
            iname = (inp.get("name") or "").lower()
            if itype in ("search", "text") or any(
                w in iname for w in ("q", "query", "search", "term", "keyword", "s")
            ):
                action = form.get("action") or page_url
                action_url = urljoin(page_url, action).split("?")[0]
                param = inp.get("name") or "q"
                return action_url, param
    return None


def _parse_date(s: str) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[: len(fmt)], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def _extract_article_date(soup: BeautifulSoup) -> datetime | None:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, list):
                data = data[0] if data else {}
            for key in ("datePublished", "dateCreated", "dateModified"):
                val = data.get(key)
                if val:
                    dt = _parse_date(str(val))
                    if dt:
                        return dt
        except Exception:
            pass
    for prop in (
        "article:published_time", "article:published",
        "og:article:published_time", "pubdate", "date", "DC.date",
    ):
        meta = soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})
        if meta:
            dt = _parse_date(meta.get("content", ""))
            if dt:
                return dt
    for t in soup.find_all("time"):
        dt = _parse_date(t.get("datetime", ""))
        if dt:
            return dt
    return None


def _is_article_url(url: str, origin: str) -> bool:
    parsed = urlparse(url)
    if urlparse(origin).netloc not in parsed.netloc:
        return False
    if any(e in url for e in ARTICLE_EXCLUDES):
        return False
    return len([s for s in parsed.path.split("/") if s]) >= 2


def _extract_links_from_results(html: str, origin: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    seen: set[str] = set()
    results: list[dict] = []

    def add(href: str, title: str) -> None:
        full = urljoin(origin, href)
        if full not in seen and _is_article_url(full, origin) and title.strip():
            seen.add(full)
            results.append({"url": full, "title": title.strip()[:200], "snippet": ""})

    for art in soup.find_all("article"):
        link = art.find("a", href=True)
        if link:
            heading = art.find(["h1", "h2", "h3", "h4"])
            add(link["href"], (heading or link).get_text(strip=True))
    for tag in soup.find_all(["h2", "h3", "h4"]):
        a = tag.find("a", href=True)
        if a:
            add(a["href"], tag.get_text(strip=True))
    if len(results) < 3:
        for a in soup.find_all("a", href=True):
            text = a.get_text(strip=True)
            if len(text) > 30:
                add(a["href"], text)
    return results[:60]


def _extract_article_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()
    for sel in [
        "article", "main", '[role="main"]',
        ".article-body", ".post-content", ".entry-content",
        ".article-content", ".story-body", ".post-body",
    ]:
        el = soup.select_one(sel)
        if el:
            return el.get_text(separator="\n", strip=True)
    body = soup.find("body")
    return (body or soup).get_text(separator="\n", strip=True)


def _extract_page_title(soup: BeautifulSoup) -> str | None:
    meta = soup.find("meta", property="og:title")
    if meta and meta.get("content"):
        return meta["content"].strip()
    t = soup.find("title")
    if t:
        return t.get_text(strip=True)
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    return None


async def search_website_and_ingest(
    website_url: str,
    feed_name: str,
    keywords: list[str],
    lookback_days: float,
    seen_urls: set[str],
) -> dict:
    """
    Search a website for articles matching keywords within lookback_days.

    Strategy:
    1. Try the site's own search endpoint (works for open sites).
    2. Fall back to DuckDuckGo site: search (works for sites that block scrapers).
    3. For each candidate: fetch the full article if possible; if blocked (4xx),
       use the DuckDuckGo snippet as content so we still get something useful.
    4. Apply exact date filtering when we can fetch the article; otherwise rely
       on DuckDuckGo's coarse date filter (&df=d/w/m/y).

    Returns stats dict matching ingest_feed's shape plus 'articles' and 'search_mode'.
    """
    from .ingestion import ingest_text

    stats: dict = {
        "doc_ids": [],
        "total_entries": 0,
        "ingested": 0,
        "skipped_seen": 0,
        "skipped_date": 0,
        "skipped_keyword": 0,
        "skipped_no_content": 0,
        "articles": [],
        "search_mode": "website",
    }

    if not keywords:
        return stats

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    origin = _origin(website_url)
    query = " ".join(keywords)

    async with httpx.AsyncClient() as client:
        # ── Step 1: try the site's own search ─────────────────────────────────
        candidates: list[dict] = []
        search_url: str | None = None

        homepage_html, hp_status = await _fetch(client, website_url)
        if homepage_html:
            found = _find_search_endpoint(homepage_html, website_url)
            if found:
                action_url, param = found
                search_url = f"{action_url}?{param}={quote_plus(query)}"

        if not search_url:
            for pattern in SEARCH_PATTERNS:
                candidate_url = pattern.format(base=origin, query=quote_plus(query))
                html, status = await _fetch(client, candidate_url)
                if html and len(html) > 2000:
                    soup_check = BeautifulSoup(html, "html.parser")
                    if len(soup_check.find_all("a", href=True)) > 8:
                        search_url = candidate_url
                        break

        if search_url:
            results_html, _ = await _fetch(client, search_url)
            if results_html:
                candidates = _extract_links_from_results(results_html, origin)

        # ── Step 2: fall back to DuckDuckGo if site search yielded nothing ────
        if not candidates:
            candidates = await _ddg_site_search(origin, keywords, lookback_days, client)
            if candidates:
                stats["search_mode"] = "ddg"

        stats["total_entries"] = len(candidates)
        if not candidates:
            return stats

        # ── Step 3: fetch each article, date-check, ingest ────────────────────
        for cand in candidates:
            url = cand["url"]
            fallback_title = cand["title"]
            ddg_snippet = cand.get("snippet", "")

            if url in seen_urls:
                stats["skipped_seen"] += 1
                continue

            # Try to fetch the full article
            art_html, art_status = await _fetch(client, url)

            if art_html:
                art_soup = BeautifulSoup(art_html, "html.parser")
                pub_date = _extract_article_date(art_soup)
                if pub_date is not None and pub_date < cutoff:
                    stats["skipped_date"] += 1
                    continue
                text = _extract_article_text(art_soup)
                title = _extract_page_title(art_soup) or fallback_title
            else:
                # Site blocked the fetch — use the DDG snippet as content.
                # The DDG date filter already filtered by lookback, so skip
                # exact date check here (we can't get it anyway).
                text = ddg_snippet
                title = fallback_title

            if not text or len(text.strip()) < 50:
                stats["skipped_no_content"] += 1
                continue

            doc_id = ingest_text(title, text, source_type="rss", source_url=url)
            seen_urls.add(url)
            stats["doc_ids"].append(doc_id)
            stats["ingested"] += 1
            stats["articles"].append({"title": title, "url": url})

    return stats
