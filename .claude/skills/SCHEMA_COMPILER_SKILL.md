# Schema Compiler Skill

> The Schema Compiler reads YAML manifests from a Git worktree and produces
> FalkorDB DDL, Elasticsearch mappings, compiled Cypher transaction templates,
> and meta-graph update operations. It is the core of the Schema Service.

---

## Compiler Pipeline

```
YAML manifests (Git worktree)
        │
        ▼
   YAMLParser           → Pydantic models (validated)
        │
        ├─► FalkorDBCompiler   → Cypher DDL strings (node labels, indices, UDFs)
        │
        ├─► ESMappingCompiler  → Elasticsearch mapping JSON dicts
        │
        ├─► CypherTemplateCompiler → Parameterised Cypher write scripts for ActionTypes
        │
        └─► MetaGraphCompiler  → Cypher statements to update eom_meta graph
```

---

## YAML Parser

```python
# packages/eom-cli/eom_cli/compiler/yaml_parser.py
import yaml
from pathlib import Path
from pydantic import ValidationError
from apps.api.models import (
    ObjectTypeModel, LinkTypeModel, SharedPropertyModel,
    InterfaceModel, ActionTypeModel, ValueTypeModel,
)

class YAMLParser:
    def __init__(self, worktree_path: str):
        self.root = Path(worktree_path)

    def parse_all(self) -> dict:
        return {
            "object_types":      self._parse_dir("object-types", ObjectTypeModel),
            "link_types":        self._parse_dir("link-types",   LinkTypeModel),
            "shared_properties": self._parse_dir("shared-properties", SharedPropertyModel),
            "interfaces":        self._parse_dir("interfaces",   InterfaceModel),
            "value_types":       self._parse_dir("value-types",  ValueTypeModel),
        }

    def _parse_dir(self, subdir: str, model_class) -> dict:
        results = {}
        target  = self.root / subdir
        if not target.exists():
            return results
        for yaml_file in target.rglob("schema.yaml"):
            with open(yaml_file) as f:
                raw = yaml.safe_load(f)
            try:
                instance = model_class.model_validate(raw)
                results[instance.api_name] = instance
            except ValidationError as e:
                raise ValueError(f"Invalid YAML in {yaml_file}: {e}")
        return results
```

---

## FalkorDB DDL Compiler

```python
# packages/eom-cli/eom_cli/compiler/cypher_compiler.py

class FalkorDBCompiler:
    def compile(self, parsed: dict) -> list[str]:
        statements = []
        for name, ot in parsed["object_types"].items():
            statements.extend(self._compile_object_type(ot, parsed))
        for name, lt in parsed["link_types"].items():
            statements.extend(self._compile_link_type(lt))
        return statements

    def _compile_object_type(self, ot, parsed: dict) -> list[str]:
        label    = f"ObjType_{ot.api_name}"
        stmts    = []

        # Primary key index (always)
        stmts.append(
            f"CREATE INDEX IF NOT EXISTS FOR (n:{label}) ON (n._eom_id)"
        )

        # Status index if object type has a status property
        has_status = any(p.api_name == "status" for p in ot.properties)
        if has_status:
            stmts.append(
                f"CREATE INDEX IF NOT EXISTS FOR (n:{label}) ON (n.status)"
            )

        # Additional indexed properties
        for prop in ot.properties:
            if prop.is_indexed:
                stmts.append(
                    f"CREATE INDEX IF NOT EXISTS FOR (n:{label}) ON (n.{prop.api_name})"
                )

        # Vector index if embeddings enabled
        if ot.enable_embeddings:
            dims = 1536  # from config
            stmts.append(
                f"CREATE VECTOR INDEX IF NOT EXISTS FOR (n:{label}) ON (n._embedding) "
                f"OPTIONS {{dimension: {dims}, similarityFunction: 'cosine'}}"
            )

        return stmts

    def _compile_link_type(self, lt) -> list[str]:
        rel_type = f"LINK_{lt.api_name.upper()}"
        stmts    = []
        if lt.is_temporally_bounded:
            stmts.append(
                f"CREATE INDEX IF NOT EXISTS FOR ()-[r:{rel_type}]->() ON (r.valid_from)"
            )
        return stmts

    def compile_udf_registrations(self, object_types: dict) -> str:
        """
        Generate JavaScript UDF source for all derived properties.
        Returns a single JS string to be loaded as the 'EomDerived' library.
        """
        functions = []
        for name, ot in object_types.items():
            for prop in ot.properties:
                if prop.derived_expression:
                    fn_name = f"derive_{ot.api_name}_{prop.api_name}"
                    fn_body = self._expression_to_js(prop.derived_expression)
                    functions.append(
                        f"function {fn_name}(node) {{\n  {fn_body}\n}}\n"
                        f"falkor.register('{fn_name}', {fn_name});"
                    )
        return "\n\n".join(functions)

    def _expression_to_js(self, expression: str) -> str:
        """
        Convert a simple EOM expression to JavaScript.
        Expression syntax: "concat(firstName, ' ', lastName)"
        """
        # Simple expression transpiler — extend as needed
        mapping = {
            "concat":      "return [].slice.call(arguments).join('');",
            "coalesce":    "for (var i=0; i<arguments.length; i++) { if (arguments[i] != null) return arguments[i]; } return null;",
            "to_upper":    "return String(arguments[0]).toUpperCase();",
        }
        for fn, impl in mapping.items():
            if expression.startswith(fn + "("):
                return impl
        # Passthrough raw expression
        return f"return {expression};"
```

