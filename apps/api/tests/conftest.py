"""
Pytest configuration and fixtures for EOM API tests.

We use httpx.AsyncClient with ASGITransport to drive FastAPI without
any real network connections.  FalkorDB and Elasticsearch are mocked
via monkeypatching at the module level so no infrastructure is needed.
"""
from __future__ import annotations

import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ── Import the app after patching DB modules ───────────────────────────────────
# We patch before importing main so lifespan never tries to connect.


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture
async def mock_falkordb(monkeypatch):
    """
    Replace execute_cypher with an AsyncMock that returns an empty list by default.
    Individual tests can override the return_value / side_effect.
    """
    mock = AsyncMock(return_value=[])
    monkeypatch.setattr("db.falkordb.execute_cypher", mock)
    monkeypatch.setattr("services.query_service.execute_cypher", mock)
    monkeypatch.setattr("services.action_service.execute_cypher", mock)
    monkeypatch.setattr("services.schema_service.execute_cypher", mock)
    monkeypatch.setattr("services.export_service.execute_cypher", mock)
    return mock


@pytest_asyncio.fixture
async def mock_opa(monkeypatch):
    """
    Make OPAService.check_access always return True (allow all).
    """
    monkeypatch.setattr(
        "services.opa_service.OPAService.check_access",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(
        "services.opa_service.OPAService.check_schema_change",
        AsyncMock(return_value={"allow": True, "reason": ""}),
    )


@pytest_asyncio.fixture
async def mock_init(monkeypatch):
    """Prevent real DB initialisation in lifespan."""
    monkeypatch.setattr("db.falkordb.init_falkordb", MagicMock())
    monkeypatch.setattr("db.falkordb.init_meta_graph", AsyncMock())
    monkeypatch.setattr("db.falkordb.close_falkordb", AsyncMock())
    monkeypatch.setattr("db.elasticsearch.init_elasticsearch", MagicMock())
    monkeypatch.setattr("db.elasticsearch.close_elasticsearch", AsyncMock())


@pytest_asyncio.fixture
async def client(mock_init, mock_falkordb, mock_opa) -> AsyncGenerator[AsyncClient, None]:
    """
    ASGI test client with all infrastructure mocked.
    The Authorization header is omitted so the dev-user-001 fallback is used.
    """
    from main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac
