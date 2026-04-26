"""ChromaDB persistent store for RAG knowledge base."""

from __future__ import annotations

import chromadb
from ..config import RAG_CHROMA_DIR
from . import embedder as _embedder


class _EmbeddingFunction(chromadb.EmbeddingFunction[chromadb.Documents]):
    """ChromaDB-compatible embedding function wrapping our embedder."""

    def __call__(self, input: chromadb.Documents) -> chromadb.Embeddings:
        return _embedder.embed(list(input))

    @staticmethod
    def name() -> str:
        return "llm-council-minilm"

    @staticmethod
    def build_from_config(config: dict) -> "_EmbeddingFunction":
        return _EmbeddingFunction()

    def get_config(self) -> dict:
        return {}


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


SIMILARITY_THRESHOLD = 0.95


def add_documents(
    chunks: list[str],
    metadata_list: list[dict],
    similarity_threshold: float = SIMILARITY_THRESHOLD,
) -> dict:
    """Embed, deduplicate, and upsert chunks into the collection.

    Returns {"added": int, "skipped_similar": int}.
    A chunk is discarded when its cosine similarity to the nearest existing
    vector exceeds similarity_threshold (default 0.95).
    """
    collection = _get_collection()
    if not chunks or not metadata_list:
        return {"added": 0, "skipped_similar": 0}

    doc_id = metadata_list[0]["doc_id"]
    new_embeddings = _embedder.embed(chunks)

    keep_indices: list[int] = []
    skipped_similar = 0

    existing_count = collection.count()
    if existing_count > 0:
        # Batch-query all new chunk embeddings at once
        q = collection.query(
            query_embeddings=new_embeddings,
            n_results=1,
            include=["distances"],
        )
        all_distances = q.get("distances") or []
        for i, chunk_distances in enumerate(all_distances):
            if chunk_distances:
                # ChromaDB returns squared L2; cosine_sim = 1 - d/2 for unit vectors
                cosine_sim = 1.0 - chunk_distances[0] / 2.0
                if cosine_sim > similarity_threshold:
                    skipped_similar += 1
                    continue
            keep_indices.append(i)
    else:
        keep_indices = list(range(len(chunks)))

    if keep_indices:
        collection.upsert(
            ids=[f"{doc_id}-chunk-{i}" for i in keep_indices],
            documents=[chunks[i] for i in keep_indices],
            metadatas=[metadata_list[i] for i in keep_indices],
            embeddings=[new_embeddings[i] for i in keep_indices],
        )

    return {"added": len(keep_indices), "skipped_similar": skipped_similar}


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
        include=["documents", "metadatas", "embeddings"],
    )
    if not results["ids"]:
        return None
    meta = results["metadatas"][0]
    raw_embeddings = results.get("embeddings")
    embeddings = raw_embeddings if raw_embeddings is not None else []
    chunks = [
        {
            "id": chunk_id,
            "index": i,
            "text": doc,
            "metadata": chunk_meta,
            "embedding_dimensions": len(embeddings[i]) if i < len(embeddings) and embeddings[i] is not None else None,
            "embedding_preview": [float(v) for v in embeddings[i][:8]] if i < len(embeddings) and embeddings[i] is not None else None,
        }
        for i, (chunk_id, doc, chunk_meta) in enumerate(
            zip(results["ids"], results["documents"], results["metadatas"])
        )
    ]
    # Sort by chunk_index stored in metadata
    chunks.sort(key=lambda c: c["metadata"].get("chunk_index", c["index"]))
    return {
        "doc_id": doc_id,
        "title": meta.get("title", ""),
        "source_type": meta.get("source_type", ""),
        "source_url": meta.get("source_url", ""),
        "feed_name": meta.get("feed_name", ""),
        "created_at": meta.get("created_at", ""),
        "published_date": meta.get("published_date", ""),
        "source_outlet": meta.get("source_outlet", ""),
        "keywords_matched": meta.get("keywords_matched", ""),
        "summary": meta.get("summary", ""),
        "chunk_count": len(chunks),
        "embedding_model": "all-MiniLM-L6-v2",
        "embedding_dimensions": 384,
        "chunks": chunks,
    }


