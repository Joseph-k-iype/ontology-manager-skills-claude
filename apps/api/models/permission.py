from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class ResourceType(str, Enum):
    SPACE = "SPACE"
    FOLDER = "FOLDER"
    ONTOLOGY = "ONTOLOGY"
    OBJECT_TYPE = "OBJECT_TYPE"
    PROPERTY = "PROPERTY"
    RELATIONSHIP = "RELATIONSHIP"


class SubjectType(str, Enum):
    USER = "USER"
    GROUP = "GROUP"
    ROLE = "ROLE"


class ActionType(str, Enum):
    READ = "READ"
    WRITE = "WRITE"
    EDIT = "EDIT"
    DELETE = "DELETE"


class PolicyType(str, Enum):
    RBAC = "RBAC"
    ABAC = "ABAC"


class PermissionBase(BaseModel):
    resource_type: ResourceType
    resource_id: str
    subject_type: SubjectType
    subject_id: str
    actions: list[ActionType]
    policy_type: PolicyType = PolicyType.RBAC
    abac_condition: str | None = None


class PermissionCreate(PermissionBase):
    pass


class Permission(PermissionBase):
    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