---

## Elasticsearch Mapping Compiler

```python
# packages/eom-cli/eom_cli/compiler/es_mapper.py
import json
from apps.api.models import ObjectTypeModel, PropertyModel
from apps.api.services.schema_service import BASE_MAPPING

ES_FIELD_TYPE_MAP = {
    "String":        {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}},
    "Keyword":       {"type": "keyword"},
    "Integer":       {"type": "integer"},
    "Long":          {"type": "long"},
    "Double":        {"type": "double"},
    "Boolean":       {"type": "boolean"},
    "Timestamp":     {"type": "date", "format": "epoch_millis||strict_date_time"},
    "Date":          {"type": "date", "format": "strict_date"},
    "GeoPoint":      {"type": "geo_point"},
    "GeoShape":      {"type": "geo_shape"},
    "Struct":        {"type": "object", "dynamic": False},
    "TimeseriesRef": {"type": "keyword"},
    "MediaRef":      {"type": "keyword"},
    "AttachmentRef": {"type": "keyword"},
}

class ESMappingCompiler:
    def compile(self, ot: ObjectTypeModel, shared_props: dict) -> dict:
        """Returns a complete ES mapping dict for this Object Type."""
        import copy
        mapping = copy.deepcopy(BASE_MAPPING)
        props   = mapping["mappings"]["properties"]

        # User-defined properties
        for prop in ot.properties:
            if prop.base_type == "Struct":
                props[prop.api_name] = self._compile_struct(prop)
            else:
                props[prop.api_name] = ES_FIELD_TYPE_MAP.get(
                    prop.base_type,
                    {"type": "keyword"}
                )

        # Shared properties (from interfaces + direct refs)
        all_shared = self._collect_shared_props(ot, shared_props)
        for sp_name, sp in all_shared.items():
            props[sp_name] = ES_FIELD_TYPE_MAP.get(sp.base_type, {"type": "keyword"})

        # Nested link summaries (denormalised for join-free querying)
        for lt_ref in ot.link_types:
            props[lt_ref.api_name] = {
                "type": "nested",
                "dynamic": False,
                "properties": {
                    "_eom_id":      {"type": "keyword"},
                    "display_name": {"type": "keyword"},
                },
            }

        # Embedding dims from config
        if ot.enable_embeddings:
            from apps.api.config import settings
            props["_embedding"]["dims"] = settings.embedding_vector_dims

        return mapping

    def _compile_struct(self, prop: PropertyModel) -> dict:
        if not prop.struct_fields:
            return {"type": "object", "dynamic": False}
        return {
            "type": "object",
            "dynamic": False,
            "properties": {
                f.api_name: ES_FIELD_TYPE_MAP.get(f.base_type, {"type": "keyword"})
                for f in prop.struct_fields
            },
        }

    def _collect_shared_props(self, ot: ObjectTypeModel, all_shared: dict) -> dict:
        result = {}
        # Direct shared property references
        for ref in ot.shared_property_refs:
            if ref in all_shared:
                result[ref] = all_shared[ref]
        # Via interfaces
        # (interfaces resolved transitively by the parser before this step)
        return result
```

---

## Cypher Template Compiler (Action Types)

