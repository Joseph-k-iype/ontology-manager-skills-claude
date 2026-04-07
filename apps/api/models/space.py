from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class SpaceVisibility(str, Enum):
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"
    SHARED = "SHARED"


class SpaceBase(BaseModel):
    name: str
    description: str | None = None
    visibility: SpaceVisibility = SpaceVisibility.PRIVATE


class SpaceCreate(SpaceBase):
    pass


class SpaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    visibility: SpaceVisibility | None = None


class Space(SpaceBase):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
