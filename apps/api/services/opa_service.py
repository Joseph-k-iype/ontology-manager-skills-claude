"""
OPA policy client.

All access-control decisions flow through this service.
No service may make its own allow/deny decisions — always call OPA first.
"""
from __future__ import annotations

import structlog
import httpx

from core.config import settings

log = structlog.get_logger()


class OPAService:
    """
    Thin async client around the OPA HTTP REST API.

    OPA policy paths used:
      - eom/authz/allow         → RBAC/ABAC resource access
      - eom/schema/change_allow → Schema mutation gate
    """

    def __init__(self, opa_url: str | None = None) -> None:
        self._base_url = (opa_url or settings.opa_url).rstrip("/")

    async def check_access(
        self,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """
        Evaluate the eom/authz/allow policy.

        Returns True if OPA allows, False if denied.
        On OPA connectivity failure we fail open in dev (log + return True)
        so local dev works without a running OPA instance.
        """
        payload = {
            "input": {
                "user_id": user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
            }
        }
        return await self._query_policy("eom/authz/allow", payload)

    async def check_schema_change(
        self,
        change_type: str,
        details: dict,
    ) -> dict:
        """
        Evaluate the eom/schema/change_allow policy.

        Returns a dict with at minimum:
          { "allow": bool, "reason": str }
        """
        payload = {
            "input": {
                "change_type": change_type,
                "details": details,
            }
        }
        url = f"{self._base_url}/v1/data/eom/schema/change_allow"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result", {})
                if isinstance(result, bool):
                    return {"allow": result, "reason": ""}
                return result
        except Exception as exc:
            log.warning(
                "opa_schema_check_failed",
                change_type=change_type,
                error=str(exc),
            )
            # Fail open in dev
            return {"allow": True, "reason": "opa_unavailable"}

    async def _query_policy(self, policy_path: str, payload: dict) -> bool:
        """POST to /v1/data/<policy_path> and return the boolean result."""
        url = f"{self._base_url}/v1/data/{policy_path}"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result", True)
                allowed = bool(result)
                log.debug(
                    "opa_policy_result",
                    policy=policy_path,
                    allowed=allowed,
                    input=payload.get("input"),
                )
                return allowed
        except Exception as exc:
            log.warning(
                "opa_unreachable",
                policy=policy_path,
                error=str(exc),
            )
            # Fail open in dev — in production configure OPA as required
            return True
