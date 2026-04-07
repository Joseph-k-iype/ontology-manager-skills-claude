"""
SchemaService — compiles ontology YAML manifests into FalkorDB DDL and ES mappings.

YAML is the source of truth. This service derives FalkorDB node-label
indexes and Elasticsearch index mappings from it, then triggers
index creation via the db helpers.
"""
from __future__ import annotations

from typing import Any

import structlog

from db.falkordb import META_GRAPH, execute_cypher
from db.elasticsearch import ensure_index

log = structlog.get_logger()

# Mapping from ontology property data types to ES field types
_ES_TYPE_MAP: dict[str, str] = {
    "string": "text",
    "integer": "integer",
    "float": "float",
    "boolean": "boolean",
    "date": "date",
    "datetime": "date",
    "uri": "keyword",
}


class SchemaService:
    """
    Compile an ontology (by ID) into:
      1. FalkorDB label-indexes for the data graph
      2. Elasticsearch index mapping for each ObjectType
    """

    async def compile_ontology(self, space_id: str, ontology_id: str) -> dict[str, Any]:
        """
        Read all ObjectTypes + Properties from the meta-graph for this ontology,
        then create FalkorDB indexes and ES mappings for each one.

        Returns a summary dict with counts of what was compiled.
        """
        # Fetch object types
        ot_rows = await execute_cypher(
            META_GRAPH,
            "MATCH (ot:OntMeta_ObjectType {ontology_id: $ontology_id}) RETURN ot",
            {"ontology_id": ontology_id},
        )

        compiled_types = 0
        compiled_indexes = 0

        for row in ot_rows:
            ot = row.get("ot")
            props_raw = ot.properties if hasattr(ot, "properties") else ot
            api_name: str = props_raw.get("api_name", "")
            if not api_name:
                continue

            # Fetch properties for this object type
            ot_id = props_raw.get("id", "")
            prop_rows = await execute_cypher(
                META_GRAPH,
                "MATCH (p:OntMeta_Property {object_type_id: $ot_id}) RETURN p",
                {"ot_id": ot_id},
            )

            # Build ES mapping
            es_properties: dict[str, Any] = {
                "_eom_id": {"type": "keyword"},
                "_eom_type": {"type": "keyword"},
                "_eom_space_id": {"type": "keyword"},
                "_eom_ontology_id": {"type": "keyword"},
                "_eom_created_at": {"type": "date"},
                "_eom_updated_at": {"type": "date"},
            }

            for prop_row in prop_rows:
                p = prop_row.get("p")
                p_data = p.properties if hasattr(p, "properties") else p
                p_api_name: str = p_data.get("api_name", "")
                p_data_type: str = p_data.get("data_type", "string")
                es_type = _ES_TYPE_MAP.get(p_data_type, "keyword")
                if es_type == "text":
                    es_properties[p_api_name] = {
                        "type": "text",
                        "fields": {"keyword": {"type": "keyword", "ignore_above": 256}},
                    }
                else:
                    es_properties[p_api_name] = {"type": es_type}

            es_mapping = {
                "mappings": {
                    "properties": es_properties,
                }
            }

            # Create versioned index + alias
            index_name = f"eom_{space_id}_{api_name}_v1"
            alias_name = f"eom_{space_id}_{api_name}"
            await ensure_index(index_name, es_mapping)

            # Create FalkorDB data-graph label index
            data_graph = f"eom_{space_id}_data"
            label = f"ObjType_{api_name}"
            try:
                await execute_cypher(
                    data_graph,
                    f"CREATE INDEX FOR (n:{label}) ON (n.id)",
                    {},
                )
                compiled_indexes += 1
            except Exception as exc:
                if "already indexed" not in str(exc).lower() and "equivalent index" not in str(exc).lower():
                    log.warning("data_graph_index_warning", label=label, error=str(exc))

            compiled_types += 1
            log.info(
                "object_type_compiled",
                api_name=api_name,
                index=index_name,
                alias=alias_name,
            )

        return {
            "ontology_id": ontology_id,
            "space_id": space_id,
            "compiled_object_types": compiled_types,
            "created_indexes": compiled_indexes,
        }

    def build_es_mapping(self, properties: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Build an ES mapping body from a list of property dicts.

        Each dict must have: api_name (str), data_type (str).
        """
        es_props: dict[str, Any] = {}
        for prop in properties:
            api_name = prop.get("api_name", "")
            data_type = prop.get("data_type", "string")
            es_type = _ES_TYPE_MAP.get(data_type, "keyword")
            if es_type == "text":
                es_props[api_name] = {
                    "type": "text",
                    "fields": {"keyword": {"type": "keyword", "ignore_above": 256}},
                }
            else:
                es_props[api_name] = {"type": es_type}
        return {"mappings": {"properties": es_props}}

    def build_cypher_label(self, api_name: str) -> str:
        """Return the FalkorDB node label for an ObjectType api_name."""
        return f"ObjType_{api_name}"

    def build_link_type(self, api_name: str) -> str:
        """Return the FalkorDB relationship type for a Relationship api_name."""
        return f"LINK_{api_name.upper()}"
