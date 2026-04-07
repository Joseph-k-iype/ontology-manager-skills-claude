"""
ActionService — all write operations against FalkorDB (meta-graph).

Every mutating operation goes through OPA first; if OPA denies, we raise
OPADenyError immediately. Write ops use parameterised Cypher via execute_cypher.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import structlog
from python_ulid import ULID

from core.exceptions import NotFoundError, OPADenyError
from db.falkordb import META_GRAPH, execute_cypher
from services.opa_service import OPAService
from services.query_service import QueryService

log = structlog.get_logger()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(ULID())


class ActionService:
    def __init__(self, opa: OPAService, query: QueryService) -> None:
        self._opa = opa
        self._query = query

    async def _gate(
        self,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str = "",
    ) -> None:
        allowed = await self._opa.check_access(user_id, action, resource_type, resource_id)
        if not allowed:
            raise OPADenyError(
                reason=f"User '{user_id}' is not allowed to perform '{action}' on {resource_type}",
                action_type=action,
                resource_id=resource_id,
            )

    # ── Spaces ────────────────────────────────────────────────────────────

    async def create_space(
        self,
        user_id: str,
        name: str,
        description: str | None,
        visibility: str,
    ) -> dict[str, Any]:
        await self._gate(user_id, "create_space", "SPACE")
        space_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Space {
                id: $id,
                name: $name,
                description: $description,
                visibility: $visibility,
                owner_id: $owner_id,
                created_at: $ts,
                updated_at: $ts
            })
            """,
            {
                "id": space_id,
                "name": name,
                "description": description or "",
                "visibility": visibility,
                "owner_id": user_id,
                "ts": ts,
            },
        )
        log.info("space_created", space_id=space_id, user_id=user_id)
        return {
            "id": space_id,
            "name": name,
            "description": description,
            "visibility": visibility,
            "owner_id": user_id,
            "created_at": ts,
            "updated_at": ts,
        }

    async def update_space(
        self,
        user_id: str,
        space_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        await self._gate(user_id, "update_space", "SPACE", space_id)
        existing = await self._query.get_space(space_id)
        if not existing:
            raise NotFoundError("Space", space_id)
        ts = _now_iso()
        set_clauses = ", ".join(f"s.{k} = ${k}" for k in updates)
        set_clauses += ", s.updated_at = $updated_at"
        params = {**updates, "id": space_id, "updated_at": ts}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (s:OntMeta_Space {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates, "updated_at": ts}
        log.info("space_updated", space_id=space_id)
        return result

    async def delete_space(self, user_id: str, space_id: str) -> None:
        await self._gate(user_id, "delete_space", "SPACE", space_id)
        existing = await self._query.get_space(space_id)
        if not existing:
            raise NotFoundError("Space", space_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (s:OntMeta_Space {id: $id}) DETACH DELETE s",
            {"id": space_id},
        )
        log.info("space_deleted", space_id=space_id)

    # ── Folders ───────────────────────────────────────────────────────────

    async def create_folder(
        self,
        user_id: str,
        space_id: str,
        name: str,
        parent_folder_id: str | None,
    ) -> dict[str, Any]:
        await self._gate(user_id, "create_folder", "SPACE", space_id)
        space = await self._query.get_space(space_id)
        if not space:
            raise NotFoundError("Space", space_id)
        folder_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Folder {
                id: $id,
                name: $name,
                space_id: $space_id,
                parent_folder_id: $parent_folder_id,
                created_at: $ts
            })
            """,
            {
                "id": folder_id,
                "name": name,
                "space_id": space_id,
                "parent_folder_id": parent_folder_id or "",
                "ts": ts,
            },
        )
        log.info("folder_created", folder_id=folder_id, space_id=space_id)
        return {
            "id": folder_id,
            "name": name,
            "space_id": space_id,
            "parent_folder_id": parent_folder_id,
            "created_at": ts,
        }

    async def update_folder(
        self,
        user_id: str,
        folder_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        existing = await self._query.get_folder(folder_id)
        if not existing:
            raise NotFoundError("Folder", folder_id)
        await self._gate(user_id, "update_folder", "FOLDER", folder_id)
        set_clauses = ", ".join(f"f.{k} = ${k}" for k in updates)
        params = {**updates, "id": folder_id}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (f:OntMeta_Folder {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates}
        log.info("folder_updated", folder_id=folder_id)
        return result

    async def delete_folder(self, user_id: str, folder_id: str) -> None:
        await self._gate(user_id, "delete_folder", "FOLDER", folder_id)
        existing = await self._query.get_folder(folder_id)
        if not existing:
            raise NotFoundError("Folder", folder_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (f:OntMeta_Folder {id: $id}) DETACH DELETE f",
            {"id": folder_id},
        )
        log.info("folder_deleted", folder_id=folder_id)

    # ── Ontologies ────────────────────────────────────────────────────────

    async def create_ontology(
        self,
        user_id: str,
        folder_id: str,
        name: str,
        description: str | None,
    ) -> dict[str, Any]:
        folder = await self._query.get_folder(folder_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)
        space_id = folder.get("space_id", "")
        await self._gate(user_id, "create_ontology", "FOLDER", folder_id)
        ontology_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Ontology {
                id: $id,
                name: $name,
                description: $description,
                folder_id: $folder_id,
                space_id: $space_id,
                version: $version,
                status: $status,
                created_at: $ts,
                updated_at: $ts
            })
            """,
            {
                "id": ontology_id,
                "name": name,
                "description": description or "",
                "folder_id": folder_id,
                "space_id": space_id,
                "version": "0.1.0",
                "status": "DRAFT",
                "ts": ts,
            },
        )
        log.info("ontology_created", ontology_id=ontology_id, folder_id=folder_id)
        return {
            "id": ontology_id,
            "name": name,
            "description": description,
            "folder_id": folder_id,
            "space_id": space_id,
            "version": "0.1.0",
            "status": "DRAFT",
            "created_at": ts,
            "updated_at": ts,
        }

    async def update_ontology(
        self,
        user_id: str,
        ontology_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        existing = await self._query.get_ontology(ontology_id)
        if not existing:
            raise NotFoundError("Ontology", ontology_id)
        await self._gate(user_id, "update_ontology", "ONTOLOGY", ontology_id)
        ts = _now_iso()
        updates["updated_at"] = ts
        set_clauses = ", ".join(f"o.{k} = ${k}" for k in updates)
        params = {**updates, "id": ontology_id}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (o:OntMeta_Ontology {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates}
        log.info("ontology_updated", ontology_id=ontology_id)
        return result

    async def publish_ontology(self, user_id: str, ontology_id: str) -> dict[str, Any]:
        existing = await self._query.get_ontology(ontology_id)
        if not existing:
            raise NotFoundError("Ontology", ontology_id)
        await self._gate(user_id, "publish_ontology", "ONTOLOGY", ontology_id)
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            "MATCH (o:OntMeta_Ontology {id: $id}) SET o.status = 'PUBLISHED', o.updated_at = $ts",
            {"id": ontology_id, "ts": ts},
        )
        result = {**existing, "status": "PUBLISHED", "updated_at": ts}
        log.info("ontology_published", ontology_id=ontology_id)
        return result

    async def delete_ontology(self, user_id: str, ontology_id: str) -> None:
        await self._gate(user_id, "delete_ontology", "ONTOLOGY", ontology_id)
        existing = await self._query.get_ontology(ontology_id)
        if not existing:
            raise NotFoundError("Ontology", ontology_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (o:OntMeta_Ontology {id: $id}) DETACH DELETE o",
            {"id": ontology_id},
        )
        log.info("ontology_deleted", ontology_id=ontology_id)

    # ── Object Types ──────────────────────────────────────────────────────

    async def create_object_type(
        self,
        user_id: str,
        ontology_id: str,
        api_name: str,
        display_name: str,
        description: str | None,
        primary_key: str,
        is_skos_concept: bool,
        is_skos_concept_scheme: bool,
    ) -> dict[str, Any]:
        ontology = await self._query.get_ontology(ontology_id)
        if not ontology:
            raise NotFoundError("Ontology", ontology_id)
        await self._gate(user_id, "create_object_type", "ONTOLOGY", ontology_id)

        opa_result = await self._opa.check_schema_change(
            "create_object_type",
            {"api_name": api_name, "ontology_id": ontology_id},
        )
        if not opa_result.get("allow", True):
            raise OPADenyError(
                reason=opa_result.get("reason", "Schema change denied"),
                action_type="create_object_type",
                resource_id=ontology_id,
            )

        ot_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_ObjectType {
                id: $id,
                api_name: $api_name,
                display_name: $display_name,
                description: $description,
                primary_key: $primary_key,
                is_skos_concept: $is_skos_concept,
                is_skos_concept_scheme: $is_skos_concept_scheme,
                ontology_id: $ontology_id,
                created_at: $ts
            })
            """,
            {
                "id": ot_id,
                "api_name": api_name,
                "display_name": display_name,
                "description": description or "",
                "primary_key": primary_key,
                "is_skos_concept": is_skos_concept,
                "is_skos_concept_scheme": is_skos_concept_scheme,
                "ontology_id": ontology_id,
                "ts": ts,
            },
        )
        log.info("object_type_created", ot_id=ot_id, ontology_id=ontology_id)
        return {
            "id": ot_id,
            "api_name": api_name,
            "display_name": display_name,
            "description": description,
            "primary_key": primary_key,
            "is_skos_concept": is_skos_concept,
            "is_skos_concept_scheme": is_skos_concept_scheme,
            "ontology_id": ontology_id,
            "created_at": ts,
        }

    async def update_object_type(
        self,
        user_id: str,
        object_type_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        existing = await self._query.get_object_type(object_type_id)
        if not existing:
            raise NotFoundError("ObjectType", object_type_id)
        await self._gate(user_id, "update_object_type", "OBJECT_TYPE", object_type_id)
        set_clauses = ", ".join(f"ot.{k} = ${k}" for k in updates)
        params = {**updates, "id": object_type_id}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (ot:OntMeta_ObjectType {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates}
        log.info("object_type_updated", object_type_id=object_type_id)
        return result

    async def delete_object_type(self, user_id: str, object_type_id: str) -> None:
        await self._gate(user_id, "delete_object_type", "OBJECT_TYPE", object_type_id)
        existing = await self._query.get_object_type(object_type_id)
        if not existing:
            raise NotFoundError("ObjectType", object_type_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (ot:OntMeta_ObjectType {id: $id}) DETACH DELETE ot",
            {"id": object_type_id},
        )
        log.info("object_type_deleted", object_type_id=object_type_id)

    # ── Properties ────────────────────────────────────────────────────────

    async def create_property(
        self,
        user_id: str,
        object_type_id: str,
        api_name: str,
        display_name: str,
        data_type: str,
        required: bool,
        skos_mapping: str | None,
    ) -> dict[str, Any]:
        ot = await self._query.get_object_type(object_type_id)
        if not ot:
            raise NotFoundError("ObjectType", object_type_id)
        await self._gate(user_id, "create_property", "OBJECT_TYPE", object_type_id)
        prop_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Property {
                id: $id,
                api_name: $api_name,
                display_name: $display_name,
                data_type: $data_type,
                required: $required,
                skos_mapping: $skos_mapping,
                object_type_id: $object_type_id,
                created_at: $ts
            })
            """,
            {
                "id": prop_id,
                "api_name": api_name,
                "display_name": display_name,
                "data_type": data_type,
                "required": required,
                "skos_mapping": skos_mapping or "",
                "object_type_id": object_type_id,
                "ts": ts,
            },
        )
        log.info("property_created", prop_id=prop_id, object_type_id=object_type_id)
        return {
            "id": prop_id,
            "api_name": api_name,
            "display_name": display_name,
            "data_type": data_type,
            "required": required,
            "skos_mapping": skos_mapping,
            "object_type_id": object_type_id,
            "created_at": ts,
        }

    async def update_property(
        self,
        user_id: str,
        property_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        existing = await self._query.get_property(property_id)
        if not existing:
            raise NotFoundError("Property", property_id)
        await self._gate(user_id, "update_property", "PROPERTY", property_id)
        set_clauses = ", ".join(f"p.{k} = ${k}" for k in updates)
        params = {**updates, "id": property_id}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (p:OntMeta_Property {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates}
        log.info("property_updated", property_id=property_id)
        return result

    async def delete_property(self, user_id: str, property_id: str) -> None:
        await self._gate(user_id, "delete_property", "PROPERTY", property_id)
        existing = await self._query.get_property(property_id)
        if not existing:
            raise NotFoundError("Property", property_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (p:OntMeta_Property {id: $id}) DETACH DELETE p",
            {"id": property_id},
        )
        log.info("property_deleted", property_id=property_id)

    # ── Relationships ─────────────────────────────────────────────────────

    async def create_relationship(
        self,
        user_id: str,
        ontology_id: str,
        api_name: str,
        source_object_type_id: str,
        target_object_type_id: str,
        cardinality: str,
    ) -> dict[str, Any]:
        ontology = await self._query.get_ontology(ontology_id)
        if not ontology:
            raise NotFoundError("Ontology", ontology_id)
        await self._gate(user_id, "create_relationship", "ONTOLOGY", ontology_id)
        rel_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Relationship {
                id: $id,
                api_name: $api_name,
                source_object_type_id: $source_object_type_id,
                target_object_type_id: $target_object_type_id,
                cardinality: $cardinality,
                ontology_id: $ontology_id,
                created_at: $ts
            })
            """,
            {
                "id": rel_id,
                "api_name": api_name,
                "source_object_type_id": source_object_type_id,
                "target_object_type_id": target_object_type_id,
                "cardinality": cardinality,
                "ontology_id": ontology_id,
                "ts": ts,
            },
        )
        log.info("relationship_created", rel_id=rel_id, ontology_id=ontology_id)
        return {
            "id": rel_id,
            "api_name": api_name,
            "source_object_type_id": source_object_type_id,
            "target_object_type_id": target_object_type_id,
            "cardinality": cardinality,
            "ontology_id": ontology_id,
            "created_at": ts,
        }

    async def update_relationship(
        self,
        user_id: str,
        relationship_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        existing = await self._query.get_relationship(relationship_id)
        if not existing:
            raise NotFoundError("Relationship", relationship_id)
        await self._gate(user_id, "update_relationship", "RELATIONSHIP", relationship_id)
        set_clauses = ", ".join(f"r.{k} = ${k}" for k in updates)
        params = {**updates, "id": relationship_id}
        await execute_cypher(
            META_GRAPH,
            f"MATCH (r:OntMeta_Relationship {{id: $id}}) SET {set_clauses}",
            params,
        )
        result = {**existing, **updates}
        log.info("relationship_updated", relationship_id=relationship_id)
        return result

    async def delete_relationship(self, user_id: str, relationship_id: str) -> None:
        await self._gate(user_id, "delete_relationship", "RELATIONSHIP", relationship_id)
        existing = await self._query.get_relationship(relationship_id)
        if not existing:
            raise NotFoundError("Relationship", relationship_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (r:OntMeta_Relationship {id: $id}) DETACH DELETE r",
            {"id": relationship_id},
        )
        log.info("relationship_deleted", relationship_id=relationship_id)

    # ── Permissions ───────────────────────────────────────────────────────

    async def create_permission(
        self,
        user_id: str,
        resource_type: str,
        resource_id: str,
        subject_type: str,
        subject_id: str,
        actions: list[str],
        policy_type: str,
        abac_condition: str | None,
    ) -> dict[str, Any]:
        await self._gate(user_id, "create_permission", resource_type, resource_id)
        perm_id = _new_id()
        ts = _now_iso()
        await execute_cypher(
            META_GRAPH,
            """
            CREATE (:OntMeta_Permission {
                id: $id,
                resource_type: $resource_type,
                resource_id: $resource_id,
                subject_type: $subject_type,
                subject_id: $subject_id,
                actions: $actions,
                policy_type: $policy_type,
                abac_condition: $abac_condition,
                created_at: $ts
            })
            """,
            {
                "id": perm_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "subject_type": subject_type,
                "subject_id": subject_id,
                "actions": json.dumps(actions),
                "policy_type": policy_type,
                "abac_condition": abac_condition or "",
                "ts": ts,
            },
        )
        log.info("permission_created", perm_id=perm_id, resource_id=resource_id)
        return {
            "id": perm_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "actions": actions,
            "policy_type": policy_type,
            "abac_condition": abac_condition,
            "created_at": ts,
        }

    async def delete_permission(self, user_id: str, permission_id: str) -> None:
        existing = await self._query.get_permission(permission_id)
        if not existing:
            raise NotFoundError("Permission", permission_id)
        resource_type = existing.get("resource_type", "")
        resource_id = existing.get("resource_id", "")
        await self._gate(user_id, "delete_permission", resource_type, resource_id)
        await execute_cypher(
            META_GRAPH,
            "MATCH (perm:OntMeta_Permission {id: $id}) DETACH DELETE perm",
            {"id": permission_id},
        )
        log.info("permission_deleted", permission_id=permission_id)