```python
# packages/eom-cli/eom_cli/compiler/cypher_template_compiler.py
from apps.api.models import ActionTypeModel, EditDescriptor

class CypherTemplateCompiler:
    """
    Compiles an Action Type YAML definition into a parameterised Cypher
    write template.

    The template uses $param_name placeholders that the Action Service
    substitutes at runtime before calling FalkorDB.

    Output is stored as a .cypher file alongside the action type YAML.
    """

    def compile(self, action: ActionTypeModel, space_id: str) -> str:
        lines = [
            f"-- Auto-generated Cypher template for action: {action.api_name}",
            f"-- Object type: {action.target_object_type}",
            f"-- Generated by EOM Schema Compiler",
            "",
        ]

        # Step 1: MATCH target object (always first)
        label = f"ObjType_{action.target_object_type}"
        lines += [
            f"-- Step 1: Match target object",
            f"MATCH (target:{label} {{_eom_id: $object_id, _eom_space_id: $space_id}})",
            "",
        ]

        # Step 2: Submission criteria check — embedded as WHERE clauses
        if action.submission_criteria:
            criteria_clauses = self._compile_criteria(action.submission_criteria)
            lines += [
                "-- Step 2: Submission criteria",
                f"WHERE {' AND '.join(criteria_clauses)}",
                "",
            ]

        # Step 3: MATCH objects referenced by ObjectRef parameters
        for param in action.parameters:
            if param.object_ref:
                ref_label = f"ObjType_{param.object_ref}"
                lines += [
                    f"-- Match {param.name} reference",
                    f"WITH target",
                    f"MATCH (ref_{param.name}:{ref_label} {{_eom_id: ${param.name}, _eom_space_id: $space_id}})",
                    "",
                ]

        # Step 4: Apply SET operations
        set_clauses   = self._compile_set_edits(action)
        create_stmts  = self._compile_create_edits(action)
        delete_stmts  = self._compile_delete_edits(action)

        if set_clauses:
            lines += [
                "-- Step 3: Apply property edits",
                "SET " + ",\n    ".join(set_clauses),
                "",
            ]

        if create_stmts:
            lines += ["-- Step 4: Create links"] + create_stmts + [""]

        if delete_stmts:
            lines += ["-- Step 5: Delete links"] + delete_stmts + [""]

        # Step 5: Return
        lines += [
            "-- Return",
            "RETURN target._eom_id AS object_id, 'SUCCESS' AS status",
        ]

        return "\n".join(lines)

    def _compile_criteria(self, criteria: list) -> list[str]:
        clauses = []
        op_map  = {
            "EQUALS":      "=",
            "NOT_EQUALS":  "<>",
            "GT":          ">",
            "LT":          "<",
            "IS_NULL":     "IS NULL",
            "IS_NOT_NULL": "IS NOT NULL",
        }
        for c in criteria:
            op = op_map.get(c.operator, "=")
            if c.operator in ("IS_NULL", "IS_NOT_NULL"):
                clauses.append(f"target.{c.property} {op}")
            elif c.value_is_literal:
                val = f"'{c.value}'" if isinstance(c.value, str) else str(c.value)
                clauses.append(f"target.{c.property} {op} {val}")
            else:
                clauses.append(f"target.{c.property} {op} ${c.value_param}")
        return clauses

    def _compile_set_edits(self, action: ActionTypeModel) -> list[str]:
        clauses = [
            "target._last_action    = $__action_type",
            "target._last_actor     = $__actor_id",
            "target._last_action_at = timestamp()",
            "target._eom_updated_at = timestamp()",
        ]
        for edit in action.edits:
            if edit.type == "SET_PROPERTY":
                if edit.value_from_param:
                    clauses.append(f"target.{edit.property} = ${edit.value_from_param}")
                elif edit.value is not None:
                    val = f"'{edit.value}'" if isinstance(edit.value, str) else str(edit.value)
                    clauses.append(f"target.{edit.property} = {val}")
        return clauses

    def _compile_create_edits(self, action: ActionTypeModel) -> list[str]:
        stmts = []
        for edit in action.edits:
            if edit.type == "CREATE_LINK":
                rel = f"LINK_{edit.link_type.upper()}"
                stmts.append(
                    f"CREATE (target)-[:{rel} {{"
                    f"_link_type: '{edit.link_type}', "
                    f"_created_by: $__actor_id, "
                    f"_created_at: timestamp(), "
                    f"_action_ref: $__action_type"
                    f"}}]->(ref_{edit.target_id_from_param})"
                )
        return stmts

    def _compile_delete_edits(self, action: ActionTypeModel) -> list[str]:
        stmts = []
        for edit in action.edits:
            if edit.type == "DELETE_LINK":
                rel = f"LINK_{edit.link_type.upper()}"
                stmts.append(
                    f"OPTIONAL MATCH (target)-[r_{edit.link_type}:{rel}]->()"
                    f"\nDELETE r_{edit.link_type}"
                )
        return stmts
```

