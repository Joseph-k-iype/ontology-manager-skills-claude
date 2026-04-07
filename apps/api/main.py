"""
Enterprise Ontology Manager — FastAPI application entry point.

Start with:
    uv run uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
import structlog.stdlib
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.exceptions import register_exception_handlers
from db.falkordb import init_falkordb, close_falkordb, init_meta_graph
from db.elasticsearch import init_elasticsearch, close_elasticsearch
from routers import spaces, folders, ontologies, object_types, properties, relationships, permissions, export

# ── Logging setup ──────────────────────────────────────────────────────────────

def _configure_logging() -> None:
    log_level = getattr(logging, settings.log_level.upper(), logging.DEBUG)

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(
        format="%(message)s",
        level=log_level,
    )


_configure_logging()
log = structlog.get_logger()

# ── Lifespan ───────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: initialise FalkorDB + Elasticsearch connections.
    Shutdown: close them cleanly.
    """
    log.info("eom_api_starting", version="0.1.0")

    # FalkorDB
    try:
        init_falkordb()
        await init_meta_graph()
        log.info("falkordb_ready")
    except Exception as exc:
        log.warning("falkordb_init_failed", error=str(exc))
        # Continue startup so health endpoint still works in dev

    # Elasticsearch
    try:
        init_elasticsearch()
        log.info("elasticsearch_ready")
    except Exception as exc:
        log.warning("elasticsearch_init_failed", error=str(exc))

    log.info("eom_api_ready")
    yield

    # Shutdown
    log.info("eom_api_shutting_down")
    await close_falkordb()
    await close_elasticsearch()
    log.info("eom_api_stopped")


# ── App factory ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Enterprise Ontology Manager API",
    description=(
        "EOM platform API — define, version, govern, and search semantic ontologies "
        "backed by FalkorDB, Elasticsearch, Git Worktrees, and OPA."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Exception handlers ─────────────────────────────────────────────────────────

register_exception_handlers(app)

# ── Routers ────────────────────────────────────────────────────────────────────

API_PREFIX = "/api/v1"

app.include_router(spaces.router, prefix=API_PREFIX)
app.include_router(folders.router, prefix=API_PREFIX)
app.include_router(ontologies.router, prefix=API_PREFIX)
app.include_router(object_types.router, prefix=API_PREFIX)
app.include_router(properties.router, prefix=API_PREFIX)
app.include_router(relationships.router, prefix=API_PREFIX)
app.include_router(permissions.router, prefix=API_PREFIX)
app.include_router(export.router, prefix=API_PREFIX)

# ── Health check ───────────────────────────────────────────────────────────────


@app.get("/health", tags=["health"])
async def health() -> dict:
    """
    Liveness / readiness check.

    Returns 200 with service component statuses.
    """
    from db.falkordb import _client as falkordb_client
    from db.elasticsearch import _client as es_client

    falkordb_ok = falkordb_client is not None
    es_ok = es_client is not None

    return {
        "status": "ok",
        "version": "0.1.0",
        "components": {
            "falkordb": "connected" if falkordb_ok else "disconnected",
            "elasticsearch": "connected" if es_ok else "disconnected",
        },
    }
