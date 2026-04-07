from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class OntologyStatus(str, Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    DEPRECATED = "DEPRECATED"


class OntologyBase(BaseModel):
    name: str
    description: str | None = None


class OntologyCreate(OntologyBase):
    pass


class OntologyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class Ontology(OntologyBase):
    id: str
    folder_id: str
    space_id: str
    version: str = "0.1.0"
    status: OntologyStatus = OntologyStatus.DRAFT
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
