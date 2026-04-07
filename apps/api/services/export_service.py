"""
ExportService — generate OWL and SKOS Turtle serialisations from meta-graph data.

We build Turtle strings directly from the FalkorDB meta-graph without
any additional RDF library dependency (rdflib is heavy; we keep it optional).
"""
from __future__ import annotations

from typing import Any

import structlog

from core.exceptions import NotFoundError
from db.falkordb import META_GRAPH, execute_cypher
from services.query_service import QueryService, _node_to_dict

log = structlog.get_logger()

# Turtle namespace prefixes
_OWL_PREFIXES = """\
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix eom: <http://eom.example.org/ontology/> .

"""

_SKOS_PREFIXES = """\
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix eom: <http://eom.example.org/ontology/> .

"""

_XSD_TYPE_MAP: dict[str, str] = {
    "string": "xsd:string",
    "integer": "xsd:integer",
    "float": "xsd:float",
    "boolean": "xsd:boolean",
    "date": "xsd:date",
    "datetime": "xsd:dateTime",
    "uri": "xsd:anyURI",
}


class ExportService:
    def __init__(self, query: QueryService) -> None:
        self._query = query

    async def export_owl(self, ontology_id: str) -> str:
        """
        Return OWL/Turtle representation of the ontology.

        Each ObjectType becomes an owl:Class.
        Each Property becomes an owl:DatatypeProperty.
        Each Relationship becomes an owl:ObjectProperty.
        """
        ontology = await self._query.get_ontology(ontology_id)
        if not ontology:
            raise NotFoundError("Ontology", ontology_id)

        ont_name = ontology.get("name", ontology_id)
        ont_iri = f"http://eom.example.org/ontology/{ontology_id}"

        lines: list[str] = [_OWL_PREFIXES]
        lines.append(f"<{ont_iri}> a owl:Ontology ;")
        lines.append(f'    rdfs:label "{_escape(ont_name)}" .')
        lines.append("")

        # ObjectTypes → owl:Class
        object_types = await self._query.list_object_types(ontology_id)
        for ot in object_types:
            api_name = ot.get("api_name", "")
            display_name = ot.get("display_name", api_name)
            description = ot.get("description", "")
            ot_id = ot.get("id", "")
            lines.append(f"eom:{api_name} a owl:Class ;")
            lines.append(f'    rdfs:label "{_escape(display_name)}" ;')
            if description:
                lines.append(f'    rdfs:comment "{_escape(description)}" ;')
            lines.append(f'    eom:ontologyId "{ontology_id}" ;')
            lines.append(f'    eom:objectTypeId "{ot_id}" .')
            lines.append("")

            # Properties → owl:DatatypeProperty
            properties = await self._query.list_properties(ot_id)
            for prop in properties:
                p_api_name = prop.get("api_name", "")
                p_display = prop.get("display_name", p_api_name)
                p_data_type = prop.get("data_type", "string")
                xsd_type = _XSD_TYPE_MAP.get(p_data_type, "xsd:string")
                skos_mapping = prop.get("skos_mapping", "")

                lines.append(f"eom:{api_name}_{p_api_name} a owl:DatatypeProperty ;")
                lines.append(f'    rdfs:label "{_escape(p_display)}" ;')
                lines.append(f"    rdfs:domain eom:{api_name} ;")
                lines.append(f"    rdfs:range {xsd_type} ;")
                if skos_mapping:
                    lines.append(f"    rdfs:isDefinedBy <{skos_mapping}> ;")
                lines.append(".")
                lines.append("")

        # Relationships → owl:ObjectProperty
        relationships = await self._query.list_relationships(ontology_id)
        for rel in relationships:
            api_name = rel.get("api_name", "")
            src_id = rel.get("source_object_type_id", "")
            tgt_id = rel.get("target_object_type_id", "")
            cardinality = rel.get("cardinality", "MANY_TO_MANY")

            src_ot = await self._query.get_object_type(src_id)
            tgt_ot = await self._query.get_object_type(tgt_id)
            src_name = src_ot.get("api_name", src_id) if src_ot else src_id
            tgt_name = tgt_ot.get("api_name", tgt_id) if tgt_ot else tgt_id

            lines.append(f"eom:{api_name} a owl:ObjectProperty ;")
            lines.append(f'    rdfs:label "{_escape(api_name)}" ;')
            lines.append(f"    rdfs:domain eom:{src_name} ;")
            lines.append(f"    rdfs:range eom:{tgt_name} ;")
            lines.append(f'    eom:cardinality "{cardinality}" .')
            lines.append("")

        return "\n".join(lines)

    async def export_skos(self, ontology_id: str) -> str:
        """
        Return SKOS/Turtle representation.

        Only ObjectTypes with is_skos_concept=True are exported as skos:Concept.
        ObjectTypes with is_skos_concept_scheme=True become skos:ConceptScheme.
        All others are skipped.
        """
        ontology = await self._query.get_ontology(ontology_id)
        if not ontology:
            raise NotFoundError("Ontology", ontology_id)

        ont_name = ontology.get("name", ontology_id)
        ont_iri = f"http://eom.example.org/ontology/{ontology_id}"

        lines: list[str] = [_SKOS_PREFIXES]

        # Build the ConceptScheme declaration from the ontology itself
        lines.append(f"<{ont_iri}> a skos:ConceptScheme ;")
        lines.append(f'    skos:prefLabel "{_escape(ont_name)}"@en .')
        lines.append("")

        object_types = await self._query.list_object_types(ontology_id)

        for ot in object_types:
            api_name = ot.get("api_name", "")
            display_name = ot.get("display_name", api_name)
            description = ot.get("description", "")
            ot_id = ot.get("id", "")
            is_concept = ot.get("is_skos_concept", False)
            is_scheme = ot.get("is_skos_concept_scheme", False)

            if not is_concept and not is_scheme:
                continue

            rdf_type = "skos:ConceptScheme" if is_scheme else "skos:Concept"
            lines.append(f"eom:{api_name} a {rdf_type} ;")
            lines.append(f'    skos:prefLabel "{_escape(display_name)}"@en ;')
            if description:
                lines.append(f'    skos:definition "{_escape(description)}"@en ;')
            if is_concept:
                lines.append(f"    skos:inScheme <{ont_iri}> ;")

            # SKOS mappings from properties
            properties = await self._query.list_properties(ot_id)
            for prop in properties:
                skos_mapping = prop.get("skos_mapping", "")
                if skos_mapping:
                    p_display = prop.get("display_name", prop.get("api_name", ""))
                    lines.append(f'    skos:exactMatch <{skos_mapping}> ; # {_escape(p_display)}')

            lines.append(".")
            lines.append("")

        return "\n".join(lines)


def _escape(s: str) -> str:
    """Escape a string for Turtle literal values."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
