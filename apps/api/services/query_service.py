"""
QueryService — all read operations against FalkorDB (meta-graph).

Every method returns typed dicts that the routers convert to Pydantic models.
"""
from __future__ import annotations

from typing import Any

import structlog

from db.falkordb import META_GRAPH, execute_cypher

log = structlog.get_logger()


def _node_to_dict(row: dict[str, Any], alias: str) -> dict[str, Any]:
    """
    FalkorDB returns Node objects for RETURN n style queries.
    Extract .properties from the Node, or return the row value directly
    if it's already a plain dict (query with individual RETURN fields).
    """
    value = row.get(alias)
    if value is None:
        return {}
    if hasattr(value, "properties"):
        return dict(value.properties)
    if isinstance(value, dict):
        return value
    return {}


class QueryService:
    # ── Spaces ────────────────────────────────────────────────────────────

    async def get_space(self, space_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (s:OntMeta_Space {id: $id}) RETURN s",
            {"id": space_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "s")

    async def list_spaces(
        self,
        limit: int = 50,
        offset: int = 0,
        owner_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if owner_id:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (s:OntMeta_Space {owner_id: $owner_id}) RETURN s ORDER BY s.created_at DESC SKIP $offset LIMIT $limit",
                {"owner_id": owner_id, "offset": offset, "limit": limit},
            )
        else:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (s:OntMeta_Space) RETURN s ORDER BY s.created_at DESC SKIP $offset LIMIT $limit",
                {"offset": offset, "limit": limit},
            )
        return [_node_to_dict(r, "s") for r in rows]

    # ── Folders ───────────────────────────────────────────────────────────

    async def get_folder(self, folder_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (f:OntMeta_Folder {id: $id}) RETURN f",
            {"id": folder_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "f")

    async def list_folders(self, space_id: str) -> list[dict[str, Any]]:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (f:OntMeta_Folder {space_id: $space_id}) RETURN f ORDER BY f.created_at ASC",
            {"space_id": space_id},
        )
        return [_node_to_dict(r, "f") for r in rows]

    # ── Ontologies ────────────────────────────────────────────────────────

    async def get_ontology(self, ontology_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (o:OntMeta_Ontology {id: $id}) RETURN o",
            {"id": ontology_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "o")

    async def list_ontologies(self, folder_id: str) -> list[dict[str, Any]]:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (o:OntMeta_Ontology {folder_id: $folder_id}) RETURN o ORDER BY o.created_at ASC",
            {"folder_id": folder_id},
        )
        return [_node_to_dict(r, "o") for r in rows]

    # ── Object Types ──────────────────────────────────────────────────────

    async def get_object_type(self, object_type_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (ot:OntMeta_ObjectType {id: $id}) RETURN ot",
            {"id": object_type_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "ot")

    async def list_object_types(self, ontology_id: str) -> list[dict[str, Any]]:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (ot:OntMeta_ObjectType {ontology_id: $ontology_id}) RETURN ot ORDER BY ot.created_at ASC",
            {"ontology_id": ontology_id},
        )
        return [_node_to_dict(r, "ot") for r in rows]

    # ── Properties ────────────────────────────────────────────────────────

    async def get_property(self, property_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (p:OntMeta_Property {id: $id}) RETURN p",
            {"id": property_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "p")

    async def list_properties(self, object_type_id: str) -> list[dict[str, Any]]:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (p:OntMeta_Property {object_type_id: $object_type_id}) RETURN p ORDER BY p.created_at ASC",
            {"object_type_id": object_type_id},
        )
        return [_node_to_dict(r, "p") for r in rows]

    # ── Relationships ─────────────────────────────────────────────────────

    async def get_relationship(self, relationship_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (r:OntMeta_Relationship {id: $id}) RETURN r",
            {"id": relationship_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "r")

    async def list_relationships(self, ontology_id: str) -> list[dict[str, Any]]:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (r:OntMeta_Relationship {ontology_id: $ontology_id}) RETURN r ORDER BY r.created_at ASC",
            {"ontology_id": ontology_id},
        )
        return [_node_to_dict(r, "r") for r in rows]

    # ── Permissions ───────────────────────────────────────────────────────

    async def get_permission(self, permission_id: str) -> dict[str, Any] | None:
        rows = await execute_cypher(
            META_GRAPH,
            "MATCH (perm:OntMeta_Permission {id: $id}) RETURN perm",
            {"id": permission_id},
        )
        if not rows:
            return None
        return _node_to_dict(rows[0], "perm")

    async def list_permissions(
        self,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if resource_type and resource_id:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (perm:OntMeta_Permission {resource_type: $rt, resource_id: $rid}) RETURN perm ORDER BY perm.created_at ASC",
                {"rt": resource_type, "rid": resource_id},
            )
        elif resource_type:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (perm:OntMeta_Permission {resource_type: $rt}) RETURN perm ORDER BY perm.created_at ASC",
                {"rt": resource_type},
            )
        elif resource_id:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (perm:OntMeta_Permission {resource_id: $rid}) RETURN perm ORDER BY perm.created_at ASC",
                {"rid": resource_id},
            )
        else:
            rows = await execute_cypher(
                META_GRAPH,
                "MATCH (perm:OntMeta_Permission) RETURN perm ORDER BY perm.created_at ASC",
                {},
            )
        return [_node_to_dict(r, "perm") for r in rows]