def get_graph_data(similarity_cutoff: float = 0.45, max_links_per_node: int = 4) -> dict:
    """Return PCA-projected 3D positions + nearest-neighbour edges for graph visualisation."""
    import numpy as np

    collection = _get_collection()
    if collection.count() == 0:
        return {"nodes": [], "links": [], "meta": {"total_nodes": 0, "total_edges": 0}}

    results = collection.get(include=["embeddings", "metadatas"])
    all_ids = results.get("ids") or []
    all_metas = results.get("metadatas") or []
    raw_embs = results.get("embeddings")
    all_embs = list(raw_embs) if raw_embs is not None else []

    # One representative chunk (lowest chunk_index) per document
    doc_rep: dict[str, dict] = {}
    for chunk_id, meta, emb in zip(all_ids, all_metas, all_embs):
        doc_id = meta.get("doc_id", "")
        if not doc_id:
            continue
        ci = meta.get("chunk_index", 0)
        if doc_id not in doc_rep or ci < doc_rep[doc_id]["ci"]:
            doc_rep[doc_id] = {
                "ci": ci,
                "embedding": np.array(emb, dtype=np.float32),
                "title": meta.get("title", ""),
                "source_type": meta.get("source_type", ""),
                "feed_name": meta.get("feed_name", ""),
                "created_at": meta.get("created_at", ""),
                "source_url": meta.get("source_url", ""),
            }

    doc_ids = list(doc_rep.keys())
    n = len(doc_ids)
    if n < 2:
        return {"nodes": [], "links": [], "meta": {"total_nodes": n, "total_edges": 0}}

    emb_matrix = np.stack([doc_rep[d]["embedding"] for d in doc_ids])  # (n, 384)

    # PCA to 3 dimensions via truncated SVD
    centered = emb_matrix - emb_matrix.mean(axis=0)
    _, S, Vt = np.linalg.svd(centered, full_matrices=False)
    coords = centered @ Vt[:3].T  # (n, 3)
    explained = (S[:3] ** 2 / (S ** 2).sum() * 100).round(1).tolist()

    # Scale to ±100 for consistent camera distance
    scale = np.abs(coords).max(axis=0)
    scale[scale == 0] = 1
    coords = coords / scale * 100

    # Cosine similarity matrix for edges
    norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
    normed = emb_matrix / np.maximum(norms, 1e-9)
    sim = normed @ normed.T  # (n, n)

    nodes = []
    for i, doc_id in enumerate(doc_ids):
        info = doc_rep[doc_id]
        nodes.append({
            "id": doc_id,
            "title": info["title"],
            "source_type": info["source_type"],
            "feed_name": info["feed_name"],
            "created_at": info["created_at"],
            "source_url": info["source_url"],
            "x": round(float(coords[i, 0]), 3),
            "y": round(float(coords[i, 1]), 3),
            "z": round(float(coords[i, 2]), 3),
        })

    # Build deduplicated edge list
    seen: set[tuple] = set()
    links = []
    for i in range(n):
        row = sim[i].copy()
        row[i] = -1
        top = row.argsort()[::-1][:max_links_per_node]
        for j in top:
            sim_val = float(sim[i][j])
            if sim_val < similarity_cutoff:
                break
            pair = (min(i, j), max(i, j))
            if pair in seen:
                continue
            seen.add(pair)
            links.append({
                "source": doc_ids[i],
                "target": doc_ids[j],
                "similarity": round(sim_val, 3),
            })

    from collections import Counter
    type_counts = Counter(doc_rep[d]["source_type"] for d in doc_ids)
    feed_counts = Counter(doc_rep[d]["feed_name"] for d in doc_ids if doc_rep[d]["feed_name"])

    return {
        "nodes": nodes,
        "links": links,
        "meta": {
            "total_nodes": n,
            "total_edges": len(links),
            "pca_explained_variance": explained,
            "by_source_type": dict(type_counts),
            "by_feed": dict(feed_counts.most_common(10)),
            "similarity_cutoff": similarity_cutoff,
        },
    }