---

## Meta-Graph Compiler

```python
# packages/eom-cli/eom_cli/compiler/meta_graph_compiler.py

class MetaGraphCompiler:
    """
    Produces a list of Cypher statements to update the eom_meta graph
    when an ontology is published.
    """
    def compile(self, parsed: dict, space_id: str) -> list[str]:
        stmts = []

        # Upsert Space node
        stmts.append(
            f"MERGE (s:OntMeta_Space {{id: '{space_id}'}}) "
            f"SET s.updated_at = timestamp()"
        )

        # Upsert Object Types
        for api_name, ot in parsed["object_types"].items():
            stmts.append(self._upsert_object_type(ot, space_id))
            for prop in ot.properties:
                stmts.append(self._upsert_property(prop, api_name, space_id))
            for interface_name in ot.interfaces:
                stmts.append(self._link_to_interface(api_name, interface_name, space_id))
            for at in ot.action_types:
                stmts.append(self._upsert_action_type(at, api_name, space_id))

        # Upsert Shared Properties
        for sp_name, sp in parsed["shared_properties"].items():
            stmts.append(self._upsert_shared_property(sp, space_id))

        # Upsert Link Types
        for lt_name, lt in parsed["link_types"].items():
            stmts.append(self._upsert_link_type(lt, space_id))

        # Upsert Interfaces
        for iname, iface in parsed["interfaces"].items():
            stmts.append(self._upsert_interface(iface, space_id))

        return stmts

    def _upsert_object_type(self, ot, space_id: str) -> str:
        return (
            f"MERGE (ot:OntMeta_ObjectType {{api_name: '{ot.api_name}', space_id: '{space_id}'}}) "
            f"SET ot.display_name = '{ot.display_name}', "
            f"    ot.status       = '{ot.status}', "
            f"    ot.domain       = '{ot.domain}', "
            f"    ot.version      = '{ot.version}', "
            f"    ot.falkor_label = 'ObjType_{ot.api_name}', "
            f"    ot.es_alias     = 'eom_{space_id}_{ot.api_name}', "
            f"    ot.updated_at   = timestamp() "
            f"WITH ot "
            f"MATCH (s:OntMeta_Space {{id: '{space_id}'}}) "
            f"MERGE (ot)-[:BELONGS_TO_SPACE]->(s)"
        )

    def _upsert_property(self, prop, object_type: str, space_id: str) -> str:
        return (
            f"MERGE (p:OntMeta_Property {{api_name: '{prop.api_name}', "
            f"       parent_type: '{object_type}', space_id: '{space_id}'}}) "
            f"SET p.base_type   = '{prop.base_type}', "
            f"    p.is_required = {str(prop.is_required).lower()}, "
            f"    p.is_shared   = {str(prop.is_shared).lower()} "
            f"WITH p "
            f"MATCH (ot:OntMeta_ObjectType {{api_name: '{object_type}', space_id: '{space_id}'}}) "
            f"MERGE (ot)-[:HAS_PROPERTY]->(p)"
        )

    def _upsert_action_type(self, at, object_type: str, space_id: str) -> str:
        return (
            f"MERGE (at:OntMeta_ActionType {{api_name: '{at.api_name}', space_id: '{space_id}'}}) "
            f"SET at.display_name        = '{at.display_name}', "
            f"    at.target_object_type  = '{object_type}', "
            f"    at.compiled_cypher_ref = 'object-types/{object_type}/action-types/{at.api_name}.cypher' "
            f"WITH at "
            f"MATCH (ot:OntMeta_ObjectType {{api_name: '{object_type}', space_id: '{space_id}'}}) "
            f"MERGE (ot)-[:HAS_ACTION_TYPE]->(at)"
        )

    def _link_to_interface(self, object_type: str, interface_name: str, space_id: str) -> str:
        return (
            f"MATCH (ot:OntMeta_ObjectType {{api_name: '{object_type}', space_id: '{space_id}'}}) "
            f"MERGE (i:OntMeta_Interface  {{api_name: '{interface_name}', space_id: '{space_id}'}}) "
            f"MERGE (ot)-[:IMPLEMENTS]->(i)"
        )

    def _upsert_shared_property(self, sp, space_id: str) -> str:
        return (
            f"MERGE (sp:OntMeta_SharedProperty {{api_name: '{sp.api_name}', space_id: '{space_id}'}}) "
            f"SET sp.base_type = '{sp.base_type}', sp.version = '{sp.version}', "
            f"    sp.updated_at = timestamp()"
        )

    def _upsert_link_type(self, lt, space_id: str) -> str:
        return (
            f"MERGE (lt:OntMeta_LinkType {{api_name: '{lt.api_name}', space_id: '{space_id}'}}) "
            f"SET lt.cardinality  = '{lt.cardinality}', "
            f"    lt.falkor_rel   = 'LINK_{lt.api_name.upper()}', "
            f"    lt.updated_at   = timestamp() "
            f"WITH lt "
            f"MATCH (src:OntMeta_ObjectType {{api_name: '{lt.source_object_type}', space_id: '{space_id}'}}) "
            f"MATCH (tgt:OntMeta_ObjectType {{api_name: '{lt.target_object_type}', space_id: '{space_id}'}}) "
            f"MERGE (src)-[:HAS_LINK_TYPE {{direction: 'outgoing'}}]->(lt) "
            f"MERGE (lt)-[:POINTS_TO]->(tgt)"
        )

    def _upsert_interface(self, iface, space_id: str) -> str:
        return (
            f"MERGE (i:OntMeta_Interface {{api_name: '{iface.api_name}', space_id: '{space_id}'}}) "
            f"SET i.display_name = '{iface.display_name}', "
            f"    i.version      = '{iface.version}', "
            f"    i.updated_at   = timestamp()"
        )
```

---

## Full Schema Service — Orchestrates Compilation

```python
# apps/api/services/schema_service.py (abbreviated)
import asyncio
from falkordb import FalkorDB
from elasticsearch import AsyncElasticsearch
from .git_service import GitService

class SchemaService:
    def __init__(self, falkordb: FalkorDB, es: AsyncElasticsearch, git: GitService):
        self.falkordb = falkordb
        self.es       = es
        self.git      = git

    async def compile_and_apply(self, space_id: str, branch: str = "main") -> dict:
        wt_path = str(await self.git.get_worktree_path(space_id, branch))

        # 1. Parse YAML
        parser  = YAMLParser(wt_path)
        parsed  = await asyncio.to_thread(parser.parse_all)

        # 2. Validate (raises ValueError on schema errors)
        await self._validate(parsed)

        # 3. Compile FalkorDB DDL
        falkor_compiler = FalkorDBCompiler()
        ddl_stmts = await asyncio.to_thread(falkor_compiler.compile, parsed)
        udf_src   = await asyncio.to_thread(
            falkor_compiler.compile_udf_registrations, parsed["object_types"]
        )

        # 4. Compile ES mappings (per object type)
        es_compiler = ESMappingCompiler()
        es_mappings = {}
        for name, ot in parsed["object_types"].items():
            es_mappings[name] = await asyncio.to_thread(
                es_compiler.compile, ot, parsed["shared_properties"]
            )

        # 5. Compile Cypher templates (per action type) and write to worktree
        cypher_compiler = CypherTemplateCompiler()
        for name, ot in parsed["object_types"].items():
            for action in ot.action_types:
                template = await asyncio.to_thread(cypher_compiler.compile, action, space_id)
                cypher_path = f"object-types/{name}/action-types/{action.api_name}.cypher"
                await asyncio.to_thread(
                    self.git.write_file, space_id, branch, cypher_path, template
                )

        # 6. Apply DDL to FalkorDB (schema-only, idempotent)
        meta_graph = self.falkordb.select_graph("eom_meta")
        for stmt in ddl_stmts:
            await asyncio.to_thread(meta_graph.query, stmt)

        # 7. Register UDFs
        if udf_src.strip():
            await asyncio.to_thread(self.falkordb.udf_load, "EomDerived", udf_src, True)

        # 8. Apply ES mappings
        for name, mapping in es_mappings.items():
            version = parsed["object_types"][name].version
            v_num   = int(version.split(".")[0])
            await self._apply_es_mapping(space_id, name, v_num, mapping)

        # 9. Update meta-graph
        meta_compiler = MetaGraphCompiler()
        meta_stmts    = await asyncio.to_thread(meta_compiler.compile, parsed, str(space_id))
        for stmt in meta_stmts:
            await asyncio.to_thread(meta_graph.query, stmt)

        return {
            "object_types": len(parsed["object_types"]),
            "link_types":   len(parsed["link_types"]),
            "ddl_count":    len(ddl_stmts),
        }
```
