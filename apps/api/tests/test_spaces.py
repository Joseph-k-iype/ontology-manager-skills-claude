"""
Tests for the /api/v1/spaces endpoints.

Infrastructure (FalkorDB, OPA) is mocked by conftest fixtures.
We verify:
  - HTTP status codes
  - Response shape / Pydantic model compliance
  - That Cypher queries are actually invoked
  - 404 behaviour when a resource is not found
"""
from __future__ import annotations

from unittest.mock import AsyncMock, call
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

BASE = "/api/v1/spaces"

# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_space_node(
    space_id: str = "01HZZ000000000000000000001",
    name: str = "Test Space",
    description: str = "A test space",
    visibility: str = "PRIVATE",
    owner_id: str = "dev-user-001",
) -> dict:
    ts = datetime.now(timezone.utc).isoformat()
    return {
        "id": space_id,
        "name": name,
        "description": description,
        "visibility": visibility,
        "owner_id": owner_id,
        "created_at": ts,
        "updated_at": ts,
    }


def _wrap_node(data: dict, alias: str = "s") -> dict:
    """Simulate how QueryService._node_to_dict receives data when FalkorDB returns plain dicts."""
    return {alias: data}


# ── POST /spaces ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_space_returns_201(client: AsyncClient, mock_falkordb: AsyncMock):
    """Creating a space should return 201 with the Space schema."""
    resp = await client.post(
        BASE,
        json={"name": "My Space", "description": "hello", "visibility": "PUBLIC"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Space"
    assert data["visibility"] == "PUBLIC"
    assert "id" in data
    assert "owner_id" in data
    assert "created_at" in data
    assert "updated_at" in data


@pytest.mark.asyncio
async def test_create_space_calls_cypher(client: AsyncClient, mock_falkordb: AsyncMock):
    """The CREATE Cypher should be called exactly once for a space creation."""
    await client.post(BASE, json={"name": "Cypher Space"})
    # execute_cypher should have been called (CREATE node)
    assert mock_falkordb.call_count >= 1
    # The first call should be a CREATE statement
    first_call_args = mock_falkordb.call_args_list[0]
    query: str = first_call_args.args[1] if first_call_args.args else first_call_args.kwargs.get("query", "")
    assert "CREATE" in query.upper()
    assert "OntMeta_Space" in query


@pytest.mark.asyncio
async def test_create_space_default_visibility(client: AsyncClient, mock_falkordb: AsyncMock):
    """Omitting visibility should default to PRIVATE."""
    resp = await client.post(BASE, json={"name": "Private Space"})
    assert resp.status_code == 201
    assert resp.json()["visibility"] == "PRIVATE"


# ── GET /spaces ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_spaces_empty(client: AsyncClient, mock_falkordb: AsyncMock):
    """Listing spaces when none exist should return an empty array."""
    mock_falkordb.return_value = []
    resp = await client.get(BASE)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_spaces_returns_results(client: AsyncClient, mock_falkordb: AsyncMock):
    """Listing spaces should parse FalkorDB rows into Space models."""
    node_data = _make_space_node(name="Alpha")
    # QueryService._node_to_dict handles plain dicts via the "s" alias
    mock_falkordb.return_value = [{"s": node_data}]
    resp = await client.get(BASE)
    assert resp.status_code == 200
    spaces = resp.json()
    assert len(spaces) == 1
    assert spaces[0]["name"] == "Alpha"


@pytest.mark.asyncio
async def test_list_spaces_pagination_params(client: AsyncClient, mock_falkordb: AsyncMock):
    """Pagination query params should be forwarded to the Cypher query."""
    mock_falkordb.return_value = []
    resp = await client.get(BASE, params={"limit": 10, "offset": 20})
    assert resp.status_code == 200
    # Verify that execute_cypher was called with limit/offset params
    call_kwargs = mock_falkordb.call_args_list[-1]
    params = call_kwargs.args[2] if len(call_kwargs.args) > 2 else call_kwargs.kwargs.get("params", {})
    assert params.get("limit") == 10
    assert params.get("offset") == 20


# ── GET /spaces/{space_id} ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_space_found(client: AsyncClient, mock_falkordb: AsyncMock):
    """Fetching an existing space by ID should return 200."""
    node_data = _make_space_node(space_id="SPACEID1")
    mock_falkordb.return_value = [{"s": node_data}]
    resp = await client.get(f"{BASE}/SPACEID1")
    assert resp.status_code == 200
    assert resp.json()["id"] == "SPACEID1"


@pytest.mark.asyncio
async def test_get_space_not_found(client: AsyncClient, mock_falkordb: AsyncMock):
    """Fetching a space that does not exist should return 404."""
    mock_falkordb.return_value = []
    resp = await client.get(f"{BASE}/DOESNOTEXIST")
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "NOT_FOUND"


# ── PUT /spaces/{space_id} ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_space_ok(client: AsyncClient, mock_falkordb: AsyncMock):
    """Updating an existing space should return 200 with updated fields."""
    node_data = _make_space_node(space_id="UPID1", name="Old Name")

    async def _side_effect(graph_name, query, params=None):
        # First call: get_space (MATCH), subsequent: SET
        if "MATCH" in query.upper() and "SET" not in query.upper():
            return [{"s": node_data}]
        return []

    mock_falkordb.side_effect = _side_effect
    resp = await client.put(f"{BASE}/UPID1", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_update_space_not_found(client: AsyncClient, mock_falkordb: AsyncMock):
    """Updating a non-existent space should return 404."""
    mock_falkordb.return_value = []
    resp = await client.put(f"{BASE}/GHOST", json={"name": "Nope"})
    assert resp.status_code == 404


# ── DELETE /spaces/{space_id} ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_space_ok(client: AsyncClient, mock_falkordb: AsyncMock):
    """Deleting an existing space should return 204."""
    node_data = _make_space_node(space_id="DELID1")

    async def _side_effect(graph_name, query, params=None):
        if "MATCH" in query.upper() and "DELETE" not in query.upper():
            return [{"s": node_data}]
        return []

    mock_falkordb.side_effect = _side_effect
    resp = await client.delete(f"{BASE}/DELID1")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_space_not_found(client: AsyncClient, mock_falkordb: AsyncMock):
    """Deleting a space that doesn't exist should return 404."""
    mock_falkordb.return_value = []
    resp = await client.delete(f"{BASE}/GHOST")
    assert resp.status_code == 404


# ── GET /spaces/{space_id}/folders ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_space_folders_space_not_found(
    client: AsyncClient, mock_falkordb: AsyncMock
):
    """If the Space doesn't exist, listing folders should return 404."""
    mock_falkordb.return_value = []
    resp = await client.get(f"{BASE}/GHOST/folders")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_space_folders_ok(client: AsyncClient, mock_falkordb: AsyncMock):
    """If the Space exists, listing folders should return 200 and a list."""
    from datetime import datetime, timezone

    ts = datetime.now(timezone.utc).isoformat()
    space_node = _make_space_node(space_id="SP1")
    folder_node = {
        "id": "F1",
        "name": "Root Folder",
        "space_id": "SP1",
        "parent_folder_id": "",
        "created_at": ts,
    }

    call_count = 0

    async def _side_effect(graph_name, query, params=None):
        nonlocal call_count
        call_count += 1
        # First call: get_space → return the space
        if call_count == 1:
            return [{"s": space_node}]
        # Second call: list_folders → return one folder
        return [{"f": folder_node}]

    mock_falkordb.side_effect = _side_effect
    resp = await client.get(f"{BASE}/SP1/folders")
    assert resp.status_code == 200
    folders = resp.json()
    assert len(folders) == 1
    assert folders[0]["name"] == "Root Folder"


# ── Health check ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    """The /health endpoint should always return 200."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "components" in body
    assert "falkordb" in body["components"]
    assert "elasticsearch" in body["components"]
