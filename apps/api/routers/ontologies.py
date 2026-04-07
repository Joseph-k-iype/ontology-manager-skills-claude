"""
Ontologies router — CRUD for Ontologies inside Folders, plus publish.

Routes:
    POST   /folders/{folder_id}/ontologies
    GET    /folders/{folder_id}/ontologies
    GET    /ontologies/{ontology_id}
    PUT    /ontologies/{ontology_id}
    DELETE /ontologies/{ontology_id}
    POST   /ontologies/{ontology_id}/publish
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from core.dependencies import CurrentUser, get_action_service, get_query_service
from core.exceptions import NotFoundError
from models.ontology import Ontology, OntologyCreate, OntologyUpdate
from services.action_service import ActionService
from services.query_service import QueryService

router = APIRouter(tags=["ontologies"])


def _coerce_ontology(data: dict) -> Ontology:
    if not data.get("description"):
        data["description"] = None
    return Ontology.model_validate(data)


@router.post(
    "/folders/{folder_id}/ontologies",
    response_model=Ontology,
    status_code=status.HTTP_201_CREATED,
)
async def create_ontology(
    folder_id: str,
    body: OntologyCreate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Ontology:
    """Create an Ontology inside a Folder."""
    result = await action_svc.create_ontology(
        user_id=user_id,
        folder_id=folder_id,
        name=body.name,
        description=body.description,
    )
    return _coerce_ontology(result)


@router.get("/folders/{folder_id}/ontologies", response_model=list[Ontology])
async def list_ontologies(
    folder_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> list[Ontology]:
    """List all Ontologies in a Folder."""
    folder = await query_svc.get_folder(folder_id)
    if not folder:
        raise NotFoundError("Folder", folder_id)
    rows = await query_svc.list_ontologies(folder_id)
    return [_coerce_ontology(r) for r in rows]


@router.get("/ontologies/{ontology_id}", response_model=Ontology)
async def get_ontology(
    ontology_id: str,
    user_id: CurrentUser,
    query_svc: Annotated[QueryService, Depends(get_query_service)],
) -> Ontology:
    """Fetch a single Ontology by ID."""
    data = await query_svc.get_ontology(ontology_id)
    if not data:
        raise NotFoundError("Ontology", ontology_id)
    return _coerce_ontology(data)


@router.put("/ontologies/{ontology_id}", response_model=Ontology)
async def update_ontology(
    ontology_id: str,
    body: OntologyUpdate,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Ontology:
    """Partially update an Ontology."""
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description
    result = await action_svc.update_ontology(
        user_id=user_id, ontology_id=ontology_id, updates=updates
    )
    return _coerce_ontology(result)


@router.delete("/ontologies/{ontology_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ontology(
    ontology_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> None:
    """Delete an Ontology and all its ObjectTypes / Relationships."""
    await action_svc.delete_ontology(user_id=user_id, ontology_id=ontology_id)


@router.post("/ontologies/{ontology_id}/publish", response_model=Ontology)
async def publish_ontology(
    ontology_id: str,
    user_id: CurrentUser,
    action_svc: Annotated[ActionService, Depends(get_action_service)],
) -> Ontology:
    """
    Transition an Ontology from DRAFT → PUBLISHED.

    This sets status=PUBLISHED on the meta-graph node. In a full
    implementation this would also trigger schema compilation and
    ES index creation via SchemaService.
    """
    result = await action_svc.publish_ontology(user_id=user_id, ontology_id=ontology_id)
    return _coerce_ontology(result)
