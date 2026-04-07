from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class Cardinality(str, Enum):
    ONE_TO_ONE = "ONE_TO_ONE"
    ONE_TO_MANY = "ONE_TO_MANY"
    MANY_TO_MANY = "MANY_TO_MANY"


class RelationshipBase(BaseModel):
    api_name: str  # lower_snake_case verb phrase
    source_object_type_id: str
    target_object_type_id: str
    cardinality: Cardinality = Cardinality.MANY_TO_MANY


class RelationshipCreate(RelationshipBase):
    pass


class RelationshipUpdate(BaseModel):
    api_name: str | None = None
    cardinality: Cardinality | None = None


class Relationship(RelationshipBase):
    id: str
    ontology_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
