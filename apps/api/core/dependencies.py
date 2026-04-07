from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt

from core.config import settings
from services.opa_service import OPAService
from services.query_service import QueryService
from services.action_service import ActionService
from services.schema_service import SchemaService
from services.export_service import ExportService
import structlog

log = structlog.get_logger()


async def get_current_user(authorization: Annotated[str | None, Header()] = None) -> str:
    """
    Extract user_id from Bearer JWT token.
    Returns "dev-user-001" in dev when no token is provided (dev convenience).
    """
    if not authorization:
        # Dev fallback — in production, raise 401 here
        return "dev-user-001"

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization header format")

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject claim")
        return user_id
    except JWTError as exc:
        log.warning("jwt_decode_failed", error=str(exc))
        raise HTTPException(status_code=401, detail="Could not validate token") from exc


CurrentUser = Annotated[str, Depends(get_current_user)]


def get_opa_service() -> OPAService:
    return OPAService()


def get_query_service() -> QueryService:
    return QueryService()


def get_action_service(
    opa: Annotated[OPAService, Depends(get_opa_service)],
    query: Annotated[QueryService, Depends(get_query_service)],
) -> ActionService:
    return ActionService(opa=opa, query=query)


def get_schema_service() -> SchemaService:
    return SchemaService()


def get_export_service(
    query: Annotated[QueryService, Depends(get_query_service)],
) -> ExportService:
    return ExportService(query=query)
