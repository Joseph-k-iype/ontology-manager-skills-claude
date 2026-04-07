from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class PropertyDataType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    URI = "uri"


class PropertyBase(BaseModel):
    api_name: str  # camelCase
    display_name: str
    data_type: PropertyDataType
    required: bool = False
    skos_mapping: str | None = None


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(BaseModel):
    display_name: str | None = None
    data_type: PropertyDataType | None = None
    required: bool | None = None
    skos_mapping: str | None = None


class Property(PropertyBase):
    id: str
    object_type_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
