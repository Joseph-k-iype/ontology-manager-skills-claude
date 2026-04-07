"""
Object Types router — CRUD for ObjectTypes inside an Ontology.

Routes:
    POST   /ontologies/{ontology_id}/object-types
    GET    /ontologies/{ontology_id}/object-types
    GET    /object-types/{object_type_id}
    PUT    /object-types/{object_type_id}
    DELETE /object-types/{object_type_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.object_type import ObjectType, ObjectTypeCreate, ObjectTypeUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(tags=["object-types"])


def _coerce_ot(data: dict) -> ObjectType:
    if not data.get("description"):
        data["description"] = None
    # FalkorDB may store booleans as ints
    data["is_skos_concept"] = bool(data.get("is_skos_concept", False))
    data["is_skos_concept_scheme"] = bool(data.get("is_skos_concept_scheme", False))
    return ObjectType.model_validate(data)


@router.post(
    "/ontologies/{ontology_id}/object-types",
    response_model=ObjectType,
    status_code=status.HTTP_201_CREATED,
)
async def create_object_type(
    ontology_id: str,
    body: ObjectTypeCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> ObjectType:
    """Create an ObjectType inside an Ontology. OPA schema-change gate is applied."""
    result = await action_svc.create_object_type(
        user_id=user_id,
        ontology_id=ontology_id,
        api_name=body.api_name,
        display_name=body.display_name,
        description=body.description,
        primary_key=body.primary_key,
        is_skos_concept=body.is_skos_concept,
        is_skos_concept_scheme=body.is_skos_concept_scheme,
    )
    return _coerce_ot(result)


@router.get("/ontologies/{ontology_id}/object-types", response_model=list[ObjectType])
async def list_object_types(
    ontology_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[ObjectType]:
    """List all ObjectTypes in an Ontology."""
    ontology = await query_svc.get_ontology(ontology_id)
    if not ontology:
        raise NotFoundError("Ontology", ontology_id)
    rows = await query_svc.list_object_types(ontology_id)
    return [_coerce_ot(r) for r in rows]


@router.get("/object-types/{object_type_id}", response_model=ObjectType)
async def get_object_type(
    object_type_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> ObjectType:
    """Fetch a single ObjectType by ID."""
    data = await query_svc.get_object_type(object_type_id)
    if not data:
        raise NotFoundError("ObjectType", object_type_id)
    return _coerce_ot(data)


@router.put("/object-types/{object_type_id}", response_model=ObjectType)
async def update_object_type(
    object_type_id: str,
    body: ObjectTypeUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> ObjectType:
    """Partially update an ObjectType."""
    updates: dict = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.description is not None:
        updates["description"] = body.description
    if body.primary_key is not None:
        updates["primary_key"] = body.primary_key
    if body.is_skos_concept is not None:
        updates["is_skos_concept"] = body.is_skos_concept
    if body.is_skos_concept_scheme is not None:
        updates["is_skos_concept_scheme"] = body.is_skos_concept_scheme
    result = await action_svc.update_object_type(
        user_id=user_id, object_type_id=object_type_id, updates=updates
    )
    return _coerce_ot(result)


@router.delete("/object-types/{object_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_object_type(
    object_type_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Delete an ObjectType and all its Properties."""
    await action_svc.delete_object_type(user_id=user_id, object_type_id=object_type_id)
