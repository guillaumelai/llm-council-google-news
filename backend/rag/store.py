"""ChromaDB persistent store for RAG knowledge base."""

from __future__ import annotations

import chromadb
from ..config import RAG_CHROMA_DIR
from . import embedder as _embedder


class _EmbeddingFunction:
    """ChromaDB-compatible embedding function wrapping our embedder."""

    def __call__(self, input: list[str]) -> list[list[float]]:
        return _embedder.embed(input)


_client: chromadb.PersistentClient | None = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=RAG_CHROMA_DIR)
        _collection = _client.get_or_create_collection(
            name="knowledge_base",
            embedding_function=_EmbeddingFunction(),
        )
    return _collection


def add_documents(chunks: list[str], metadata_list: list[dict]) -> None:
    """Embed and upsert chunks into the collection."""
    collection = _get_collection()
    if not chunks or not metadata_list:
        return
    doc_id = metadata_list[0]["doc_id"]
    ids = [f"{doc_id}-chunk-{i}" for i in range(len(chunks))]
    collection.upsert(
        ids=ids,
        documents=chunks,
        metadatas=metadata_list,
    )


def query(text: str, n_results: int = 5) -> list[dict]:
    """Query the collection for similar chunks."""
    collection = _get_collection()
    results = collection.query(
        query_texts=[text],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )
    output = []
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    for doc, meta, dist in zip(documents, metadatas, distances):
        output.append({"content": doc, "metadata": meta, "distance": dist})
    return output


def delete_document(doc_id: str) -> bool:
    """Delete all chunks belonging to a document. Returns True if found and deleted."""
    collection = _get_collection()
    results = collection.get(
        where={"doc_id": doc_id},
        include=["metadatas"],
    )
    ids = results.get("ids", [])
    if ids:
        collection.delete(ids=ids)
        return True
    return False


def get_document_chunks(doc_id: str) -> dict | None:
    """Return all chunks and metadata for a given doc_id, or None if not found."""
    collection = _get_collection()
    results = collection.get(
        where={"doc_id": doc_id},
        include=["documents", "metadatas"],
    )
    if not results["ids"]:
        return None
    meta = results["metadatas"][0]
    return {
        "doc_id": doc_id,
        "title": meta.get("title", ""),
        "source_type": meta.get("source_type", ""),
        "source_url": meta.get("source_url", ""),
        "created_at": meta.get("created_at", ""),
        "chunks": results["documents"],
    }


def list_documents() -> list[dict]:
    """Return a deduplicated list of ingested documents with chunk counts."""
    collection = _get_collection()
    results = collection.get(include=["metadatas"])
    metadatas = results.get("metadatas") or []

    seen: dict[str, dict] = {}
    for meta in metadatas:
        doc_id = meta.get("doc_id", "")
        if doc_id not in seen:
            seen[doc_id] = {
                "doc_id": doc_id,
                "title": meta.get("title", ""),
                "source_type": meta.get("source_type", ""),
                "source_url": meta.get("source_url", ""),
                "created_at": meta.get("created_at", ""),
                "chunk_count": 1,
            }
        else:
            seen[doc_id]["chunk_count"] += 1

    return list(seen.values())
