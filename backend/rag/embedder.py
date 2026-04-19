"""Lazy-loading sentence-transformers embedder (singleton)."""

from __future__ import annotations

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts and return as list of float vectors."""
    model = _get_model()
    return model.encode(texts, convert_to_numpy=True).tolist()
