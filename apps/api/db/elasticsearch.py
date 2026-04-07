"""
Elasticsearch async client and query helpers.
"""
from __future__ import annotations

from typing import Any

import structlog
from elasticsearch import AsyncElasticsearch

from core.config import settings

log = structlog.get_logger()

_client: AsyncElasticsearch | None = None


def init_elasticsearch() -> None:
    """Initialise module-level AsyncElasticsearch client. Call once at startup."""
    global _client

    kwargs: dict[str, Any] = {"hosts": [settings.elasticsearch_url]}
    if settings.elasticsearch_username and settings.elasticsearch_password:
        kwargs["basic_auth"] = (
            settings.elasticsearch_username,
            settings.elasticsearch_password,
        )

    _client = AsyncElasticsearch(**kwargs)
    log.info("elasticsearch_client_created", url=settings.elasticsearch_url)


async def close_elasticsearch() -> None:
    """Close client on shutdown."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
        log.info("elasticsearch_closed")


def _get_client() -> AsyncElasticsearch:
    if _client is None:
        raise RuntimeError(
            "Elasticsearch client has not been initialised. Call init_elasticsearch() first."
        )
    return _client


async def search(index: str, query: dict[str, Any]) -> dict[str, Any]:
    """
    Execute an ES search and return the raw response dict.

    Args:
        index: The index name or alias to query.
        query: Full ES query DSL body (must include 'query' key at minimum).
    """
    log.debug("elasticsearch_search", index=index)
    try:
        response = await _get_client().search(index=index, body=query)
        return dict(response)
    except Exception as exc:
        log.error("elasticsearch_search_failed", index=index, error=str(exc))
        raise


async def index_document(index: str, doc_id: str, document: dict[str, Any]) -> None:
    """
    Index (upsert) a single document.

    Args:
        index: Target index or alias.
        doc_id: Document ID.
        document: Document body dict.
    """
    log.debug("elasticsearch_index_document", index=index, doc_id=doc_id)
    try:
        await _get_client().index(index=index, id=doc_id, body=document)
    except Exception as exc:
        log.error(
            "elasticsearch_index_failed",
            index=index,
            doc_id=doc_id,
            error=str(exc),
        )
        raise


async def delete_document(index: str, doc_id: str) -> None:
    """Delete a document by ID. Silently ignores 404."""
    log.debug("elasticsearch_delete_document", index=index, doc_id=doc_id)
    try:
        await _get_client().delete(index=index, id=doc_id, ignore=[404])
    except Exception as exc:
        log.error(
            "elasticsearch_delete_failed",
            index=index,
            doc_id=doc_id,
            error=str(exc),
        )
        raise


async def ensure_index(index: str, mapping: dict[str, Any]) -> None:
    """Create an index with the given mapping if it does not exist."""
    client = _get_client()
    exists = await client.indices.exists(index=index)
    if not exists:
        await client.indices.create(index=index, body=mapping)
        log.info("elasticsearch_index_created", index=index)
