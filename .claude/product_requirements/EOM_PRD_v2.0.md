# Enterprise Ontology Manager (EOM)
## Product Requirements Document — v2.0

---

| Attribute | Value |
|---|---|
| **Status** | Draft — Architecture Review |
| **Version** | 2.0 |
| **Stack** | FalkorDB · Elasticsearch 8.x · Git Worktrees · Open Policy Agent |
| **Classification** | Confidential — Internal |
| **Audience** | Platform Engineering · Data Architecture · AI/ML · Product |
| **Purpose** | Source of truth for Claude Code to build the end-to-end application |

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Design Principles](#2-design-principles)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Space & Organisation Model](#4-space--organisation-model)
5. [Type System](#5-type-system)
6. [FalkorDB Graph Layer](#6-falkordb-graph-layer)
7. [Elasticsearch Semantic Layer](#7-elasticsearch-semantic-layer)
8. [Git Worktree — Version Control](#8-git-worktree--version-control)
9. [Open Policy Agent — Policy Management](#9-open-policy-agent--policy-management)
10. [Versioning](#10-versioning)
11. [Volume & Health Metrics](#11-volume--health-metrics)
12. [API Surface](#12-api-surface)
13. [Application Modules & UI](#13-application-modules--ui)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [Project Structure for Claude Code](#15-project-structure-for-claude-code)
16. [Implementation Roadmap](#16-implementation-roadmap)
17. [Glossary](#17-glossary)

---

## 1. Purpose & Scope

### 1.1 What EOM Is

The Enterprise Ontology Manager (EOM) is a platform for designing, governing, publishing, and operationalising enterprise-wide ontologies. It provides a governed, machine-readable semantic backbone that multiple organisations and teams can share, evolve, and build applications on top of.

An **ontology** in EOM is a versioned, formally defined set of semantic types — object types, link types, properties, interfaces, and action types — that describe real-world entities and the relationships between them. EOM makes those definitions the single source of truth across all data systems, AI models, and applications in the enterprise.

### 1.2 What EOM Is Not

- EOM is **not** a data catalogue or a metadata management tool for physical datasets.
- EOM is **not** a BI tool, a pipeline orchestrator, or an ETL platform.
- EOM is **not** a business glossary, though glossary-style descriptions are a first-class property on all types.
- EOM does **not** prescribe which industry standards or domain ontologies a team should adopt. That is a project-level decision made by the ontology lead for each Space. EOM provides the infrastructure to register, version, and enforce whatever standards the team chooses.

### 1.3 Core Value Propositions

| For | EOM Delivers |
|---|---|
| Data Architects | A visual, code-native environment for designing shared semantic models with formal change governance |
| Data Stewards | A stewardship workflow with health scoring, quality alerts, and full audit history |
| Data Engineers | Auto-generated FalkorDB schemas, Elasticsearch mappings, and typed API SDKs on every publish |
| AI / ML Engineers | Consistent, embedding-ready object types with hybrid semantic search and graph traversal APIs |
| Platform Engineers | A policy-as-code governance layer (OPA) that enforces naming, change classification, and access control without per-service custom logic |
| Business Analysts | A searchable, explorable semantic graph with natural-language entry points |

---

## 2. Design Principles

These principles are not guidelines — they are encoded into the system via OPA policies, CI checks, and schema validation rules.

### 2.1 Domain-Driven Design — Semantic Intent

> **Model what actually exists, not how it is stored.**

Every Object Type, Link Type, and Property must represent a real-world concept that a domain expert can name and describe without engineering context. Storage implementation details — column names, table names, source system IDs, physical types — are strictly confined to the datasource mapping layer and must never appear in the semantic model.

**Enforcement:**
- OPA policy blocks any `apiName` matching database naming patterns (`tbl_`, `fact_`, `dim_`, `vw_`, `stg_`, `tmp_`).
- Every Object Type requires a `description` (human-language definition) before it can leave `DRAFT` status.
- Every Property requires a `displayName` and a `domain` classification before publication.

### 2.2 Don't Repeat Yourself — Refactor What Is Built

> **A concept must have one authoritative definition. Duplication is a defect.**

Shared Properties exist precisely to prevent the same semantic attribute from being defined differently in ten places. When a Shared Property covering a concept already exists, creating a local property with the same intent is blocked.

**Enforcement:**
- OPA naming policy blocks creation of a local property whose `apiName` matches any existing Shared Property in the same Space.
- The Elasticsearch duplication radar (cosine similarity scan) surfaces any new Object Type whose semantic text embedding is ≥ 0.85 similar to an existing type, blocking PR merge until the conflict is resolved or explicitly dismissed with justification.
- CI linter checks for structural similarity in property sets between Object Types and recommends Interface extraction.

### 2.3 Open for Extension, Closed for Modification

> **Once published, a contract cannot be narrowed. It can only be extended.**

When an Object Type is in `PUBLISHED` status, its existing mandatory properties, primary key, and link type cardinalities cannot be removed or narrowed without a formal breaking-change proposal with a migration plan and a consumer impact assessment. New optional properties, new link types, and new interface implementations can always be added freely.

**Enforcement:**
- OPA classifies every schema edit as `ADDITIVE`, `NON_BREAKING`, or `BREAKING` before a PR is allowed to merge.
- `BREAKING` changes require architecture review board approval, a computed impact report, and a deprecation sunset date.
- Renaming a property is always `BREAKING` — the approved path is: add new property → migrate data → mark old property `DEPRECATED` with a sunset date → auto-scaffold migration function.

### 2.4 Plug-and-Play Ontologies

> **Ontologies are composable, versioned units — not monoliths.**

An ontology can declare a dependency on a published package from another Space. It links to those types without copying definitions. All packages are semver-versioned so consumers can pin to a range and receive compatibility signals when the producer publishes a new version.

**Enforcement:**
- Cross-Space references are explicit federation links registered in the meta-graph.
- Package imports are pinned in `package-lock.yaml` with a version range; CI blocks implicit `latest` imports on production Spaces.
- The compatibility matrix (auto-computed on publish) reports which version ranges of all downstream consumers remain compatible.

---

## 3. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EOM Platform                                     │
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │  EOM Studio   │  │  EOM API      │  │  EOM CLI      │  │  SDK (auto) │ │
│  │  (React SPA)  │  │  (FastAPI)    │  │  (eom)        │  │  py / ts    │ │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘ │
│          └──────────────────┴──────────────────┴──────────────────┘        │
│                                    │                                        │
│              ┌────────────────────┬┴────────────────────┐                  │
│              │                    │                     │                  │
│    ┌─────────▼────────┐  ┌────────▼───────┐  ┌─────────▼────────┐         │
│    │  Schema Service  │  │  Query Service │  │  Action Service  │         │
│    │  (compile YAML   │  │  (graph + ES   │  │  (execute Cypher │         │
│    │   → Cypher DDL   │  │   hybrid)      │  │   transactions)  │         │
│    │   + ES mappings) │  └────────┬───────┘  └─────────┬────────┘         │
│    └─────────┬────────┘           │                    │                  │
│              │            ┌───────┴────┐    ┌──────────┴───────┐          │
│              │            │ FalkorDB   │    │  FalkorDB        │          │
│              │            │ (Read)     │    │  (Write — gated  │          │
│              │            └───────┬────┘    │   by OPA)        │          │
│              │                    │         └──────────────────┘          │
│    ┌─────────▼──────────┐  ┌──────▼─────────────────────────────┐        │
│    │  Git Worktree Svc  │  │  Elasticsearch                     │        │
│    │  (branch / PR /    │  │  (per-type indices, hybrid search, │        │
│    │   rebase / publish)│  │   meta-index, OAG corpus index)    │        │
│    └─────────┬──────────┘  └────────────────────────────────────┘        │
│              │                                                             │
│    ┌─────────▼──────────┐                                                 │
│    │  OPA Sidecar       │  ← evaluates every schema write, action         │
│    │  (Rego policies    │    invocation, and API access decision           │
│    │   from Git)        │                                                  │
│    └────────────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Component Summary

| Component | Technology | Role |
|---|---|---|
| **EOM Studio** | React 18, TypeScript, React Flow (authoring), AntV G6 (exploration), Monaco Editor | Visual ontology authoring, interactive graph exploration, stewardship UI |
| **EOM API** | Python 3.12, FastAPI, Pydantic v2 | REST API, GraphQL (Strawberry), internal service orchestration |
| **EOM CLI** | Python click, distributed as PyPI package `eom-cli` | Schema-as-code; `branch`, `diff`, `lint`, `test`, `publish`, `rebase` |
| **Schema Service** | Python, Jinja2 templating | Compiles YAML ontology manifests → FalkorDB Cypher DDL + ES index mappings |
| **Query Service** | Python, FalkorDB client, Elasticsearch client | Executes read queries across the graph + semantic search with hybrid ranking |
| **Action Service** | Python | Evaluates OPA policy, executes parameterised Cypher write transactions, emits side-effects |
| **Git Worktree Service** | Python, pygit2 | Manages per-branch worktrees, CI pipeline integration, semantic merge |
| **FalkorDB** | FalkorDB 4.x (Redis-based, GraphBLAS) | Persistent property graph for all ontology instances and the meta-graph |
| **Elasticsearch** | Elasticsearch 8.x | Per-type semantic indices, hybrid BM25+kNN search, meta-index, OAG corpus |
| **OPA** | Open Policy Agent 0.7x, Rego | Policy decision point for all schema writes, action invocations, and API access |
| **SDK (auto-generated)** | Python, TypeScript | Fully typed clients regenerated and published on every ontology publish |

---

## 4. Space & Organisation Model

### 4.1 Space

A **Space** is the top-level organisational container. It represents a coherent programme or business domain shared between a defined set of organisations. Every Space has:

- Exactly **one Ontology** (1:1 mapping, co-created on Space creation)
- Exactly **one Git repository** (created automatically)
- A **visibility** that controls how its ontology is accessed
- A **member organisation set** that governs who can read and write

```yaml
# Space schema
space:
  id: uuid                         # immutable, system-generated
  name: string                     # e.g. "Global Payments"
  description: string
  visibility: PRIVATE | PUBLIC | SHARED
  owning_org_id: uuid
  member_org_ids: uuid[]
  ontology_id: uuid                # auto-created, same id as space
  git_repo_path: string            # server-side path to bare Git repo
  opa_policy_ref: string           # path to OPA bundle within repo
  tier: CORE | DOMAIN | EXPERIMENTAL
  created_at: datetime
```

**Tier** governs how fast changes can flow:
- `CORE` — changes require Architecture Review Board sign-off; used for enterprise reference ontologies
- `DOMAIN` — standard approval workflow; used for business domain ontologies
- `EXPERIMENTAL` — lightweight approval; used for new capability exploration

### 4.2 Ontology Visibility

#### PRIVATE

- Readable and writable only by `owning_org_id` members with explicit grants
- Object Types cannot be referenced as link targets from other Spaces
- Packages cannot be published to the enterprise Marketplace
- OPA policy enforces zero cross-org access

#### PUBLIC

- Readable by all authenticated users across all Spaces
- Writable only by `owning_org_id` and `member_org_ids` with the `EDITOR` role
- Object Types may be referenced as link targets from any other Space
- Packages can be published to the Marketplace without restriction
- Typical use: enterprise reference ontologies (e.g. party, location, currency models)

#### SHARED

- Readable and writable by all `member_org_ids` with role-based isolation
- Cross-Space link types allowed between SHARED Spaces that share at least one `member_org_id`
- Package publication requires approval from all member org stewards
- OPA policy enforces per-org write isolation within the shared space
- Typical use: multi-jurisdiction programmes or joint ventures

### 4.3 Organisation

An Organisation is a tenant-level grouping (e.g., a business line, a subsidiary, or a regulatory entity). Users belong to organisations. Organisations are members of Spaces. An organisation can be a member of multiple Spaces with different roles in each.

```yaml
organisation:
  id: uuid
  name: string
  description: string
  admin_user_ids: uuid[]
  created_at: datetime
```

### 4.4 Roles

| Role | Scope | Capabilities |
|---|---|---|
| `VIEWER` | Space | Read ontology definitions and object instances |
| `EDITOR` | Space | Author schema changes on feature branches |
| `STEWARD` | Object Type | Approve `NON_BREAKING` changes; manage quality thresholds |
| `PUBLISHER` | Space | Approve `BREAKING` changes; trigger production publishes |
| `ADMIN` | Space | Manage membership, roles, OPA policy bundles |
| `ORG_ADMIN` | Organisation | Manage org membership; create/join Spaces |

---

## 5. Type System

EOM's type system draws on established semantic web standards as its formal foundation while providing operational constructs (datasource mappings, action types, Cypher transaction compilation) on top. The project lead for each Space decides which external standard vocabularies (RDF, OWL, SKOS, SHACL, domain-specific ontologies, ISO standards, or proprietary vocabularies) are used as type references and semantic annotations — EOM provides the infrastructure to register and enforce them, not the specific choices.

### 5.1 Type References

Type references are external standard identifiers that a type or property can be mapped to. They provide interoperability with external systems and formal semantic grounding. EOM supports registration of any IRI-addressable type reference — the platform does not prescribe which standards must be used.

```yaml
# Type reference registration (project-defined, not platform-defined)
type_reference:
  id: string                    # e.g. "owl:Class", "xsd:string", "skos:Concept"
  namespace_prefix: string      # e.g. "owl", "xsd", "skos"
  namespace_uri: string         # e.g. "http://www.w3.org/2001/XMLSchema#"
  label: string
  description: string
  category: CLASS | DATATYPE | PROPERTY | CONCEPT | CUSTOM
```

When a team configures their Space, they register the namespaces relevant to their domain. The EOM schema engine then uses those registrations for:
- Export/serialisation in standard formats (Turtle, JSON-LD, OWL/XML)
- Semantic alignment checks (e.g., `owl:equivalentClass` assertions)
- Import of external type definitions as starting points for new Object Types

The primitive scalar base types used internally by EOM for property storage are:

| EOM Base Type | Storage | Elasticsearch Mapping |
|---|---|---|
| `String` | String (FalkorDB) | `text` + `keyword` sub-field |
| `Integer` | Integer (FalkorDB) | `integer` |
| `Long` | Integer (FalkorDB) | `long` |
| `Double` | Float (FalkorDB) | `double` |
| `Boolean` | Boolean (FalkorDB) | `boolean` |
| `Timestamp` | String ISO 8601 (FalkorDB) | `date` |
| `Date` | String YYYY-MM-DD (FalkorDB) | `date` |
| `GeoPoint` | Array `[lon, lat]` (FalkorDB) | `geo_point` |
| `GeoShape` | JSON string (FalkorDB) | `geo_shape` |
| `Struct` | JSON string (FalkorDB) | `object` (dynamic: false) |
| `TimeseriesRef` | String URI (FalkorDB) | `keyword` |
| `MediaRef` | String URI (FalkorDB) | `keyword` |
| `AttachmentRef` | String URI (FalkorDB) | `keyword` |

### 5.2 Object Types

An Object Type is the fundamental modelling unit representing a class of real-world business entities. Every published Object Type has:
- A FalkorDB **node label** (for instance storage)
- An Elasticsearch **index** (for search and query)
- An auto-generated **API route** (for CRUD access)
- An auto-generated **SDK class** (typed Python and TypeScript client)

#### 5.2.1 Object Type Schema

```yaml
object_type:
  # Identity (immutable after PUBLISHED)
  api_name: string              # snake_case, unique within Space
  display_name: string          # human-readable, locale-aware
  plural_display_name: string
  description: string           # required before PUBLISHED status

  # Classification
  domain: string                # project-defined domain (e.g. "Trade", "Party")
  status: DRAFT | PUBLISHED | DEPRECATED | RETIRED
  visibility: inherited_from_space
  tags: string[]                # free-form, used for superset grouping

  # Semantic grounding (optional — project-defined)
  semantic_iri: uri             # IRI for this class in the team's formal ontology
  external_type_refs: uri[]     # equivalentClass mappings to external standards

  # Schema
  primary_key: property_api_name
  interfaces: interface_api_name[]
  properties: property[]
  link_types: link_type_ref[]
  action_types: action_type_ref[]

  # Datasource (optional)
  datasource: datasource_mapping | null

  # Governance
  steward_id: user_id
  sensitivity_level: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  version: semver

  # Derived (auto-computed)
  falkor_label: string          # e.g. "ObjType_trade_confirmation"
  es_index_name: string         # e.g. "eom_{space_id}_trade_confirmation_v{N}"
  es_alias_name: string         # e.g. "eom_{space_id}_trade_confirmation"
```

#### 5.2.2 Object Types With and Without a Datasource

EOM supports both datasource-backed and action-created object types as fully equivalent first-class types.

| Aspect | Datasource-Backed | Action-Created (Datasource-Free) |
|---|---|---|
| Instance origin | Funnel pipeline ingests from registered dataset | Exclusively created via Action Types |
| Primary key | Derived from source dataset column mapping | System-generated UUID or user-supplied in Action parameters |
| Freshness | Configurable batch (≤15 min) or streaming (≤30 s lag) | Immediate — written directly on action commit |
| Schema evolution | Source schema change triggers mapping validation | Purely ontological — no upstream impact |
| Audit trail | Record-level lineage to source row | Action log: user, timestamp, parameters, before/after diff |
| Typical examples | Party (from CRM), Account (from core banking), Product (from PIM) | Annotation, Decision, ManualAdjustment, ReviewRecord |

#### 5.2.3 Superset Object Types and Tags

A **Superset** is a named, tag-based virtual grouping — not a physical schema entity. It implements the semantic concept of a union class without requiring explicit subclass relationships.

- Any Object Type can carry any number of free-form tags
- A Superset is defined as a named query over a tag expression (e.g., `tag IN ["LifecycleTracked", "Auditable"]`)
- Supersets appear as visual clusters in the Graph Canvas
- Action Types and Elasticsearch queries can target a Superset, dispatching polymorphically to the appropriate concrete type at runtime
- A Superset has no FalkorDB label or Elasticsearch index of its own

### 5.3 Properties

#### 5.3.1 Local Properties

Local properties belong to exactly one Object Type. They are stored as node attributes in FalkorDB and as fields in the corresponding Elasticsearch index.

Property constraints are expressed as **Value Types** (see §5.8). A property references a Value Type to get its constraint set (regex pattern, enum, range, cross-reference, etc.).

```yaml
property:
  api_name: string              # camelCase within Object Type, unique
  display_name: string
  description: string
  base_type: String | Integer | Long | Double | Boolean | Timestamp
             | Date | GeoPoint | GeoShape | Struct | TimeseriesRef
             | MediaRef | AttachmentRef
  value_type_ref: value_type_api_name | null
  is_required: boolean          # false = optional property
  is_shared: false              # local property
  is_edit_only: boolean         # exists only in write path, not queryable
  is_mandatory_control: boolean # must have value before any action can be submitted
  semantic_ref: uri | null      # optional external type reference (project-defined)
  sensitivity_override: level | null  # overrides object type sensitivity for this field
  derived_function_ref: function_api_name | null  # computed at query time
```

#### 5.3.2 Derived Properties

A derived property is computed at query time by a registered JavaScript UDF (FalkorDB) or a Python function. It is never stored as a physical node attribute.

> **Important FalkorDB constraint:** FalkorDB UDFs are written in JavaScript and are **read-only** — they can compute values from graph data but cannot modify nodes, edges, or properties. Derived properties are therefore purely computational overlays evaluated at query time via `GRAPH.QUERY` with the UDF registered via `GRAPH.UDF LOAD`.

```javascript
// Example UDF for a derived property: compute full_name from first_name + last_name
// Registered as: GRAPH.UDF LOAD PersonUtils <script>
function fullName(firstName, lastName) {
  if (!firstName && !lastName) return null;
  return [firstName, lastName].filter(Boolean).join(' ');
}
falkor.register('fullName', fullName);
```

```cypher
// Used in a query:
MATCH (p:ObjType_person)
RETURN p.id, PersonUtils.fullName(p.first_name, p.last_name) AS full_name
```

### 5.4 Shared Properties

A Shared Property is a cross-cutting semantic attribute defined once in the Shared Property Registry and reused by any number of Object Types. They are the primary DRY enforcement mechanism.

```yaml
shared_property:
  api_name: string              # globally unique within Space
  display_name: string
  description: string
  base_type: <EOM base type>
  value_type_ref: value_type_api_name | null
  semantic_ref: uri | null      # optional external vocabulary mapping (project-defined)
  sensitivity_level: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  steward_id: user_id
  version: semver
  used_by: object_type_api_name[]   # auto-populated by CI
```

**Shared Property rules:**
- Stored in `shared-properties/` directory of the Space's Git repo
- Versioned independently with their own semver lifecycle
- A v2.0 of a Shared Property is a `BREAKING` change and triggers compatibility checks on all Object Types that reference it
- In FalkorDB: stored identically to a local property (as a node attribute) — the "shared" distinction is schema-layer only
- In Elasticsearch: implemented via index templates so the mapping is consistent across all indices that include the shared property

### 5.5 Link Types

A Link Type is a typed, directed predicate between two Object Types. Stored as a directed labelled edge in FalkorDB and as a nested/join field in Elasticsearch.

```yaml
link_type:
  api_name: string              # verb-phrase, e.g. "placed_by", "held_in"
  display_name: string
  description: string
  source_object_type: object_type_api_name
  target_object_type: object_type_api_name
  cardinality: ONE_TO_ONE | ONE_TO_MANY | MANY_TO_ONE | MANY_TO_MANY
  inverse_api_name: string | null   # e.g. "has_order" for inverse of "placed_by"
  link_properties: property[]       # attributes on the relationship itself
  is_temporally_bounded: boolean    # if true, link carries valid_from / valid_to
  cascade_rule: RESTRICT | CASCADE | SET_NULL | ARCHIVE
  semantic_ref: uri | null          # optional external predicate reference
  falkor_rel_type: string           # UPPER_SNAKE_CASE, e.g. "PLACED_BY"
```

**Temporally bounded links** carry `valid_from` (required) and `valid_to` (null = currently active) attributes on the FalkorDB edge. This enables historical relationship modelling and point-in-time queries.

```cypher
-- Temporally bounded link creation (executed by Action Service, not a UDF)
MATCH (o:ObjType_order {id: $orderId})
MATCH (c:ObjType_customer {id: $customerId})
CREATE (o)-[:PLACED_BY {
  valid_from: $timestamp,
  valid_to: null,
  _created_by: $actorId,
  _created_at: timestamp(),
  _link_type: 'placed_by'
}]->(c)
```

### 5.6 Interfaces

An Interface is an abstract structural contract — it defines a named set of required and optional properties (including shared property references) and link types that implementing Object Types must honour.

Interfaces have no FalkorDB node label or Elasticsearch index of their own. They are schema-layer contracts enforced at publish time by the CI linter and by OPA.

```yaml
interface:
  api_name: string
  display_name: string
  description: string
  extends_interfaces: interface_api_name[]   # multiple inheritance supported
  required_properties:
    - property_api_name | shared_property_ref
  optional_properties:
    - property_api_name | shared_property_ref
  required_link_types: link_type_api_name[]
  semantic_ref: uri | null   # optional mapping to external abstract class
  version: semver
```

**Object Types declare interface implementations.** All properties and link types from all implemented interfaces are automatically merged into the Object Type's FalkorDB schema and Elasticsearch mapping by the Schema Service at compile time.

**Actions on Interfaces:** An Action Type can target an interface rather than a concrete Object Type. The Action Service dispatches at runtime to the compiled Cypher transaction for the correct concrete type.

### 5.7 Action Types

An Action Type is the schema definition of an atomic, user-initiated change-set. It specifies what inputs are required, what validation must pass before execution, and what changes are made — across object properties, link instances, and new object creation — within a single atomic FalkorDB transaction.

> **Critical implementation note:** FalkorDB UDFs are **read-only** and cannot modify graph data. Action Type execution is therefore implemented as **parameterised Cypher write transactions** composed by the Action Service and executed directly against FalkorDB as GRAPH.QUERY calls. The Schema Service pre-compiles each Action Type's Cypher template at publish time; the Action Service substitutes parameters and calls OPA before dispatching.

#### 5.7.1 Action Type Schema

```yaml
action_type:
  api_name: string
  display_name: string
  description: string
  target_object_type: object_type_api_name  # or interface_api_name
  parameters:
    - name: string
      type: <base type or value type ref>
      required: boolean
      default_value: any | null
      object_ref: object_type_api_name | null  # if this param is an object ID
  submission_criteria:
    - property: property_api_name
      operator: EQUALS | NOT_EQUALS | IN | NOT_IN | IS_NULL | IS_NOT_NULL | GT | LT
      value: any
  validation_rules:
    - description: string
      cypher_check: string   # read-only Cypher that returns {valid: bool, message: str}
  edits:
    - type: SET_PROPERTY | CREATE_LINK | DELETE_LINK | CREATE_OBJECT | DELETE_OBJECT
      property: property_api_name | null
      link_type: link_type_api_name | null
      value: any | null
      value_from_param: parameter_name | null
      target_id_from_param: parameter_name | null
  side_effects:
    - type: NOTIFICATION | WEBHOOK | DOWNSTREAM_ACTION
      config: {}
  permissions:
    required_roles: role[]
    opa_policy_ref: string | null   # additional custom policy
  undoable: boolean
  compiled_cypher_template: string  # auto-generated by Schema Service, stored in Git
```

#### 5.7.2 Cypher Template Compilation

The Schema Service compiles each Action Type into a Cypher template at publish time. The template is stored in Git and validated by the CI pipeline.

```cypher
-- Example compiled Cypher template for action: submit_order
-- Parameters: $order_id, $customer_id, $submitted_at, $actor_id

-- Step 1: Submission criteria check (read-only, fails fast)
MATCH (o:ObjType_order {id: $order_id})
WHERE o.status = 'DRAFT'  -- submission_criteria: status EQUALS DRAFT
WITH o
  WHERE o IS NOT NULL  -- fails if criteria not met

-- Step 2: Apply edits atomically
MATCH (o:ObjType_order {id: $order_id})
MATCH (c:ObjType_customer {id: $customer_id})
SET o.status         = 'SUBMITTED',
    o.submitted_at   = $submitted_at,
    o._last_action   = 'submit_order',
    o._last_actor    = $actor_id,
    o._last_action_at = timestamp()
CREATE (o)-[:PLACED_BY {
  valid_from: $submitted_at,
  valid_to: null,
  _created_by: $actor_id,
  _created_at: timestamp(),
  _link_type: 'placed_by'
}]->(c)
RETURN o.id AS object_id, 'SUCCESS' AS status
```

#### 5.7.3 Execution Flow

```
Request → Action Service
  │
  ├─ 1. OPA evaluation (data.eom.action.invoke)
  │       → DENY: return 403 with deny_reason
  │
  ├─ 2. Run validation_rules (read-only Cypher checks)
  │       → FAIL: return 422 with validation messages
  │
  ├─ 3. Execute compiled Cypher template (write transaction)
  │       → FalkorDB GRAPH.QUERY (atomic)
  │
  ├─ 4. Write audit log entry to Elasticsearch (eom_audit_log index)
  │
  ├─ 5. Update Elasticsearch object document (async, <1 s)
  │
  └─ 6. Emit side-effects (webhook, notification, downstream action)
```

### 5.8 Value Types

A Value Type is a strongly-typed, constraint-bearing wrapper over a base type. It ensures a semantic class of values (e.g., a currency amount, an email address, an identifier conforming to a specific format) is always stored correctly.

```yaml
value_type:
  api_name: string
  display_name: string
  description: string
  base_type: <EOM base type>
  constraints:
    pattern: regex | null           # for String types
    min_value: number | null        # for numeric types
    max_value: number | null
    max_length: integer | null
    allowed_values: any[] | null    # enum list
    cross_ref_object_type: api_name | null  # value must exist as an object ID
  version: semver
```

---

## 6. FalkorDB Graph Layer

### 6.1 Why FalkorDB

FalkorDB uses GraphBLAS sparse matrix operations under the hood, giving it ultra-low-latency multi-hop traversals at scale. It supports the OpenCypher query language with proprietary extensions, JavaScript UDFs for computed read operations, and runs as a Redis module (single binary, Redis protocol). This makes it operationally straightforward while delivering graph-native performance.

### 6.2 Graph Organisation

EOM uses **two separate FalkorDB graphs** in the same cluster:

| Graph Name | Purpose |
|---|---|
| `eom_{space_id}_data` | Stores all object instances and link instances for the Space |
| `eom_meta` | Stores the ontology schema as a graph (powers impact analysis and AI Copilot) |

### 6.3 Node Label Convention

```
# Object Type instances:
:ObjType_{snake_case_api_name}

# Examples:
:ObjType_order
:ObjType_customer
:ObjType_product

# Meta-graph node labels:
:OntMeta_ObjectType
:OntMeta_LinkType
:OntMeta_Property
:OntMeta_SharedProperty
:OntMeta_Interface
:OntMeta_ActionType
:OntMeta_Space
:OntMeta_Organisation
:OntMeta_OntologyVersion
:OntMeta_Package
```

### 6.4 Relationship Type Convention

```
# Link Type instances (from Object Type A to Object Type B):
:LINK_{UPPER_SNAKE_CASE_api_name}

# Examples:
:LINK_PLACED_BY
:LINK_HELD_IN_ACCOUNT
:LINK_ASSIGNED_TO

# All link instances carry system attributes:
_link_type    : String   # api_name of the link type
_created_by   : String   # actor user ID
_created_at   : Integer  # epoch ms
_action_ref   : String?  # api_name of Action Type that created this link
valid_from    : String?  # ISO 8601, if is_temporally_bounded = true
valid_to      : String?  # null means currently active
```

### 6.5 System Attributes on Every Node

Every Object Type node carries a set of system-managed attributes in addition to its user-defined properties:

```
_eom_id           : String   # primary key (UUID or user-supplied)
_eom_type         : String   # object type api_name
_eom_space_id     : String   # space ID
_eom_version      : String   # schema version when this instance was created/last migrated
_eom_sensitivity  : String   # inherited from object type sensitivity level
_eom_created_at   : Integer  # epoch ms
_eom_updated_at   : Integer  # epoch ms
_last_action      : String?  # api_name of last Action Type applied
_last_actor       : String?  # user ID of last action executor
_last_action_at   : Integer? # epoch ms of last action
```

### 6.6 Index Strategy

| Index Type | Applied To | Purpose | DDL |
|---|---|---|---|
| Node exact | `_eom_id` on every Object Type | O(1) primary key lookup | `CREATE INDEX FOR (n:ObjType_{type}) ON (n._eom_id)` |
| Node exact | `status` (where applicable) | Fast lifecycle status filter | `CREATE INDEX FOR (n:ObjType_{type}) ON (n.status)` |
| Node exact | Any property declared `is_indexed: true` | Domain-specific fast filters | Per manifest |
| Node full-text | `displayName`, `description` on meta-graph nodes | Ontology schema search | `CREATE FULLTEXT INDEX` |
| Node vector | `_embedding` (float array, dim configurable) | Semantic similarity | `CREATE VECTOR INDEX` |
| Relationship exact | `valid_from`, `valid_to` on temporally bounded links | Point-in-time traversal | `CREATE INDEX FOR ()-[r:LINK_{type}]->() ON (r.valid_from)` |

### 6.7 JavaScript UDFs (Read-Only Computed Functions)

FalkorDB UDFs are JavaScript functions registered at startup and callable within Cypher read queries. They are **strictly read-only** — they cannot modify the graph.

EOM uses UDFs for:
- Derived property computation (string concatenation, numeric aggregation, conditional logic)
- Custom graph traversal algorithms (path scoring, reachability with conditions)
- Similarity functions (e.g., Jaccard similarity between two node property sets)

```javascript
// Example: derived full display label for an entity
// Registered in library "EomCore" at Schema Service startup

function displayLabel(type, name, code) {
  if (!name) return code || 'Unknown';
  return code ? `${name} (${code})` : name;
}
falkor.register('displayLabel', displayLabel);

function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.length === 0 || setB.length === 0) return 0.0;
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}
falkor.register('jaccardSimilarity', jaccardSimilarity);
```

### 6.8 Meta-Graph Queries

The meta-graph (`eom_meta`) stores the ontology schema as a property graph. This enables rich Cypher-based queries for impact analysis, dependency traversal, and copilot context.

```cypher
-- Find all Object Types that implement a given interface
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType)-[:IMPLEMENTS]->(i:OntMeta_Interface {api_name: $interface})
 RETURN ot.api_name, ot.display_name, ot.status'

-- Blast radius: find all consumers of a property across Action Types and Functions
GRAPH.QUERY eom_meta
'MATCH (at:OntMeta_ActionType)-[:EDITS]->(p:OntMeta_Property {api_name: $prop})
       <-[:HAS_PROPERTY]-(ot:OntMeta_ObjectType {api_name: $object_type})
 RETURN at.api_name, at.display_name, at.compiled_cypher_ref'

-- Full transitive dependency chain from a Shared Property
GRAPH.QUERY eom_meta
'MATCH path = (sp:OntMeta_SharedProperty {api_name: $shared_prop})
       <-[:USES_SHARED_PROPERTY*1..10]-(dep)
 RETURN path'

-- Objects with no datasource and no action type (orphaned definitions)
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType)
 WHERE NOT (ot)-[:HAS_DATASOURCE]->()
   AND NOT (ot)-[:HAS_ACTION_TYPE]->()
   AND ot.status = "PUBLISHED"
 RETURN ot.api_name'
```

### 6.9 Volume Metrics

Volume metrics are computed from `GRAPH.INFO` and `GRAPH.QUERY` aggregations, stored in Elasticsearch (`eom_metrics` index), and surfaced in the EOM dashboard.

| Metric | Source | Frequency |
|---|---|---|
| Object instance count per type | `MATCH (n:ObjType_{t}) RETURN count(n)` | Hourly |
| Object count Δ (rate of change) | Delta between hourly counts | Hourly |
| Property fill rate (% non-null per property) | Aggregation scan | Daily |
| Link instance count per link type | `MATCH ()-[r:LINK_{t}]->() RETURN count(r)` | Hourly |
| FalkorDB memory footprint (MB) | `GRAPH.INFO {graph_name}` | Hourly |
| UDF execution count | Instrumentation in Query Service | Per-call |
| Action execution count and error rate | Audit log aggregation | Hourly |

---

## 7. Elasticsearch Semantic Layer

### 7.1 Why Elasticsearch Alongside FalkorDB

FalkorDB excels at graph traversal and exact / filter queries. It has no native full-text or vector search beyond the node vector index. Elasticsearch provides:
- Full-text BM25 search across all property values
- Dense vector (kNN) search for semantic similarity
- Hybrid BM25 + kNN with Reciprocal Rank Fusion (RRF) for graph-topology-aware semantic retrieval
- Aggregations and analytics across object populations without Cypher scans
- A complete audit log and metrics store

### 7.2 Index Architecture

#### Per-Object-Type Index

```
Index name:   eom_{spaceId}_{objectTypeApiName}_v{schemaVersion}
              e.g. eom_a1b2c3_order_v3

Read alias:   eom_{spaceId}_{objectTypeApiName}
              e.g. eom_a1b2c3_order

Write alias:  eom_{spaceId}_{objectTypeApiName}_write
              e.g. eom_a1b2c3_order_write
```

Zero-downtime schema migration protocol:
1. Create new versioned index (v{N+1}) with updated mapping
2. Reindex from the read alias (v{N}) to v{N+1}
3. Atomically swap read alias from v{N} → v{N+1}
4. Shift write alias to v{N+1}
5. Delete v{N} after a configurable grace period (default 7 days)

#### System Indices

| Index | Purpose |
|---|---|
| `eom_meta_object_types` | Semantic descriptions of all Object Types (for duplication radar and copilot) |
| `eom_audit_log` | Immutable action log: user, timestamp, action type, object ID, before/after diff |
| `eom_metrics` | Volume and health metrics time series |
| `eom_{spaceId}_{objectTypeApiName}_oag` | Ontology Augmented Generation — chunked document corpus per type |

### 7.3 Index Mapping Generation

The Schema Service auto-generates the Elasticsearch mapping from the Object Type YAML manifest. Shared Properties are applied via Elasticsearch index templates to guarantee consistent field types across all indices that include them.

```json
{
  "mappings": {
    "dynamic": false,
    "_source": { "enabled": true },
    "properties": {

      "_eom_id":           { "type": "keyword" },
      "_eom_type":         { "type": "keyword" },
      "_eom_space_id":     { "type": "keyword" },
      "_eom_version":      { "type": "keyword" },
      "_eom_created_at":   { "type": "date" },
      "_eom_updated_at":   { "type": "date" },
      "_eom_sensitivity":  { "type": "keyword" },
      "_eom_tags":         { "type": "keyword" },

      "_semantic_text": {
        "type": "text",
        "analyzer": "eom_semantic_analyzer",
        "comment": "Concatenation of all text properties — drives BM25 leg of hybrid search"
      },
      "_embedding": {
        "type": "dense_vector",
        "dims": 1536,
        "index": true,
        "similarity": "cosine",
        "comment": "Generated by the embedding model registered for this Space"
      },
      "_linked_ids": {
        "type": "keyword",
        "comment": "IDs of all directly linked objects — used for graph topology boost"
      },
      "_link_types_present": {
        "type": "keyword",
        "comment": "api_names of link types instantiated on this object"
      },

      "status":          { "type": "keyword" },
      "submitted_at":    { "type": "date" },
      "amount":          { "type": "double" },

      "customer": {
        "type": "nested",
        "comment": "Denormalised link summary — avoids join queries for common patterns",
        "properties": {
          "id":           { "type": "keyword" },
          "display_name": { "type": "keyword" }
        }
      }
    }
  }
}
```

### 7.4 Hybrid Search — BM25 + kNN + RRF

EOM uses Elasticsearch's native Reciprocal Rank Fusion (RRF) to combine BM25 lexical results and kNN vector results into a single ranked list. RRF is rank-based (not score-based), which eliminates the need for score normalisation and is robust across diverse query types.

```json
POST /eom_a1b2c3_order/_search
{
  "size": 20,
  "rank": {
    "rrf": {
      "window_size": 100,
      "rank_constant": 60
    }
  },
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "{user_query}",
            "fields": ["_semantic_text^2", "status", "_eom_tags"],
            "type": "best_fields"
          }
        }
      ],
      "filter": [
        { "term": { "_eom_space_id": "{space_id}" } },
        { "term": { "_eom_sensitivity": "{max_allowed_sensitivity}" } }
      ]
    }
  },
  "knn": {
    "field": "_embedding",
    "query_vector": "{query_embedding_vector}",
    "k": 50,
    "num_candidates": 200,
    "filter": [
      { "term": { "_eom_space_id": "{space_id}" } }
    ]
  }
}
```

### 7.5 Graph-Topology-Aware Ranking

After RRF fusion, EOM applies a graph-topology boost as a second-pass re-ranking step:

1. Extract the IDs of the top-10 results from the RRF-fused list
2. Query FalkorDB: for each candidate in the full result set, count how many of the top-10 IDs it is directly linked to
3. Apply a boost multiplier: `final_score = rrf_score × (1 + 0.2 × linked_top_hits_count)`
4. Re-sort and return

This rewards objects that are well-connected to already-high-ranking objects in the current result set — analogous to a personalised PageRank step applied per query.

### 7.6 Semantic Mapping — Duplication Radar

The Duplication Radar runs as a nightly Elasticsearch pipeline against the `eom_meta_object_types` index. It computes pairwise cosine similarity between Object Type semantic text embeddings within the same Space and across federated PUBLIC Spaces.

Any pair with similarity ≥ 0.85 is surfaced as a `DUPLICATION_WARNING` event — visible to the Space steward and automatically raised as a blocking comment on any open PR that introduces one of the conflicting types.

### 7.7 Ontology Augmented Generation (OAG)

Every Object Type can optionally have an associated OAG corpus index (`eom_{spaceId}_{type}_oag`). Documents (policies, data dictionaries, specifications, standards documents — chosen by the project team) are chunked, embedded, and indexed here.

The OAG API accepts an object set (list of object IDs) + a natural-language question and returns the top-K document chunks most relevant to the question in the context of those specific objects. This powers RAG pipelines built on top of EOM without requiring a separate vector store.

---

## 8. Git Worktree — Version Control

### 8.1 Why Git Worktrees

Git Worktrees allow multiple working trees to be attached to a single Git repository simultaneously. For ontology development, this means:

- The production ontology (`main` branch) is always independently accessible and deployable
- Each feature branch lives in its own directory, with its own sandbox FalkorDB graph and Elasticsearch indices
- Architects can work on multiple ontology changes in parallel from the same repository clone
- The server-side Git service manages all worktrees as server-side filesystem resources — no client-side checkout is required

### 8.2 Repository Structure

One Git repository is created per Space at Space creation time. The repository is a bare repo on the server; the Schema Service and Git Worktree Service manage working trees as needed.

```
eom-repo-{spaceId}/         ← bare Git repository
└── (working tree via git worktree add)

# Each worktree has this layout:
.eom/
├── config.yaml             # Space metadata, visibility, member orgs, tier
├── opa-policies/           # OPA Rego policy files (versioned with ontology)
│   ├── schema.rego         # Change classification
│   ├── access.rego         # Read/write access control
│   ├── naming.rego         # Naming conventions
│   └── action_invoke.rego  # Runtime action invocation
└── hooks/                  # Git hook scripts (pre-commit, pre-push)

shared-properties/
├── {api_name}.yaml         # One file per shared property
└── ...

value-types/
├── {api_name}.yaml
└── ...

interfaces/
├── {api_name}.yaml
└── ...

object-types/
├── {api_name}/
│   ├── schema.yaml         # Object Type definition
│   ├── datasource.yaml     # Optional datasource mapping
│   ├── action-types/
│   │   ├── {action}.yaml   # Action Type definition
│   │   └── {action}.cypher # Compiled Cypher template (auto-generated by Schema Service)
│   └── tests/
│       ├── schema_test.yaml
│       └── action_test.py
└── ...

link-types/
├── {api_name}.yaml
└── ...

packages/                   # Imported external ontology packages (locked versions)
├── {package_name}@{version}/
└── ...

VERSION                     # Current semver of this ontology (e.g. "2.4.1")
CHANGELOG.md                # Auto-generated by CI on merge to main
package-lock.yaml           # Pinned package dependency versions
```

### 8.3 The Three Branch Operations

#### 8.3.1 Feature Branch

A feature branch is the only path to making ontology changes. Direct commits to `main` are blocked by a `pre-push` hook and OPA policy.

**Creating a branch:**

```bash
# Via CLI
eom branch create feat/add-product-category-hierarchy

# What the Git Worktree Service does:
# 1. git worktree add /srv/eom-wt-{uuid} feat/add-product-category-hierarchy
# 2. Fork sandbox FalkorDB graph: GRAPH.COPY eom_{spaceId}_data eom_{spaceId}_{branchId}_data
# 3. Create sandbox ES indices with branch-specific aliases
# 4. Register branch in EOM database (status: ACTIVE, creator: current user)
```

**Authoring changes:**

```bash
# Edit YAML files in the worktree
# Pre-commit hook runs automatically:
# - OPA naming policy check
# - EOM schema linter (circular ref detection, orphan link detection, required fields)
# - Rejects non-compliant commits with structured error output
eom lint --branch feat/add-product-category-hierarchy  # also runnable manually
```

**Previewing changes:**

```bash
eom diff main..feat/add-product-category-hierarchy
# Output: semantic diff report
#   ADDITIVE:
#     + object-types/product_category (new)
#     + link-types/belongs_to_category (new)
#   NON_BREAKING:
#     ~ object-types/product: added optional property category_id
#   BREAKING:
#     none
#
#   Impact: 0 consumers affected
#   OHS delta: +0.3 (completeness improved)
```

**Testing on sandbox:**

```bash
eom test --branch feat/add-product-category-hierarchy
# Runs:
# - Schema assertion tests (YAML test files)
# - Action Type integration tests against sandbox FalkorDB graph
# - Mapping validation against sandbox ES indices
```

#### 8.3.2 Pull Request (Proposal)

Opening a Pull Request in EOM triggers an automated CI pipeline. The PR is the unit of review — it corresponds to an ontology Proposal.

**CI pipeline on PR open:**

```yaml
# .github/workflows/eom-pr.yml  (or equivalent for GitLab CI / Jenkins)

on: pull_request

jobs:
  eom-validation:
    steps:
      - name: Schema lint
        run: eom lint --strict
        # Checks: naming conventions, required metadata fields,
        #         circular references, orphan link types, duplicate detection

      - name: OPA change classification
        run: |
          eom diff --json main..${{ github.head_ref }} > diff.json
          opa eval \
            --bundle .eom/opa-policies/ \
            --input diff.json \
            'data.eom.schema.change_class' > classification.json
          # Posts classification report as PR comment
          eom pr-comment --classification classification.json

      - name: Duplication radar
        run: eom dedupe-check --threshold 0.85
        # ES cosine similarity scan
        # Fails with PR comment if similarity >= threshold

      - name: Impact analysis
        run: eom impact-analyze --output impact.json
        # Traverses meta-graph in FalkorDB
        # Computes Break Risk score per dependent consumer
        # Posts impact report as PR comment
        # Fails if any BREAKING change lacks approval from affected consumer lead

      - name: Schema tests
        run: eom test --branch ${{ github.head_ref }}

      - name: Index size estimate
        run: eom measure --output sizing.json
        # Reports projected ES index size delta and FalkorDB memory delta
        # Posts as PR comment

      - name: Check approval gates
        run: eom check-approvals --classification classification.json
        # ADDITIVE:     steward approval (1)
        # NON_BREAKING: steward (1) + peer architect (1)
        # BREAKING:     steward + ARB (2) + consumer leads + migration plan verified
```

**Approval gates:**

| Change Class | Required Approvals | Additional Conditions |
|---|---|---|
| `ADDITIVE` | Domain Steward (1) | CI must pass |
| `NON_BREAKING` | Domain Steward (1) + Peer Architect (1) | CI must pass; Impact score < 30 |
| `BREAKING` | Domain Steward + Architecture Review Board (≥2) + Affected Consumer Leads | Impact simulation must pass; migration function scaffolded and reviewed; sunset date set |

#### 8.3.3 Rebase

Rebase is the preferred integration strategy — it produces a linear commit history where each commit maps cleanly to an ontology version increment. Interactive rebase on feature branches is allowed; rewriting history on `main` is blocked.

```bash
# Via CLI
eom rebase feat/add-product-category-hierarchy onto main

# What happens:
# 1. git fetch origin main
# 2. git -C {worktree_path} rebase origin/main
# 3. Pre-commit hook re-runs on each rebased commit
#    (OPA naming policy, schema linter)
# 4. If rebase conflict on YAML:
#    - eom merge-tool opens semantic merge UI
#    - Tool understands ontology semantics (merges property lists, detects name collisions)
#    - Raw text conflict markers are never shown to the user
# 5. Sandbox FalkorDB graph schema is updated to match rebased state
# 6. Sandbox ES index alias is swapped if mapping changed
```

**Merge to main (post-approval):**

```bash
eom merge feat/add-product-category-hierarchy
# 1. git -C {repo} merge --ff-only feat/add-product-category-hierarchy
# 2. Schema Service compiles new state:
#    - Generate FalkorDB Cypher DDL (new labels, indices, UDF registrations)
#    - Generate Elasticsearch mappings (new/updated indices)
#    - Generate compiled Cypher templates for all Action Types
# 3. Apply to production FalkorDB (schema changes via Cypher DDL)
# 4. Apply to production ES (mapping update via alias swap protocol)
# 5. Bump VERSION (MAJOR/MINOR/PATCH per OPA classification)
# 6. Generate CHANGELOG entry
# 7. Regenerate and publish Python + TypeScript SDKs
# 8. Nightly job queued: regenerate embeddings for new/changed types
# 9. git worktree remove {worktree_path}  -- clean up branch worktree
```

---

## 9. Open Policy Agent — Policy Management

### 9.1 Policy Architecture

OPA is the sole policy decision point for all EOM write operations. Policies are Rego files stored in the `.eom/opa-policies/` directory of the Space's Git repository — they are versioned, reviewed, and deployed together with the ontology manifests.

No policy can be changed outside the Git-OPA-CI path. There is no policy configuration in the UI that bypasses version control.

OPA runs as a sidecar to the EOM API service. On startup it loads the policy bundle from the current `main` branch. A GitOps sync process (OPAL or a custom webhook) pushes updated policy bundles to OPA instances whenever a merge to `main` occurs.

### 9.2 Policy Scopes

| Bundle | Evaluated When | Decision |
|---|---|---|
| `data.eom.access` | Every API request | ALLOW / DENY access to Space resources |
| `data.eom.schema.change_class` | Every PR CI run | Classify each edit as ADDITIVE / NON_BREAKING / BREAKING |
| `data.eom.schema.naming` | Pre-commit hook | ALLOW / DENY based on naming convention rules |
| `data.eom.schema.dry` | Pre-commit hook | ALLOW / DENY creation of properties that duplicate shared properties |
| `data.eom.federation.link_allowed` | On cross-Space link type creation | ALLOW / DENY based on target space visibility |
| `data.eom.action.invoke` | Every Action Type API call at runtime | ALLOW / DENY with structured `deny_reason` |
| `data.eom.data.sensitivity` | Every object read that includes CONFIDENTIAL/RESTRICTED fields | ALLOW / MASK / DENY per field |

### 9.3 Schema Change Classification Policy

```rego
# .eom/opa-policies/schema.rego
package eom.schema

import future.keywords.in

# ── Change classification ────────────────────────────────────────────────────

change_class(edit) := "ADDITIVE" if {
  edit.operation in {
    "ADD_OBJECT_TYPE",
    "ADD_LINK_TYPE",
    "ADD_ACTION_TYPE",
    "ADD_INTERFACE",
    "ADD_OPTIONAL_PROPERTY",
    "ADD_INTERFACE_IMPLEMENTATION",
    "ADD_TAG",
    "ADD_SEMANTIC_ANNOTATION",
    "ASSIGN_STEWARD",
    "ADD_TYPE_REFERENCE"
  }
}

change_class(edit) := "NON_BREAKING" if {
  edit.operation in {
    "UPDATE_DESCRIPTION",
    "UPDATE_DISPLAY_NAME",
    "UPDATE_SENSITIVITY_LABEL",
    "ADD_REQUIRED_PROPERTY_TO_DRAFT",
    "ADD_SHARED_PROPERTY_TO_DRAFT",
    "UPDATE_VALUE_TYPE_CONSTRAINT_WIDEN",  # widening a constraint is non-breaking
    "ADD_DERIVED_PROPERTY"
  }
}

change_class(edit) := "BREAKING" if {
  edit.operation in {
    "RENAME_PROPERTY",
    "CHANGE_PROPERTY_BASE_TYPE",
    "DELETE_PROPERTY",
    "DELETE_OBJECT_TYPE",
    "DELETE_LINK_TYPE",
    "CHANGE_PRIMARY_KEY",
    "MAKE_PROPERTY_REQUIRED",      # optional → required on PUBLISHED type
    "REDUCE_LINK_CARDINALITY",
    "REMOVE_INTERFACE_IMPLEMENTATION",
    "UPDATE_VALUE_TYPE_CONSTRAINT_NARROW",
    "CHANGE_SHARED_PROPERTY_BASE_TYPE"
  }
}

# ── Overall PR decision ──────────────────────────────────────────────────────

default allow := false

allow if {
  not has_unapproved_breaking_change
  not has_unapproved_non_breaking_change
}

has_unapproved_breaking_change if {
  some edit in input.edits
  change_class(edit) == "BREAKING"
  not breaking_change_approved
}

has_unapproved_non_breaking_change if {
  some edit in input.edits
  change_class(edit) == "NON_BREAKING"
  count(input.approvals.steward_ids) < 1
}

breaking_change_approved if {
  count(input.approvals.arb_ids) >= 2
  count(input.approvals.steward_ids) >= 1
  input.approvals.impact_simulation_passed == true
  input.approvals.migration_plan_reviewed == true
  # Every breaking edit must have a sunset_date set
  every edit in input.edits {
    change_class(edit) != "BREAKING"
  }
}

breaking_change_approved if {
  count(input.approvals.arb_ids) >= 2
  count(input.approvals.steward_ids) >= 1
  input.approvals.impact_simulation_passed == true
  input.approvals.migration_plan_reviewed == true
  every edit in input.edits {
    change_class(edit) != "BREAKING"
  }
}
```

### 9.4 Naming Convention Policy

```rego
# .eom/opa-policies/naming.rego
package eom.schema.naming

import future.keywords.in

# Object type api_name: lowercase snake_case, no reserved DB prefixes
valid_object_type_name if {
  regex.match(`^[a-z][a-z0-9_]{1,}$`, input.api_name)
  not has_reserved_prefix(input.api_name)
  count(input.api_name) <= 80
}

reserved_prefixes := {"tbl_", "t_", "fact_", "dim_", "vw_", "tmp_", "stg_", "raw_", "ext_"}

has_reserved_prefix(name) if {
  some prefix in reserved_prefixes
  startswith(name, prefix)
}

# Property api_name: camelCase
valid_property_name if {
  regex.match(`^[a-z][a-zA-Z0-9]{0,}$`, input.property_api_name)
}

# Link type api_name: lowercase snake_case, must start with an approved verb
valid_link_type_name if {
  regex.match(`^[a-z][a-z0-9_]+$`, input.link_api_name)
  parts := split(input.link_api_name, "_")
  parts[0] in data.eom.approved_link_verbs
}

# DRY: no local property if matching shared property exists
no_shared_property_duplication if {
  not data.eom.shared_properties[input.new_property_api_name]
}
```

### 9.5 Runtime Action Invocation Policy

```rego
# .eom/opa-policies/action_invoke.rego
package eom.action

import future.keywords.in

default allow := false

allow if {
  caller_has_required_role
  object_sensitivity_cleared
  not object_locked
  submission_criteria_met
}

caller_has_required_role if {
  action_def := data.eom.action_types[input.action_type_api_name]
  some required_role in action_def.permissions.required_roles
  required_role in input.caller.roles
}

object_sensitivity_cleared if {
  input.object_sensitivity in {"PUBLIC", "INTERNAL"}
}

object_sensitivity_cleared if {
  input.object_sensitivity in {"CONFIDENTIAL", "RESTRICTED"}
  "ELEVATED_CLEARANCE" in input.caller.roles
}

object_locked if {
  data.eom.locks[input.object_id].locked == true
  not "LOCK_OVERRIDE" in input.caller.roles
}

# Submission criteria are pre-evaluated by the Action Service via Cypher
# and passed as input to OPA to avoid a second round-trip
submission_criteria_met if {
  input.submission_criteria_passed == true
}

deny_reason := "INSUFFICIENT_ROLE" if { not caller_has_required_role }
deny_reason := "SENSITIVITY_NOT_CLEARED" if {
  caller_has_required_role
  not object_sensitivity_cleared
}
deny_reason := "OBJECT_LOCKED" if { object_locked }
deny_reason := "SUBMISSION_CRITERIA_FAILED" if {
  caller_has_required_role
  object_sensitivity_cleared
  not object_locked
  not submission_criteria_met
}
```

### 9.6 CI/CD Integration

OPA is integrated into the Git CI pipeline using the official `opa eval` command. Policy bundles are loaded from the `.eom/opa-policies/` directory.

```bash
# In CI pipeline (PR check step)
opa eval \
  --bundle .eom/opa-policies/ \
  --data eom-data.json \          # shared property registry, action type registry
  --input diff.json \             # computed by `eom diff --json`
  --format pretty \
  'data.eom.schema.allow'         # → true or false + deny reasons
```

Policy unit tests live alongside the Rego files and run in CI:

```bash
opa test .eom/opa-policies/ --verbose
# PASS: 47/47 tests
```

---

## 10. Versioning

### 10.1 Semantic Versioning Alignment

All versioned entities (Ontology Space, Object Types, Shared Properties, Interfaces, Value Types) use Semantic Versioning (`MAJOR.MINOR.PATCH`).

| OPA Change Class | Version Bump | Examples |
|---|---|---|
| `ADDITIVE` | `PATCH` bump | Add optional property, add new Object Type, add tag, add semantic annotation |
| `NON_BREAKING` | `MINOR` bump | Add required property to DRAFT type, add interface implementation, update description |
| `BREAKING` | `MAJOR` bump | Rename property, change base type, delete Object Type, change primary key, reduce cardinality |

### 10.2 Ontology Space Versioning

The `VERSION` file in the repository root is the authoritative version of the Space's ontology. CI auto-bumps it on every merge to `main`.

```
VERSION: 2.4.1

CHANGELOG entry (auto-generated by CI):
## [2.4.1] — 2026-04-06
### Added (ADDITIVE → PATCH)
- object-types/product_category — new Object Type
- link-types/belongs_to_category — new link type from product to product_category
- object-types/product: optional property category_id (String)

## [2.4.0] — 2026-03-15
### Changed (NON_BREAKING → MINOR)
- interfaces/lifecycle_tracked: added optional shared property archived_at
- object-types/order: implemented interface lifecycle_tracked

## [2.0.0] — 2026-01-20
### Breaking (BREAKING → MAJOR)
- object-types/order: renamed property cpty_ref → counterparty_id
  Sunset date: 2026-07-20
  Migration function: action-types/migrate_order_cpty_ref_v1_to_v2.cypher
```

### 10.3 Object Type Schema Versioning

Each Object Type carries its own schema version, allowing consumers to pin to a specific type version independent of the Space version.

```yaml
object_type:
  api_name: order
  version: 3.1.0
  min_compatible_version: 2.0.0   # oldest version consumers can safely use
  schema_hash: sha256:a3f1...     # deterministic hash of schema definition
  falkor_label: ObjType_order     # always the same label; schema migrations use node updates
  es_alias: eom_a1b2c3_order      # read alias always points to current
  es_index: eom_a1b2c3_order_v3   # versioned index
  version_history:
    - version: 3.0.0
      schema_hash: sha256:b4e2...
      published_at: 2026-03-01
      breaking_changes:
        - renamed property cpty_ref to counterparty_id
      migration_cypher: action-types/migrate_order_cpty_ref_v1_to_v2.cypher
    - version: 2.0.0
      schema_hash: sha256:c5f3...
      published_at: 2026-01-20
```

### 10.4 Package Versioning and Compatibility

When an ontology package is published to the enterprise Marketplace, EOM computes a compatibility matrix across all declared consumers of that package.

```yaml
# package-lock.yaml (in consuming Space's repo)
packages:
  - name: party-reference
    source_space_id: uuid-of-party-space
    version_range: "^1.3.0"       # compatible with any 1.x.x >= 1.3.0
    resolved_version: "1.4.2"
    resolved_hash: sha256:d6e4...
    imported_types:
      - object_type: legal_entity
        as: ext_legal_entity       # optional local alias to avoid name collision
      - shared_property: lei_code
```

---

## 11. Volume & Health Metrics

### 11.1 Per-Object-Type Volume Dashboard

| Metric | Source Query | Stored In | Frequency |
|---|---|---|---|
| Instance count | `MATCH (n:ObjType_{t}) RETURN count(n)` | `eom_metrics` | Hourly |
| Count Δ (hourly rate) | Delta between readings | `eom_metrics` | Hourly |
| Property fill rate | Aggregation per property | `eom_metrics` | Daily |
| Link instance count | `MATCH ()-[r:LINK_{t}]->() RETURN count(r)` | `eom_metrics` | Hourly |
| FalkorDB memory (MB) | `GRAPH.INFO {graph_name}` memory field | `eom_metrics` | Hourly |
| ES index disk bytes | `_cat/indices size.bytes` | `eom_metrics` | Hourly |
| ES document count | `_cat/indices docs.count` | `eom_metrics` | Hourly |
| ES embedding index size | `_stats fielddata` for dense_vector field | `eom_metrics` | Daily |
| Action execution count | Audit log aggregation | `eom_metrics` | Hourly |
| Action error rate | Audit log aggregation | `eom_metrics` | Hourly |
| Search query volume | ES `_stats search.query_total` | `eom_metrics` | Hourly |

### 11.2 Index Size Estimation

Before a new Object Type is published, the Schema Service estimates the expected storage impact:

```
FalkorDB node memory estimate:
  E_falkor = N_nodes × Σ(property_type_size_bytes × fill_rate)

  Type sizes (approximate):
    Short keyword   :   32 bytes
    Long keyword    :  128 bytes
    Integer / Long  :    8 bytes
    Double / Float  :    8 bytes
    Boolean         :    1 byte
    Date / Timestamp:    8 bytes
    Text (avg 80ch) :  160 bytes
    Dense vector (d):  d × 4 bytes   (e.g. 1536-dim → 6,144 bytes)
    Struct (JSON)   :  variable, est from sample

Elasticsearch index size estimate:
  E_es = N_docs × avg_doc_size × (1 + replica_count) × 1.25  [25% overhead]
  avg_doc_size = Σ(field_size × fill_rate) + 200 bytes base
```

The estimate is posted as a PR comment so stewards can make informed resource decisions before approving a publish.

### 11.3 Ontology Health Score (OHS)

The OHS is a composite 0–100 metric computed nightly across five dimensions. It is the primary signal for proactive stewardship.

| Dimension | Weight | Metrics | Penalty per Violation |
|---|---|---|---|
| **Completeness** | 25% | % of PUBLISHED Object Types with: description, steward, sensitivity label, ≥1 property, ≥1 datasource or action type | −5 pts per type below threshold |
| **DRY Conformance** | 20% | % of properties using shared property where one exists; duplicate Object Type pairs outstanding | −10 pts per outstanding duplicate pair |
| **Change Governance** | 20% | % of BREAKING changes in last 90 days that followed approved path; % with migration functions | −15 pts per governance bypass |
| **Freshness** | 20% | % of datasource-backed types synced within SLA; average indexing lag | −5 pts per SLA breach |
| **Utilisation** | 15% | % of PUBLISHED Object Types queried ≥ once in 90 days; % of Action Types executed ≥ once in 90 days | −3 pts per unused PUBLISHED type |

---

## 12. API Surface

### 12.1 REST API

All REST endpoints require a Bearer token (JWT, validated against the configured IdP). OPA evaluates access on every request.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/spaces` | List Spaces accessible to caller |
| `POST` | `/api/v1/spaces` | Create a new Space (auto-creates Ontology + Git repo) |
| `GET` | `/api/v1/spaces/{spaceId}` | Get Space metadata |
| `GET` | `/api/v1/spaces/{spaceId}/ontology` | Get current published ontology manifest |
| `GET` | `/api/v1/spaces/{spaceId}/object-types` | List Object Types |
| `GET` | `/api/v1/spaces/{spaceId}/object-types/{apiName}` | Get Object Type schema (properties, links, actions) |
| `GET` | `/api/v1/spaces/{spaceId}/object-types/{apiName}/volume` | Get volume metrics for a type |
| `POST` | `/api/v1/spaces/{spaceId}/branches` | Create feature branch + worktree |
| `GET` | `/api/v1/spaces/{spaceId}/branches` | List active branches |
| `DELETE` | `/api/v1/spaces/{spaceId}/branches/{branch}` | Delete branch + worktree (post-merge) |
| `POST` | `/api/v1/spaces/{spaceId}/branches/{branch}/rebase` | Rebase branch onto main |
| `POST` | `/api/v1/spaces/{spaceId}/proposals` | Open a PR (proposal) |
| `GET` | `/api/v1/spaces/{spaceId}/proposals/{prId}` | Get PR status |
| `GET` | `/api/v1/spaces/{spaceId}/proposals/{prId}/impact` | Get impact analysis report |
| `POST` | `/api/v1/spaces/{spaceId}/proposals/{prId}/approve` | Submit approval |
| `POST` | `/api/v1/spaces/{spaceId}/proposals/{prId}/merge` | Merge approved PR |
| `GET` | `/api/v1/spaces/{spaceId}/objects/{objectTypeApiName}` | Query objects (filter, sort, paginate) |
| `GET` | `/api/v1/spaces/{spaceId}/objects/{objectTypeApiName}/{objectId}` | Get single object |
| `POST` | `/api/v1/spaces/{spaceId}/objects/{objectTypeApiName}/search` | Hybrid semantic search |
| `POST` | `/api/v1/spaces/{spaceId}/actions/{actionTypeApiName}/invoke` | Invoke Action Type |
| `GET` | `/api/v1/spaces/{spaceId}/actions/{actionTypeApiName}/log` | Action execution log |
| `GET` | `/api/v1/spaces/{spaceId}/health` | Ontology Health Score |
| `GET` | `/api/v1/spaces/{spaceId}/metrics` | Volume + index size metrics |
| `POST` | `/api/v1/spaces/{spaceId}/export` | Export ontology (YAML / JSON-LD / Turtle) |
| `POST` | `/api/v1/spaces/{spaceId}/import` | Import external ontology package |
| `GET` | `/api/v1/shared-properties` | Global Shared Property Registry |
| `GET` | `/api/v1/marketplace/packages` | Browse published packages |
| `POST` | `/api/v1/marketplace/packages/{packageId}/import` | Import package into Space |

### 12.2 GraphQL API (Strawberry, auto-generated per Space)

The GraphQL schema is auto-generated from the published ontology on every merge to `main`. Resolvers are backed by the Query Service (FalkorDB + Elasticsearch).

```graphql
type Query {
  # Object type queries — one per Object Type in the Space
  orders(
    filter: OrderFilter
    sort: [OrderSort]
    first: Int
    after: String
  ): OrderConnection!

  order(id: ID!): Order

  searchOrders(query: String!, k: Int = 20): [OrderSearchResult!]!

  # Graph traversal — follow link types
  orderPlacedByCustomer(orderId: ID!): Customer

  # Cross-type linked objects
  customerOrders(customerId: ID!): [Order!]!
}

type Mutation {
  # One mutation per Action Type
  submitOrder(
    orderId: ID!
    customerId: ID!
    submittedAt: DateTime!
  ): ActionResult!

  cancelOrder(
    orderId: ID!
    reason: String!
    cancelledAt: DateTime!
  ): ActionResult!
}

type ActionResult {
  status: ActionStatus!
  objectId: ID!
  actionType: String!
  actor: String!
  timestamp: DateTime!
  sideEffects: [SideEffectResult!]!
}
```

### 12.3 Streaming API

- **Server-Sent Events (SSE):** `GET /api/v1/spaces/{spaceId}/objects/{objectTypeApiName}/stream` — real-time change notifications for an object type
- **WebSocket:** `WS /api/v1/spaces/{spaceId}/objects/{objectTypeApiName}/subscribe` — subscription for targeted object IDs

### 12.4 Auto-Generated SDKs

On every merge to `main`, the SDK Generator produces and publishes:
- **Python SDK:** published to the enterprise PyPI registry as `eom-sdk-{space_name}`
- **TypeScript SDK:** published to the enterprise npm registry as `@eom/{space_name}`

Both SDKs are fully typed and pinned to the schema version they were generated from. Consumers pin to a version range in their dependency file and receive compatibility reports when the producer publishes a new SDK.

---

## 13. Application Modules & UI

### 13.1 EOM Studio (React SPA)

The primary authoring and exploration interface. Built with React 18, TypeScript, Vite, and Tailwind CSS.

#### 13.1.1 Graph Views — Two Complementary Renderers

EOM Studio uses two graph libraries with a strict division of responsibility:

| Surface | Library | Engine | Purpose |
|---|---|---|---|
| **Authoring Canvas** | React Flow 12.x | SVG + HTML | Create/edit Object Types, draw Link Types, open editors — native React form integration |
| **Exploration Graph** | AntV G6 5.x | Canvas (WebGL optional) | Read-only traversal of 200+ node ontologies, layout algorithms, blast radius, dependency trees |
| **Galaxy View** *(Phase 3, optional)* | `3d-force-graph` | Three.js / WebGL | 3D force-directed view across all Spaces when total type count exceeds ~300 |

The two primary renderers are lazy-loaded — G6 only loads when the user navigates to the Explore page, keeping the initial bundle fast.

**Authoring Canvas (React Flow)**

- Zoomable, pan-able SVG canvas
- Three rendering modes: **Conceptual** (domain clusters), **Logical** (all types and links), **Physical** (datasource and index annotations)
- Drag-and-drop Object Type creation; click-to-draw Link Types between nodes
- Multi-select with bulk property editing and bulk tag assignment
- Diff overlay: colour-coded visual comparison of two branches
- React Flow minimap + breadcrumb navigation

**Exploration Graph (AntV G6)**

- G6 layout algorithms available: force, dagre (hierarchical), radial, tree, circular
- Blast radius mode: highlight all upstream and downstream dependents from a selected Object Type
- Dependency tree: expand any node to its full transitive dependency chain
- Path finder: shortest path between two selected types
- Fisheye lens for navigating dense subgraphs
- G6 built-in minimap and legend panel
- Node click opens the same Object Type Editor panel used in the Authoring Canvas (read-only when on main branch)

#### 13.1.2 Object Type Editor

Opened by clicking any node on the canvas. Tabbed layout:

| Tab | Content |
|---|---|
| **Overview** | Identity fields, domain, status badge, steward, sensitivity, semantic IRI |
| **Properties** | Inline property editor; drag-to-reorder; import from JSON Schema or CSV |
| **Interfaces** | Implemented interfaces with property inheritance visualisation |
| **Link Types** | Subgraph of connected types; create new link type inline |
| **Action Types** | List of actions; inline action editor; compiled Cypher preview |
| **Datasource** | Schema automapping wizard; mapping confidence scores; sync status |
| **Observability** | 30-day instance count chart; freshness indicator; search query volume |
| **Governance** | Type references; compliance annotations (project-defined); version history |

#### 13.1.3 Shared Property Registry

Searchable table of all Shared Properties in the Space. Columns: api_name, base_type, value_type, sensitivity, used_by (count + list), version, steward. Create / edit / deprecate Shared Properties inline.

#### 13.1.4 Version & Branch Management

- **Branches panel:** list of active worktrees with status, last commit, author, age
- **PR panel:** list of open proposals with CI status, approval progress, change classification badge
- **Version history:** CHANGELOG rendered with semantic diff expandable per version
- **Package manager:** browse imported packages, check for updates, resolve compatibility warnings

#### 13.1.5 Health Dashboard

- Space-level OHS gauge with 5-dimension breakdown
- Per-Object-Type OHS list with drill-down to specific failures
- Volume charts: instance counts, index sizes, action execution rates
- Alert feed: freshness SLA breaches, duplicate warnings, governance bypasses, orphaned types

#### 13.1.6 Semantic Search

- Natural-language search bar (hybrid BM25 + kNN with RRF)
- Filters by Object Type, sensitivity level, domain, tag, and link type
- Object detail panel with property values and linked object previews
- SQL mode: raw Cypher input with result table (VIEWER role and above)

### 13.2 EOM CLI

```
eom [command] [options]

Commands:
  space create        Create a new Space and Ontology
  space list          List Spaces

  branch create       Create a feature branch and worktree
  branch list         List active branches
  branch delete       Delete a branch and worktree

  diff                Semantic diff between branches or versions
  lint                Run schema linter on current branch
  test                Run schema tests and action integration tests
  measure             Estimate index size and FalkorDB memory for branch

  pr open             Open a Pull Request (Proposal)
  pr status           Check PR CI status and approvals
  pr approve          Submit your approval for a PR
  pr merge            Merge an approved PR

  rebase              Rebase current branch onto main (ontology-aware)

  publish             Publish current state to production (admin only)
  export              Export ontology (yaml | jsonld | turtle | avro | graphql)
  import              Import an external ontology package

  sdk generate        Manually regenerate Python and TypeScript SDKs

  health              Show Ontology Health Score for a Space
  metrics             Show volume and index metrics

  opa test            Run OPA policy unit tests
```

---

## 14. Non-Functional Requirements

### 14.1 Performance

| Metric | Target | Measurement |
|---|---|---|
| Object query p50 latency (FalkorDB) | < 15 ms | Synthetic load, 1K RPS |
| Object query p99 latency (FalkorDB) | < 150 ms | Synthetic load, 1K RPS |
| Semantic search p99 latency (ES) | < 300 ms | Synthetic load, 200 RPS |
| Action invocation p99 (simple, 1 edit) | < 2 s | Synthetic load, 500 RPS |
| Action invocation p99 (complex, 5 edits + links) | < 5 s | Synthetic load, 200 RPS |
| Indexing freshness (batch) | < 15 min after source update | Canary dataset |
| Indexing freshness (streaming) | < 30 s after event | Kafka consumer lag |
| Authoring Canvas render (200 types, React Flow) | < 2 s initial paint | E2E Playwright test |
| Exploration Graph render (500 types, AntV G6 canvas) | < 1.5 s initial layout | E2E Playwright test |
| Schema compile + publish (100 types) | < 60 s | Benchmark |
| Impact analysis (5K-node meta-graph) | < 30 s | Benchmark |
| OPA policy evaluation (single decision) | < 5 ms | OPA built-in benchmark |

### 14.2 Scale

- Up to **5,000 Object Types** per Space
- Up to **50,000 Properties** per Space
- Up to **10,000 Link Types** per Space
- Up to **50 billion object instances** across all types in a single cluster
- Up to **500 concurrent users** (read); **100 concurrent users** (write)
- Up to **20 active feature branches** per Space simultaneously
- Up to **100 Spaces** in a single EOM deployment

### 14.3 Security

- **Authentication:** OIDC / OAuth 2.0 with PKCE; SAML 2.0 SSO; MFA enforced for all write operations on CORE-tier Spaces
- **Authorisation:** Role-based (§4.4) + OPA attribute-based at the field/operation level
- **Encryption at rest:** AES-256; BYOK via AWS KMS / Azure Key Vault / GCP KMS / HashiCorp Vault
- **Encryption in transit:** TLS 1.3 mandatory
- **Audit log:** Every read (for CONFIDENTIAL/RESTRICTED fields) and all writes logged to Elasticsearch with user identity, timestamp, source IP, and payload hash; logs are immutable and WORM-compliant
- **Supply chain:** All container images signed (Sigstore/Cosign); SBOMs published per release

### 14.4 Reliability

- **SLA:** 99.95% uptime for reads; 99.9% for writes (monthly, excl. maintenance)
- **RPO:** 15 minutes; **RTO:** 1 hour for full-cluster failure
- **Deployment:** Multi-AZ active-active; cross-region active-passive DR
- **FalkorDB:** Replicated via Redis Cluster mode for multi-AZ persistence
- **Elasticsearch:** 3-node cluster minimum; 1 replica per shard

### 14.5 Observability

- **Structured logging:** All services emit JSON logs to stdout; collected by the platform logging stack
- **Metrics:** Prometheus-format metrics exposed by all services; scraped and visualised in Grafana
- **Tracing:** OpenTelemetry distributed tracing across EOM API, Schema Service, Query Service, Action Service
- **Alerting:** PagerDuty integration for SLA breaches; Slack/Teams for steward notifications

---

## 15. Project Structure for Claude Code

This section defines the precise repository layout, technology choices, and build conventions Claude Code must follow when building the application.

### 15.1 Monorepo Layout

```
eom/
├── apps/
│   ├── api/                        # FastAPI application
│   │   ├── main.py
│   │   ├── routers/
│   │   │   ├── spaces.py
│   │   │   ├── object_types.py
│   │   │   ├── proposals.py
│   │   │   ├── actions.py
│   │   │   ├── search.py
│   │   │   └── health.py
│   │   ├── services/
│   │   │   ├── schema_service.py   # YAML → FalkorDB DDL + ES mappings
│   │   │   ├── query_service.py    # FalkorDB + ES hybrid queries
│   │   │   ├── action_service.py   # OPA + Cypher transaction execution
│   │   │   ├── git_service.py      # Worktree lifecycle, PR, rebase
│   │   │   ├── opa_service.py      # OPA REST API client
│   │   │   └── sdk_generator.py    # Auto-generate Python + TS SDKs
│   │   ├── models/                 # Pydantic v2 models
│   │   │   ├── space.py
│   │   │   ├── object_type.py
│   │   │   ├── property.py
│   │   │   ├── link_type.py
│   │   │   ├── action_type.py
│   │   │   ├── interface.py
│   │   │   ├── shared_property.py
│   │   │   └── value_type.py
│   │   ├── graphql/                # Strawberry GraphQL schema (auto-generated per Space)
│   │   │   └── schema_generator.py
│   │   └── middleware/
│   │       ├── auth.py             # JWT validation
│   │       └── audit.py            # Audit log middleware
│   │
│   └── studio/                     # React 18 SPA
│       ├── src/
│       │   ├── components/
│       │   │   ├── canvas/         # React Flow — authoring
│       │   │   ├── explore/        # AntV G6 — exploration & impact analysis
│       │   │   └── galaxy/         # 3d-force-graph — Phase 3 optional
│       │   │   ├── editors/        # Object type, property, link type editors
│       │   │   ├── proposals/      # PR creation and review UI
│       │   │   ├── health/         # OHS dashboard
│       │   │   └── search/         # Hybrid search UI
│       │   ├── stores/             # Zustand state management
│       │   ├── api/                # TanStack Query hooks (typed against OpenAPI)
│       │   └── utils/
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   ├── eom-cli/                    # Click CLI (eom branch, eom diff, etc.)
│   │   ├── eom_cli/
│   │   │   ├── commands/
│   │   │   │   ├── branch.py
│   │   │   │   ├── diff.py
│   │   │   │   ├── lint.py
│   │   │   │   ├── pr.py
│   │   │   │   ├── rebase.py
│   │   │   │   └── export.py
│   │   │   ├── compiler/
│   │   │   │   ├── yaml_parser.py
│   │   │   │   ├── cypher_compiler.py   # YAML → Cypher templates
│   │   │   │   ├── es_mapper.py         # YAML → ES mapping JSON
│   │   │   │   └── udf_compiler.py      # derived property → JS UDF
│   │   │   └── git/
│   │   │       ├── worktree.py          # pygit2 worktree management
│   │   │       └── semantic_merge.py    # YAML-aware merge conflict resolution
│   │   └── pyproject.toml
│   │
│   └── eom-sdk-generator/          # Auto-generates typed Python + TS clients
│       ├── generator/
│       │   ├── python_generator.py
│       │   └── typescript_generator.py
│       └── pyproject.toml
│
├── infra/
│   ├── docker-compose.yml          # Local dev: FalkorDB, ES, OPA, API, Studio
│   ├── k8s/                        # Kubernetes manifests
│   │   ├── falkordb/
│   │   ├── elasticsearch/
│   │   ├── opa/
│   │   └── eom-api/
│   └── terraform/                  # Cloud infrastructure (AWS / Azure / GCP)
│
├── tests/
│   ├── unit/
│   ├── integration/                # Tests against live FalkorDB + ES instances
│   └── e2e/                        # Playwright tests for Studio
│
├── docs/
│   ├── api/                        # OpenAPI spec (auto-generated)
│   ├── architecture/               # ADRs
│   └── guides/
│
├── .github/
│   └── workflows/
│       ├── eom-pr.yml              # PR validation pipeline
│       ├── publish-sdk.yml         # SDK publish on main merge
│       └── release.yml             # Versioned release
│
├── pyproject.toml                  # Root Python project (uv workspace)
├── package.json                    # Root Node project (pnpm workspace)
└── docker-compose.yml              # Local development stack
```

### 15.2 Technology Versions (Pinned)

| Technology | Version | Notes |
|---|---|---|
| Python | 3.12 | All backend services |
| FastAPI | 0.115.x | REST API |
| Pydantic | v2.x | Data validation |
| Strawberry | 0.240.x | GraphQL |
| FalkorDB Python client | latest stable | `pip install falkordb` |
| Elasticsearch Python client | 8.x | `pip install elasticsearch` |
| pygit2 | 1.15.x | Git worktree management |
| OPA | 0.7x | Sidecar container |
| React | 18.x | Studio SPA |
| TypeScript | 5.x | Studio SPA + TS SDK |
| React Flow | 12.x | Authoring canvas (SVG+HTML, React-native) |
| AntV G6 | 5.x | Exploration graph (Canvas/WebGL, layout algorithms) |
| `3d-force-graph` | latest | Galaxy view — Phase 3 only, loads lazily |
| Vite | 5.x | Studio build |
| TanStack Query | 5.x | API state management |
| Zustand | 4.x | Local state management |
| Tailwind CSS | 3.x | Styling |
| Monaco Editor | 0.45.x | YAML/Cypher/Rego editing |
| pnpm | 9.x | Node package manager |
| uv | 0.4.x | Python package manager |
| Docker | 26.x | Container runtime |

### 15.3 Local Development Stack

```yaml
# docker-compose.yml
services:

  falkordb:
    image: falkordb/falkordb:latest
    ports: ["6379:6379", "3000:3000"]
    volumes: ["./data/falkordb:/var/lib/falkordb/data"]
    environment:
      - FALKORDB_MAX_MEMORY=4gb

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
    ports: ["9200:9200"]
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false   # dev only — enable in prod
      - ES_JAVA_OPTS=-Xms2g -Xmx2g
    volumes: ["./data/elasticsearch:/usr/share/elasticsearch/data"]

  opa:
    image: openpolicyagent/opa:latest
    ports: ["8181:8181"]
    command:
      - run
      - --server
      - --config-file=/config/config.yaml
    volumes: ["./opa-config:/config"]

  api:
    build: ./apps/api
    ports: ["8000:8000"]
    environment:
      - FALKORDB_HOST=falkordb
      - FALKORDB_PORT=6379
      - ELASTICSEARCH_URL=http://elasticsearch:9200
      - OPA_URL=http://opa:8181
      - GIT_REPOS_PATH=/srv/eom-repos
      - JWT_SECRET=dev-secret-change-in-prod
    volumes:
      - ./apps/api:/app
      - ./data/git-repos:/srv/eom-repos

  studio:
    build: ./apps/studio
    ports: ["5173:5173"]
    environment:
      - VITE_API_URL=http://localhost:8000
    volumes: ["./apps/studio/src:/app/src"]
```

### 15.4 Environment Variables

```bash
# Required for all environments
FALKORDB_HOST=
FALKORDB_PORT=6379
FALKORDB_PASSWORD=              # empty for dev
ELASTICSEARCH_URL=
ELASTICSEARCH_USERNAME=         # empty for dev (security disabled)
ELASTICSEARCH_PASSWORD=
OPA_URL=
GIT_REPOS_PATH=                 # filesystem path for bare Git repos + worktrees
JWT_ISSUER=
JWT_AUDIENCE=

# Required for production
BYOK_KMS_PROVIDER=aws|azure|gcp|vault
BYOK_KMS_KEY_ID=
AUDIT_LOG_ES_INDEX=eom_audit_log
SDK_PYPI_REGISTRY=              # enterprise PyPI registry URL
SDK_NPM_REGISTRY=               # enterprise npm registry URL
PAGERDUTY_INTEGRATION_KEY=

# Optional features
EMBEDDING_MODEL_ENDPOINT=       # if using external embedding service
EMBEDDING_VECTOR_DIMS=1536
OAG_ENABLED=false               # enable Ontology Augmented Generation indices
```

---

## 16. Implementation Roadmap

### Phase 1 — Foundation (Months 1–4)

Goal: A fully functional ontology authoring platform with FalkorDB storage, Elasticsearch search, Git version control, and OPA policy enforcement.

| Sprint | Deliverables | Exit Criteria |
|---|---|---|
| 1–2 | **Git Worktree Infrastructure** — Bare repo creation per Space; worktree lifecycle (create/delete/prune); YAML parser and schema linter; pre-commit hooks | `eom branch create` and `eom lint` work end-to-end |
| 3–4 | **FalkorDB Schema Compiler** — YAML → Cypher DDL (node labels, indices); meta-graph population; basic Cypher query service; JavaScript UDF compilation for derived properties | Object Type persists to FalkorDB; queryable via Cypher |
| 5–6 | **Elasticsearch Integration** — Auto-mapping generation from YAML; index create + alias protocol; dual write on action execution; basic keyword search via BM25 | Object Type ES index created on publish; searchable |
| 7–8 | **OPA Policy Engine** — Rego policies for change classification, naming, DRY, access control; CI pipeline integration; runtime action invoke policy | PR blocked by BREAKING change without approvals; action denied by OPA |
| 9–10 | **Action Type System** — Cypher template compiler; Action Service (OPA → validate → Cypher write → audit log → side-effects); audit log to ES | End-to-end Action Type invocation from API |
| 11–12 | **EOM Studio v1** — Authoring Canvas (React Flow); Object Type editor (all tabs); Branch/PR/Rebase UI; Shared Property Registry; basic Health dashboard | Full authoring workflow in UI |

### Phase 2 — Intelligence (Months 5–8)

Goal: Semantic search, embedding pipeline, federated packages, developer SDK, and production-hardening.

| Sprint | Deliverables | Exit Criteria |
|---|---|---|
| 13–14 | **Hybrid Semantic Search** — Embedding pipeline; dense_vector ES index; BM25+kNN with RRF; graph-topology boost | Semantic search returns relevant results with graph boost |
| 15–16 | **Exploration Graph (AntV G6)** — G6 canvas with dagre/force layouts; blast radius view; dependency tree; path finder; fisheye lens | G6 explorer navigates 300-node ontology in < 1.5 s |
| 15–16 | **Versioning & Compatibility** — SemVer automation; CHANGELOG generation; compatibility matrix; migration function scaffolding; Object Type version history | Merge to main auto-bumps VERSION and CHANGELOG |
| 17–18 | **Cross-Space Federation** — Package publish/import; package-lock; federation link types; PUBLIC Space cross-reference | Package imported from another Space's PUBLIC ontology |
| 19–20 | **Auto-Generated SDKs** — Python + TypeScript SDK generation; PyPI + npm publish on merge to main; Jupyter integration | Typed SDK installed; objects queryable from notebook |
| 21–22 | **OAG Corpus Index** — Chunked document ingestion; OAG index per type; OAG query API | RAG query returns grounded chunks from OAG index |
| 23–24 | **Performance & Scale Hardening** — Load tests to 50B objects; Elasticsearch cluster configuration; FalkorDB cluster mode; API caching layer | All p99 latency targets met at load |

### Phase 3 — Enterprise (Months 9–12)

Goal: Full governance, AI Copilot, advanced observability, and general availability readiness.

| Sprint | Deliverables | Exit Criteria |
|---|---|---|
| 25–26 | **AI Copilot** — Natural language → Object Type YAML proposal; schema generation from data samples; governance anomaly detection; duplication radar integration | Copilot generates accepted proposal in pilot |
| 27–28 | **Advanced OHS & Alerting** — All 5 OHS dimensions; steward alert workflow; PagerDuty integration; Grafana dashboards | OHS deployed to all pilot Spaces with live alerting |
| 29–30 | **Marketplace** — Package discovery, rating, download; org-private namespace; community package PR workflow | 3 packages published and importable |
| 31–32 | **GA Hardening** — SOC 2 evidence; full API documentation; BYOK; air-gap deployment variant; DR test | DR test passed; security audit passed |

---

## 17. Glossary

| Term | Definition |
|---|---|
| **Space** | Top-level container mapping to one Ontology and one Git repository, shared between a defined set of organisations |
| **Ontology** | The complete, versioned set of semantic type definitions (Object Types, Link Types, Shared Properties, Interfaces, Action Types, Value Types) for a Space |
| **Object Type** | A class of real-world business entities. Backed by a FalkorDB node label and an Elasticsearch index |
| **Datasource-Backed Object Type** | An Object Type whose instances are ingested from an external dataset via the indexing pipeline |
| **Datasource-Free Object Type** | An Object Type whose instances are created exclusively through Action Types |
| **Local Property** | A property belonging to exactly one Object Type |
| **Shared Property** | A cross-cutting semantic attribute defined once in the Shared Property Registry and reused across multiple Object Types |
| **Value Type** | A strongly-typed, constraint-bearing wrapper over a base type (e.g., regex-validated string, numeric range) |
| **Link Type** | A typed, directed predicate/relationship between two Object Types. Stored as a directed edge in FalkorDB |
| **Temporally Bounded Link** | A Link Type carrying `valid_from` and `valid_to` for historical relationship modelling |
| **Interface** | An abstract structural contract defining required/optional properties and link types, implementable by multiple Object Types |
| **Action Type** | The schema definition of an atomic change-set (property edits, link operations). Compiled to a parameterised Cypher transaction template |
| **Superset** | A virtual, tag-based grouping of Object Types — not a physical schema entity |
| **Feature Branch** | A Git branch with its own Git Worktree, sandbox FalkorDB graph, and sandbox Elasticsearch indices for ontology development |
| **Proposal (PR)** | A Pull Request containing an ontology change-set, subject to CI, OPA classification, impact analysis, and reviewer approvals |
| **Rebase** | The preferred Git integration strategy in EOM — produces linear commit history aligned to version increments |
| **OPA** | Open Policy Agent — the policy decision point for all EOM write operations, using Rego policies stored in the ontology Git repository |
| **Change Classification** | OPA-assigned label for each schema edit: `ADDITIVE`, `NON_BREAKING`, or `BREAKING` — determines version bump and approval requirements |
| **SemVer** | Semantic Versioning (MAJOR.MINOR.PATCH) — BREAKING bumps MAJOR, NON_BREAKING bumps MINOR, ADDITIVE bumps PATCH |
| **OHS** | Ontology Health Score — composite 0–100 metric across Completeness, DRY Conformance, Change Governance, Freshness, Utilisation |
| **Graph Volume** | FalkorDB node and edge counts and memory footprint per Object Type — tracked hourly |
| **Index Size** | Elasticsearch index disk bytes and document count per Object Type — tracked hourly |
| **Duplication Radar** | Nightly Elasticsearch cosine-similarity scan that detects Object Types with ≥ 0.85 similarity to existing definitions |
| **RRF** | Reciprocal Rank Fusion — rank-based score fusion algorithm used to combine BM25 and kNN search results |
| **OAG** | Ontology Augmented Generation — an Elasticsearch index of document chunks linked to an Object Type, enabling RAG pipelines |
| **Federation Link** | A Link Type whose source and target Object Types reside in different Spaces |
| **Package** | A versioned, published subset of an Ontology importable into any other Space |
| **Git Worktree** | A linked working directory attached to a Git repository, enabling concurrent branch checkouts on the server |
| **Type Reference** | An external standard IRI (from a project-defined vocabulary) mapped to an EOM type or property for semantic grounding and export |
| **UDF** | User-Defined Function in FalkorDB — JavaScript functions that extend Cypher read queries; strictly read-only, used for derived property computation |
| **Cypher Transaction Template** | A parameterised Cypher write script compiled from an Action Type YAML definition and executed atomically by the Action Service |
| **Meta-Graph** | The FalkorDB graph (`eom_meta`) that stores the ontology schema as a property graph, enabling Cypher-based impact analysis and dependency traversal |

---

*End of Document — Enterprise Ontology Manager PRD v2.0*