def get_index_stats() -> dict:
    """Compute vector index overview, nearest-neighbor relationships, and index file details."""
    import numpy as np
    from pathlib import Path

    collection = _get_collection()
    count = collection.count()
    coll_meta = collection.metadata or {}

    # HNSW defaults used by ChromaDB when not explicitly configured
    hnsw_defaults = {"M": 16, "construction_ef": 100, "search_ef": 10, "space": "l2", "num_threads": 4}
    hnsw = {
        "space": coll_meta.get("hnsw:space", hnsw_defaults["space"]),
        "M": coll_meta.get("hnsw:M", hnsw_defaults["M"]),
        "construction_ef": coll_meta.get("hnsw:construction_ef", hnsw_defaults["construction_ef"]),
        "search_ef": coll_meta.get("hnsw:search_ef", hnsw_defaults["search_ef"]),
        "num_threads": coll_meta.get("hnsw:num_threads", hnsw_defaults["num_threads"]),
    }

    # Fetch all embeddings + metadata in one call
    results = collection.get(include=["embeddings", "metadatas"])
    all_ids = results.get("ids") or []
    all_metas = results.get("metadatas") or []
    raw_embs = results.get("embeddings")
    all_embs = list(raw_embs) if raw_embs is not None else []

    # Deduplicate to one representative chunk (lowest chunk_index) per document
    doc_rep: dict[str, dict] = {}
    for chunk_id, meta, emb in zip(all_ids, all_metas, all_embs):
        doc_id = meta.get("doc_id", "")
        if not doc_id:
            continue
        ci = meta.get("chunk_index", 0)
        if doc_id not in doc_rep or ci < doc_rep[doc_id]["chunk_index"]:
            doc_rep[doc_id] = {
                "chunk_index": ci,
                "embedding": emb,
                "title": meta.get("title", ""),
                "source_type": meta.get("source_type", ""),
                "feed_name": meta.get("feed_name", ""),
                "created_at": meta.get("created_at", ""),
                "source_url": meta.get("source_url", ""),
            }

    doc_ids = list(doc_rep.keys())
    nearest_neighbors: list[dict] = []

    if len(doc_ids) >= 2:
        emb_matrix = np.array([doc_rep[d]["embedding"] for d in doc_ids], dtype=np.float32)
        norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
        normed = emb_matrix / np.maximum(norms, 1e-9)
        sim = (normed @ normed.T)  # cosine similarity matrix (N x N)

        k = min(5, len(doc_ids) - 1)
        for i, doc_id in enumerate(doc_ids):
            row = sim[i].copy()
            row[i] = -1  # exclude self
            top_indices = row.argsort()[::-1][:k]
            nearest_neighbors.append({
                "doc_id": doc_id,
                "title": doc_rep[doc_id]["title"],
                "source_type": doc_rep[doc_id]["source_type"],
                "feed_name": doc_rep[doc_id]["feed_name"],
                "created_at": doc_rep[doc_id]["created_at"],
                "neighbors": [
                    {
                        "doc_id": doc_ids[j],
                        "title": doc_rep[doc_ids[j]]["title"],
                        "source_type": doc_rep[doc_ids[j]]["source_type"],
                        "feed_name": doc_rep[doc_ids[j]]["feed_name"],
                        "similarity": round(float(sim[i][j]), 4),
                    }
                    for j in top_indices
                ],
            })

    # Index file breakdown
    chroma_path = Path(RAG_CHROMA_DIR).resolve()
    index_files: list[dict] = []
    for f in sorted(chroma_path.rglob("*")):
        if f.is_file():
            index_files.append({
                "path": str(f.relative_to(chroma_path)),
                "size": f.stat().st_size,
                "type": _classify_index_file(f.name),
            })

    total_chunks = len(all_ids)
    unique_docs = len(doc_rep)
    avg_chunks = round(total_chunks / unique_docs, 2) if unique_docs else 0

    return {
        "collection": {
            "name": collection.name,
            "total_chunks": total_chunks,
            "unique_documents": unique_docs,
            "avg_chunks_per_doc": avg_chunks,
            "embedding_model": "all-MiniLM-L6-v2",
            "embedding_dimensions": 384,
            "hnsw": hnsw,
        },
        "nearest_neighbors": nearest_neighbors,
        "index_files": index_files,
    }


def _classify_index_file(name: str) -> str:
    if name.endswith(".sqlite3"):
        return "sqlite"
    if name == "header.bin":
        return "hnsw-header"
    if name == "data_level0.bin":
        return "hnsw-level0"
    if name.startswith("link_lists"):
        return "hnsw-links"
    if name.endswith(".bin"):
        return "hnsw-data"
    if name.endswith(".json"):
        return "config"
    return "other"


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
                "feed_name": meta.get("feed_name", ""),
                "created_at": meta.get("created_at", ""),
                "published_date": meta.get("published_date", ""),
                "source_outlet": meta.get("source_outlet", ""),
                "keywords_matched": meta.get("keywords_matched", ""),
                "summary": meta.get("summary", ""),
                "chunk_count": 1,
            }
        else:
            seen[doc_id]["chunk_count"] += 1

    return list(seen.values())
