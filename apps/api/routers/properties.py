"""
Properties router — CRUD for Properties inside an ObjectType.

Routes:
    POST   /object-types/{object_type_id}/properties
    GET    /object-types/{object_type_id}/properties
    PUT    /properties/{property_id}
    DELETE /properties/{property_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.property import Property, PropertyCreate, PropertyUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(tags=["properties"])


def _coerce_prop(data: dict) -> Property:
    if not data.get("skos_mapping"):
        data["skos_mapping"] = None
    data["required"] = bool(data.get("required", False))
    return Property.model_validate(data)


@router.post(
    "/object-types/{object_type_id}/properties",
    response_model=Property,
    status_code=status.HTTP_201_CREATED,
)
async def create_property(
    object_type_id: str,
    body: PropertyCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Property:
    """Create a Property on an ObjectType."""
    result = await action_svc.create_property(
        user_id=user_id,
        object_type_id=object_type_id,
        api_name=body.api_name,
        display_name=body.display_name,
        data_type=body.data_type.value,
        required=body.required,
        skos_mapping=body.skos_mapping,
    )
    return _coerce_prop(result)


@router.get("/object-types/{object_type_id}/properties", response_model=list[Property])
async def list_properties(
    object_type_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[Property]:
    """List all Properties of an ObjectType."""
    ot = await query_svc.get_object_type(object_type_id)
    if not ot:
        raise NotFoundError("ObjectType", object_type_id)
    rows = await query_svc.list_properties(object_type_id)
    return [_coerce_prop(r) for r in rows]


@router.put("/properties/{property_id}", response_model=Property)
async def update_property(
    property_id: str,
    body: PropertyUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Property:
    """Partially update a Property."""
    updates: dict = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.data_type is not None:
        updates["data_type"] = body.data_type.value
    if body.required is not None:
        updates["required"] = body.required
    if body.skos_mapping is not None:
        updates["skos_mapping"] = body.skos_mapping
    result = await action_svc.update_property(
        user_id=user_id, property_id=property_id, updates=updates
    )
    return _coerce_prop(result)


@router.delete("/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Delete a Property from an ObjectType."""
    await action_svc.delete_property(user_id=user_id, property_id=property_id)
