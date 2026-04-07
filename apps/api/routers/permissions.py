"""
Permissions router — fine-grained RBAC/ABAC permission management.

Routes:
    POST   /permissions
    GET    /permissions?resource_type=SPACE&resource_id=xxx
    DELETE /permissions/{permission_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.permission import Permission, PermissionCreate, ResourceType
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(prefix="/permissions", tags=["permissions"])


def _coerce_perm(data: dict) -> Permission:
    import json
    # FalkorDB stores list as JSON string when using our store method
    actions_raw = data.get("actions", "[]")
    if isinstance(actions_raw, str):
        try:
            data["actions"] = json.loads(actions_raw)
        except (ValueError, TypeError):
            data["actions"] = [actions_raw] if actions_raw else []
    if not data.get("abac_condition"):
        data["abac_condition"] = None
    return Permission.model_validate(data)


@router.post("", response_model=Permission, status_code=status.HTTP_201_CREATED)
async def create_permission(
    body: PermissionCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Permission:
    """
    Grant a permission entry.

    The caller must themselves have the right to manage permissions on
    the target resource (OPA enforces this).
    """
    result = await action_svc.create_permission(
        user_id=user_id,
        resource_type=body.resource_type.value,
        resource_id=body.resource_id,
        subject_type=body.subject_type.value,
        subject_id=body.subject_id,
        actions=[a.value for a in body.actions],
        policy_type=body.policy_type.value,
        abac_condition=body.abac_condition,
    )
    return _coerce_perm(result)


@router.get("", response_model=list[Permission])
async def list_permissions(
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
    resource_type: ResourceType | None = Query(default=None),
    resource_id: str | None = Query(default=None),
) -> list[Permission]:
    """List permissions, optionally filtered by resource_type and/or resource_id."""
    rows = await query_svc.list_permissions(
        resource_type=resource_type.value if resource_type else None,
        resource_id=resource_id,
    )
    return [_coerce_perm(r) for r in rows]


@router.delete("/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(
    permission_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Revoke a permission entry."""
    await action_svc.delete_permission(user_id=user_id, permission_id=permission_id)
