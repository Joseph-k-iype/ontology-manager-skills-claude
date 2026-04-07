from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ObjectTypeBase(BaseModel):
    api_name: str  # lower_snake_case
    display_name: str
    description: str | None = None
    primary_key: str = "id"
    is_skos_concept: bool = False
    is_skos_concept_scheme: bool = False


class ObjectTypeCreate(ObjectTypeBase):
    pass


class ObjectTypeUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    primary_key: str | None = None
    is_skos_concept: bool | None = None
    is_skos_concept_scheme: bool | None = None


class ObjectType(ObjectTypeBase):
    id: str
    ontology_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
