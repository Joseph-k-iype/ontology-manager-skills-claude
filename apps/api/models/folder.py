from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FolderBase(BaseModel):
    name: str
    parent_folder_id: str | None = None


class FolderCreate(FolderBase):
    pass


class FolderUpdate(BaseModel):
    name: str | None = None
    parent_folder_id: str | None = None


class Folder(FolderBase):
    id: str
    space_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
