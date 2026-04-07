"""
Spaces router — CRUD for Spaces plus listing their Folders.

Routes:
    POST   /spaces
    GET    /spaces
    GET    /spaces/{space_id}
    PUT    /spaces/{space_id}
    DELETE /spaces/{space_id}
    GET    /spaces/{space_id}/folders
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.folder import Folder
from models.space import Space, SpaceCreate, SpaceUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(prefix="/spaces", tags=["spaces"])


def _coerce_space(data: dict) -> Space:
    """
    Coerce raw FalkorDB dict → Space Pydantic model.
    FalkorDB stores empty string for None fields; convert back.
    """
    if not data.get("description"):
        data["description"] = None
    return Space.model_validate(data)


def _coerce_folder(data: dict) -> Folder:
    if not data.get("parent_folder_id"):
        data["parent_folder_id"] = None
    return Folder.model_validate(data)


@router.post("", response_model=Space, status_code=status.HTTP_201_CREATED)
async def create_space(
    body: SpaceCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Space:
    """Create a new Space. OPA is consulted before any write."""
    result = await action_svc.create_space(
        user_id=user_id,
        name=body.name,
        description=body.description,
        visibility=body.visibility.value,
    )
    return _coerce_space(result)


@router.get("", response_model=list[Space])
async def list_spaces(
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Space]:
    """List all Spaces accessible to the caller (paginated)."""
    rows = await query_svc.list_spaces(limit=limit, offset=offset)
    return [_coerce_space(r) for r in rows]


@router.get("/{space_id}", response_model=Space)
async def get_space(
    space_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> Space:
    """Fetch a single Space by ID."""
    data = await query_svc.get_space(space_id)
    if not data:
        raise NotFoundError("Space", space_id)
    return _coerce_space(data)


@router.put("/{space_id}", response_model=Space)
async def update_space(
    space_id: str,
    body: SpaceUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Space:
    """Partially update a Space (only provided fields are changed)."""
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description
    if body.visibility is not None:
        updates["visibility"] = body.visibility.value
    result = await action_svc.update_space(user_id=user_id, space_id=space_id, updates=updates)
    return _coerce_space(result)


@router.delete("/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_space(
    space_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Delete a Space and all its children (DETACH DELETE in Cypher)."""
    await action_svc.delete_space(user_id=user_id, space_id=space_id)


@router.get("/{space_id}/folders", response_model=list[Folder])
async def list_space_folders(
    space_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[Folder]:
    """List all Folders that belong to a Space."""
    space = await query_svc.get_space(space_id)
    if not space:
        raise NotFoundError("Space", space_id)
    rows = await query_svc.list_folders(space_id)
    return [_coerce_folder(r) for r in rows]
