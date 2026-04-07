"""
FalkorDB connection and query helpers.

FalkorDB's Python client is synchronous; we wrap blocking calls in
asyncio.to_thread() so the FastAPI event loop never blocks.
"""
from __future__ import annotations

import asyncio
from typing import Any

import structlog
from falkordb import FalkorDB

from core.config import settings

log = structlog.get_logger()

_client: FalkorDB | None = None

META_GRAPH = "eom_meta"


def _get_client() -> FalkorDB:
    global _client
    if _client is None:
        raise RuntimeError("FalkorDB client has not been initialised. Call init_falkordb() first.")
    return _client


def init_falkordb() -> None:
    """Initialise module-level FalkorDB client. Call once at startup."""
    global _client
    kwargs: dict[str, Any] = {
        "host": settings.falkordb_host,
        "port": settings.falkordb_port,
    }
    if settings.falkordb_password:
        kwargs["password"] = settings.falkordb_password

    _client = FalkorDB(**kwargs)
    log.info(
        "falkordb_connected",
        host=settings.falkordb_host,
        port=settings.falkordb_port,
    )


async def close_falkordb() -> None:
    """Close client on shutdown."""
    global _client
    if _client is not None:
        # FalkorDB uses a Redis connection; close the underlying pool
        try:
            _client.connection.close()  # type: ignore[attr-defined]
        except Exception:
            pass
        _client = None
        log.info("falkordb_closed")


def _run_query(graph_name: str, query: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Synchronous helper executed inside asyncio.to_thread."""
    client = _get_client()
    graph = client.select_graph(graph_name)
    result = graph.query(query, params)
    rows: list[dict[str, Any]] = []
    if result.result_set:
        headers = result.header if result.header else []
        for row in result.result_set:
            if headers:
                rows.append(dict(zip(headers, row)))
            else:
                rows.append({"value": row})
    return rows


async def execute_cypher(
    graph_name: str,
    query: str,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Execute a Cypher query against the named FalkorDB graph.

    Returns a list of row-dicts keyed by the RETURN aliases in the query.
    Runs in a thread pool so the event loop stays unblocked.
    """
    params = params or {}
    log.debug("falkordb_query", graph=graph_name, query=query, params=params)
    try:
        return await asyncio.to_thread(_run_query, graph_name, query, params)
    except Exception as exc:
        log.error("falkordb_query_failed", graph=graph_name, query=query, error=str(exc))
        raise


def _create_meta_indexes() -> None:
    """Create indexes on the meta-graph for common lookup patterns."""
    client = _get_client()
    graph = client.select_graph(META_GRAPH)

    index_statements = [
        "CREATE INDEX FOR (n:OntMeta_Space) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Folder) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Folder) ON (n.space_id)",
        "CREATE INDEX FOR (n:OntMeta_Ontology) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Ontology) ON (n.folder_id)",
        "CREATE INDEX FOR (n:OntMeta_ObjectType) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_ObjectType) ON (n.ontology_id)",
        "CREATE INDEX FOR (n:OntMeta_Property) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Property) ON (n.object_type_id)",
        "CREATE INDEX FOR (n:OntMeta_Relationship) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Relationship) ON (n.ontology_id)",
        "CREATE INDEX FOR (n:OntMeta_Permission) ON (n.id)",
        "CREATE INDEX FOR (n:OntMeta_Permission) ON (n.resource_id)",
    ]

    for stmt in index_statements:
        try:
            graph.query(stmt)
        except Exception as exc:
            # Index already exists → ignore
            if "already indexed" not in str(exc).lower() and "equivalent index" not in str(exc).lower():
                log.warning("meta_index_creation_warning", stmt=stmt, error=str(exc))


async def init_meta_graph() -> None:
    """Initialise the eom_meta graph with required indexes."""
    await asyncio.to_thread(_create_meta_indexes)
    log.info("falkordb_meta_graph_initialised")
