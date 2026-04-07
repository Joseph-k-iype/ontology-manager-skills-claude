"""
Folders router — CRUD for Folders inside a Space.

Routes:
    POST   /spaces/{space_id}/folders
    GET    /spaces/{space_id}/folders
    GET    /spaces/{space_id}/folders/{folder_id}
    PUT    /spaces/{space_id}/folders/{folder_id}
    DELETE /spaces/{space_id}/folders/{folder_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.folder import Folder, FolderCreate, FolderUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(tags=["folders"])


def _coerce_folder(data: dict) -> Folder:
    if not data.get("parent_folder_id"):
        data["parent_folder_id"] = None
    return Folder.model_validate(data)


@router.post(
    "/spaces/{space_id}/folders",
    response_model=Folder,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    space_id: str,
    body: FolderCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Folder:
    """Create a Folder inside a Space."""
    result = await action_svc.create_folder(
        user_id=user_id,
        space_id=space_id,
        name=body.name,
        parent_folder_id=body.parent_folder_id,
    )
    return _coerce_folder(result)


@router.get("/spaces/{space_id}/folders", response_model=list[Folder])
async def list_folders(
    space_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[Folder]:
    """List all Folders in a Space."""
    space = await query_svc.get_space(space_id)
    if not space:
        raise NotFoundError("Space", space_id)
    rows = await query_svc.list_folders(space_id)
    return [_coerce_folder(r) for r in rows]


@router.get("/spaces/{space_id}/folders/{folder_id}", response_model=Folder)
async def get_folder(
    space_id: str,
    folder_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> Folder:
    """Fetch a single Folder by ID, scoped to a Space."""
    data = await query_svc.get_folder(folder_id)
    if not data or data.get("space_id") != space_id:
        raise NotFoundError("Folder", folder_id)
    return _coerce_folder(data)


@router.put("/spaces/{space_id}/folders/{folder_id}", response_model=Folder)
async def update_folder(
    space_id: str,
    folder_id: str,
    body: FolderUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> Folder:
    """Partially update a Folder."""
    existing = await query_svc.get_folder(folder_id)
    if not existing or existing.get("space_id") != space_id:
        raise NotFoundError("Folder", folder_id)
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.parent_folder_id is not None:
        updates["parent_folder_id"] = body.parent_folder_id
    result = await action_svc.update_folder(
        user_id=user_id, folder_id=folder_id, updates=updates
    )
    return _coerce_folder(result)


@router.delete(
    "/spaces/{space_id}/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_folder(
    space_id: str,
    folder_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> None:
    """Delete a Folder."""
    existing = await query_svc.get_folder(folder_id)
    if not existing or existing.get("space_id") != space_id:
        raise NotFoundError("Folder", folder_id)
    await action_svc.delete_folder(user_id=user_id, folder_id=folder_id)
