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


def _format_rag_context(results: list[dict]) -> tuple[str, list[dict]]:
    """Format query results into context string and sources list."""
    lines = []
    sources = []
    for i, result in enumerate(results, start=1):
        content = result.get("content", "")
        meta = result.get("metadata", {})
        title = meta.get("title", "")
        lines.append(f"{i}. Title: {title}\n{content}")
        sources.append({
            "title": title,
            "source_type": meta.get("source_type", ""),
            "source_url": meta.get("source_url", ""),
            "excerpt": content[:200],
        })
    context_str = "\n\n".join(lines)
    return context_str, sources


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
                rag_context, sources_list = _format_rag_context(results)
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
    rag_store.delete_document(doc_id)
    return {"status": "deleted"}


class IngestTextRequest(BaseModel):
    title: str
    text: str


@app.post("/api/knowledge/text")
async def ingest_text_endpoint(body: IngestTextRequest):
    """Ingest plain text into the knowledge base."""
    from .rag.ingestion import ingest_text
    doc_id = ingest_text(body.title, body.text)
    return {"doc_id": doc_id}


class IngestUrlRequest(BaseModel):
    url: str


@app.post("/api/knowledge/url")
async def ingest_url_endpoint(body: IngestUrlRequest):
    """Fetch and ingest a URL into the knowledge base."""
    from .rag.ingestion import ingest_url
    doc_id = await ingest_url(body.url)
    return {"doc_id": doc_id}


@app.post("/api/knowledge/file")
async def ingest_file_endpoint(file: UploadFile = File(...)):
    """Ingest an uploaded file (PDF or plain text) into the knowledge base."""
    from .rag.ingestion import ingest_file
    content_bytes = await file.read()
    mime_type = file.content_type or ""
    doc_id = ingest_file(file.filename or "", content_bytes, mime_type)
    return {"doc_id": doc_id}


@app.get("/api/knowledge/feeds")
async def list_feeds():
    """List all configured RSS/Atom feeds."""
    from .rag import feeds as rag_feeds
    return rag_feeds.load_feeds()


class AddFeedRequest(BaseModel):
    url: str
    name: str
    interval_hours: int = 1


@app.post("/api/knowledge/feeds")
async def add_feed_endpoint(body: AddFeedRequest):
    """Add a new RSS/Atom feed to the knowledge base."""
    from .rag import feeds as rag_feeds
    feed = rag_feeds.add_feed(body.url, body.name, body.interval_hours)
    return feed


@app.delete("/api/knowledge/feeds/{feed_url:path}")
async def delete_feed_endpoint(feed_url: str):
    """Remove a feed by URL (URL-encoded)."""
    from .rag import feeds as rag_feeds
    decoded_url = unquote(feed_url)
    removed = rag_feeds.remove_feed(decoded_url)
    if not removed:
        raise HTTPException(status_code=404, detail="Feed not found")
    return {"status": "deleted"}


class RefreshFeedRequest(BaseModel):
    url: Optional[str] = None


@app.post("/api/knowledge/feeds/refresh")
async def refresh_feeds_endpoint(body: RefreshFeedRequest):
    """Trigger an immediate refresh of all feeds, or a specific feed by URL."""
    from .rag import scheduler as rag_scheduler
    await rag_scheduler.refresh_all_feeds(body.url)
    return {"status": "refreshed"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
