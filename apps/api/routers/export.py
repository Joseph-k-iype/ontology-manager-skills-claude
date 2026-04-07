"""
Export router — OWL and SKOS Turtle exports for an Ontology.

Routes:
    GET /ontologies/{ontology_id}/export/owl   → Turtle (OWL)
    GET /ontologies/{ontology_id}/export/skos  → Turtle (SKOS)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from core.dependencies import CurrentUser, get_export_service
from services.export_service import ExportService

router = APIRouter(tags=["export"])

_TURTLE_MEDIA_TYPE = "text/turtle"


@router.get(
    "/ontologies/{ontology_id}/export/owl",
    response_class=PlainTextResponse,
    responses={
        200: {
            "content": {_TURTLE_MEDIA_TYPE: {}},
            "description": "OWL ontology in Turtle format",
        }
    },
)
async def export_owl(
    ontology_id: str,
    user_id: CurrentUser,
    export_svc: Annotated[ExportService, Depends(get_export_service)],
) -> PlainTextResponse:
    """
    Export the ontology as OWL/Turtle.

    Returns an RDF document where:
      - Each ObjectType → owl:Class
      - Each Property   → owl:DatatypeProperty
      - Each Relationship → owl:ObjectProperty
    """
    turtle = await export_svc.export_owl(ontology_id)
    return PlainTextResponse(content=turtle, media_type=_TURTLE_MEDIA_TYPE)


@router.get(
    "/ontologies/{ontology_id}/export/skos",
    response_class=PlainTextResponse,
    responses={
        200: {
            "content": {_TURTLE_MEDIA_TYPE: {}},
            "description": "SKOS concept scheme in Turtle format",
        }
    },
)
async def export_skos(
    ontology_id: str,
    user_id: CurrentUser,
    export_svc: Annotated[ExportService, Depends(get_export_service)],
) -> PlainTextResponse:
    """
    Export SKOS concepts from the ontology.

    Only ObjectTypes flagged with is_skos_concept=True or
    is_skos_concept_scheme=True are included. Properties with
    a skos_mapping URI are linked via skos:exactMatch.
    """
    turtle = await export_svc.export_skos(ontology_id)
    return PlainTextResponse(content=turtle, media_type=_TURTLE_MEDIA_TYPE)
