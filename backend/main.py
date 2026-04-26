"""FastAPI backend for LLM Council."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
from urllib.parse import unquote

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from .config import RAG_TOP_K


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .rag.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="LLM Council API", lifespan=lifespan)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    use_rag: bool = False


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


def _fetch_full_content(url: str) -> str:
    """Sync: fetch and extract article text via trafilatura."""
    import trafilatura
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            return trafilatura.extract(downloaded) or ""
    except Exception:
        pass
    return ""


async def _format_rag_context(results: list[dict]) -> tuple[str, list[dict]]:
    """Format query results, fetching fresh full content for URL-based docs."""

    async def _enrich(result: dict) -> tuple[str, dict]:
        meta = result.get("metadata", {})
        title = meta.get("title", "")
        source_url = meta.get("source_url", "")
        stored_content = result.get("content", "")
        summary = meta.get("summary", "")

        full_content = ""
        if source_url:
            try:
                full_content = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_full_content, source_url),
                    timeout=10.0,
                )
            except Exception:
                pass

        content = full_content or stored_content
        source = {
            "title": title,
            "source_type": meta.get("source_type", ""),
            "source_url": source_url,
            "published_date": meta.get("published_date", ""),
            "source_outlet": meta.get("source_outlet", ""),
            "keywords_matched": meta.get("keywords_matched", ""),
            "summary": summary,
            "excerpt": summary or stored_content[:300],
        }
        return f"Title: {title}\n{content}", source

    pairs = await asyncio.gather(*[_enrich(r) for r in results])
    lines = [f"{i + 1}. {line}" for i, (line, _) in enumerate(pairs)]
    sources = [src for _, src in pairs]
    return "\n\n".join(lines), sources


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted"}


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # RAG retrieval (if enabled)
            rag_context = None
            if request.use_rag:
                from .rag import store as rag_store
                results = rag_store.query(request.content, n_results=RAG_TOP_K)
                rag_context, sources_list = await _format_rag_context(results)
                yield f"data: {json.dumps({'type': 'rag_sources', 'data': sources_list})}\n\n"

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, rag_context=rag_context)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, rag_context=rag_context)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# ---------------------------------------------------------------------------
# Knowledge base endpoints
# ---------------------------------------------------------------------------

@app.get("/api/knowledge/documents")
async def list_knowledge_documents():
    """List all documents in the knowledge base."""
    from .rag import store as rag_store
    return rag_store.list_documents()


@app.get("/api/knowledge/documents/{doc_id}")
async def get_knowledge_document(doc_id: str):
    """Get full details and all chunks for a document."""
    from .rag import store as rag_store
    doc = rag_store.get_document_chunks(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@app.delete("/api/knowledge/documents/{doc_id}")
async def delete_knowledge_document(doc_id: str):
    """Delete a document from the knowledge base."""
    from .rag import store as rag_store
    deleted = rag_store.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted"}


@app.get("/api/knowledge/feeds/log")
async def get_feed_log(limit: int = 200):
    """Return the most recent feed retrieval log entries, newest first."""
    from .rag import log as rag_log
    return rag_log.load_entries(limit=limit)


# ---------------------------------------------------------------------------
# Google News endpoints
# ---------------------------------------------------------------------------

class AddGoogleNewsRequest(BaseModel):
    keywords: List[str]
    name: str = ""
    interval_hours: int = 1
    lookback_days: float = 1.0


@app.get("/api/knowledge/google-news")
async def list_google_news():
    """List all Google News keyword searches."""
    from .rag import google_news as gn
    return gn.load_searches()


@app.post("/api/knowledge/google-news")
async def add_google_news(body: AddGoogleNewsRequest):
    """Add a new Google News keyword search."""
    from .rag import google_news as gn
    return gn.add_search(body.keywords, body.name, body.interval_hours, body.lookback_days)


class UpdateGoogleNewsRequest(BaseModel):
    keywords: Optional[List[str]] = None
    name: Optional[str] = None
    interval_hours: Optional[int] = None
    lookback_days: Optional[float] = None


@app.patch("/api/knowledge/google-news/{search_id}")
async def update_google_news(search_id: str, body: UpdateGoogleNewsRequest):
    """Update an existing Google News search."""
    from .rag import google_news as gn
    updated = gn.update_search(
        search_id,
        keywords=body.keywords,
        name=body.name,
        interval_hours=body.interval_hours,
        lookback_days=body.lookback_days,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Search not found")
    return updated


@app.delete("/api/knowledge/google-news/{search_id}")
async def delete_google_news(search_id: str):
    """Remove a Google News search by ID."""
    from .rag import google_news as gn
    removed = gn.remove_search(search_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Search not found")
    return {"status": "deleted"}


class RefreshGoogleNewsRequest(BaseModel):
    id: Optional[str] = None


@app.post("/api/knowledge/google-news/refresh")
async def refresh_google_news(body: RefreshGoogleNewsRequest):
    """Trigger an immediate refresh of all Google News searches, or one by ID."""
    from .rag import scheduler as rag_scheduler
    await rag_scheduler.refresh_all_google_news(body.id)
    return {"status": "refreshed"}


@app.get("/api/knowledge/stats")
async def get_knowledge_stats():
    """Return operational statistics about the RAG knowledge base."""
    import os
    from pathlib import Path
    from collections import Counter
    from .rag import store as rag_store
    from .rag import google_news as rag_gn
    from .rag import log as rag_log
    from .config import RAG_CHROMA_DIR

    def dir_size(path: Path) -> int:
        if not path.exists():
            return 0
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    def file_size(path: Path) -> int:
        return path.stat().st_size if path.exists() else 0

    # ChromaDB paths
    chroma_path = Path(RAG_CHROMA_DIR).resolve()
    sqlite_path = chroma_path / "chroma.sqlite3"

    # Collection stats
    docs = rag_store.list_documents()
    total_chunks = sum(d.get("chunk_count", 0) for d in docs)
    source_counts = Counter(d.get("source_type", "unknown") for d in docs)

    # Activity log
    log_path = Path("data/retrieval_log.jsonl").resolve()
    log_entries = rag_log.load_entries(limit=10000)

    # Google News
    gn_searches = rag_gn.load_searches()

    # Storage breakdown (bytes)
    storage = {
        "chroma_total": dir_size(chroma_path),
        "chroma_sqlite": file_size(sqlite_path),
        "chroma_vectors": dir_size(chroma_path) - file_size(sqlite_path),
        "activity_log": file_size(log_path),
        "google_news_config": file_size(Path("data/google_news.json").resolve()),
        "conversations": dir_size(Path("data/conversations").resolve()),
    }

    return {
        "collection": {
            "total_documents": len(docs),
            "total_chunks": total_chunks,
            "avg_chunks_per_doc": round(total_chunks / len(docs), 1) if docs else 0,
            "by_source_type": dict(source_counts),
        },
        "google_news": {
            "searches": len(gn_searches),
        },
        "activity_log": {
            "path": str(log_path),
            "entry_count": len(log_entries),
            "size_bytes": storage["activity_log"],
        },
        "storage": storage,
        "paths": {
            "chroma_dir": str(chroma_path),
            "data_dir": str(Path("data").resolve()),
        },
        "embedding": {
            "model": "all-MiniLM-L6-v2",
            "dimensions": 384,
            "provider": "sentence-transformers",
        },
    }


@app.get("/api/knowledge/graph")
async def get_knowledge_graph():
    """Return PCA-projected 3D graph data for the vector database."""
    from .rag import store as rag_store
    return rag_store.get_graph_data()


@app.get("/api/knowledge/vector-index")
async def get_vector_index():
    """Return vector index config, nearest-neighbor relationships, and index file details."""
    from .rag import store as rag_store
    return rag_store.get_index_stats()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
