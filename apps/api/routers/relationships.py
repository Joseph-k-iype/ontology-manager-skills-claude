"""
Relationships router — CRUD for Relationships inside an Ontology.

Routes:
    POST   /ontologies/{ontology_id}/relationships
    GET    /ontologies/{ontology_id}/relationships
    PUT    /relationships/{relationship_id}
    DELETE /relationships/{relationship_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.relationship import Relationship, RelationshipCreate, RelationshipUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(tags=["relationships"])


def _coerce_rel(data: dict) -> Relationship:
    return Relationship.model_validate(data)


@router.post(
    "/ontologies/{ontology_id}/relationships",
    response_model=Relationship,
    status_code=status.HTTP_201_CREATED,
)
async def create_relationship(
    ontology_id: str,
    body: RelationshipCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Relationship:
    """Create a Relationship (edge type) inside an Ontology."""
    result = await action_svc.create_relationship(
        user_id=user_id,
        ontology_id=ontology_id,
        api_name=body.api_name,
        source_object_type_id=body.source_object_type_id,
        target_object_type_id=body.target_object_type_id,
        cardinality=body.cardinality.value,
    )
    return _coerce_rel(result)


@router.get(
    "/ontologies/{ontology_id}/relationships", response_model=list[Relationship]
)
async def list_relationships(
    ontology_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[Relationship]:
    """List all Relationships in an Ontology."""
    ontology = await query_svc.get_ontology(ontology_id)
    if not ontology:
        raise NotFoundError("Ontology", ontology_id)
    rows = await query_svc.list_relationships(ontology_id)
    return [_coerce_rel(r) for r in rows]


@router.put("/relationships/{relationship_id}", response_model=Relationship)
async def update_relationship(
    relationship_id: str,
    body: RelationshipUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Relationship:
    """Partially update a Relationship (api_name or cardinality)."""
    updates: dict = {}
    if body.api_name is not None:
        updates["api_name"] = body.api_name
    if body.cardinality is not None:
        updates["cardinality"] = body.cardinality.value
    result = await action_svc.update_relationship(
        user_id=user_id, relationship_id=relationship_id, updates=updates
    )
    return _coerce_rel(result)


@router.delete(
    "/relationships/{relationship_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_relationship(
    relationship_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Delete a Relationship from the Ontology."""
    await action_svc.delete_relationship(
        user_id=user_id, relationship_id=relationship_id
    )
