# Data Models

> Canonical Pydantic v2 (Python) models and TypeScript interfaces for
> the entire EOM application. These are the source of truth for all
> data shapes. Auto-generated SDKs and GraphQL schemas derive from these.

---

## Python — Pydantic v2 Models

### Base Models

```python
# apps/api/models/base.py
from pydantic import BaseModel, Field, ConfigDict
from typing import Any
from uuid import UUID
from datetime import datetime

class EOMBaseModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        use_enum_values=True,
        str_strip_whitespace=True,
    )

class TimestampedModel(EOMBaseModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

---

### Space & Organisation

```python
# apps/api/models/space.py
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from uuid import UUID, uuid4
from enum import Enum

class SpaceVisibility(str, Enum):
    PRIVATE = "PRIVATE"
    PUBLIC  = "PUBLIC"
    SHARED  = "SHARED"

class SpaceTier(str, Enum):
    CORE         = "CORE"
    DOMAIN       = "DOMAIN"
    EXPERIMENTAL = "EXPERIMENTAL"

class SpaceModel(EOMBaseModel):
    id:               UUID              = Field(default_factory=uuid4)
    name:             str               = Field(min_length=2, max_length=100)
    description:      str               = Field(default="", max_length=2000)
    visibility:       SpaceVisibility
    owning_org_id:    UUID
    member_org_ids:   list[UUID]        = Field(default_factory=list)
    ontology_id:      UUID | None       = None   # same as id, set on creation
    git_repo_path:    str | None        = None
    tier:             SpaceTier         = SpaceTier.DOMAIN
    opa_policy_ref:   str               = ".eom/opa-policies/"
    created_at:       datetime          = Field(default_factory=datetime.utcnow)

class SpaceCreateRequest(EOMBaseModel):
    name:           str            = Field(min_length=2, max_length=100)
    description:    str            = Field(default="")
    visibility:     SpaceVisibility
    owning_org_id:  UUID
    member_org_ids: list[UUID]     = Field(default_factory=list)
    tier:           SpaceTier      = SpaceTier.DOMAIN

class OrganisationModel(EOMBaseModel):
    id:             UUID           = Field(default_factory=uuid4)
    name:           str            = Field(min_length=2, max_length=100)
    description:    str            = Field(default="")
    admin_user_ids: list[UUID]     = Field(default_factory=list)
    created_at:     datetime       = Field(default_factory=datetime.utcnow)

class UserRole(str, Enum):
    VIEWER    = "VIEWER"
    EDITOR    = "EDITOR"
    STEWARD   = "STEWARD"
    PUBLISHER = "PUBLISHER"
    ADMIN     = "ADMIN"
    ORG_ADMIN = "ORG_ADMIN"
```

---

### Object Type

```python
# apps/api/models/object_type.py
from pydantic import BaseModel, Field, field_validator
from typing import Literal
import re

class ObjectTypeStatus(str, Enum):
    DRAFT      = "DRAFT"
    PUBLISHED  = "PUBLISHED"
    DEPRECATED = "DEPRECATED"
    RETIRED    = "RETIRED"

class SensitivityLevel(str, Enum):
    PUBLIC       = "PUBLIC"
    INTERNAL     = "INTERNAL"
    CONFIDENTIAL = "CONFIDENTIAL"
    RESTRICTED   = "RESTRICTED"

class BaseTypeEnum(str, Enum):
    String       = "String"
    Integer      = "Integer"
    Long         = "Long"
    Double       = "Double"
    Boolean      = "Boolean"
    Timestamp    = "Timestamp"
    Date         = "Date"
    GeoPoint     = "GeoPoint"
    GeoShape     = "GeoShape"
    Struct       = "Struct"
    TimeseriesRef = "TimeseriesRef"
    MediaRef     = "MediaRef"
    AttachmentRef = "AttachmentRef"

class StructField(EOMBaseModel):
    api_name:     str
    display_name: str
    base_type:    BaseTypeEnum

class PropertyModel(EOMBaseModel):
    api_name:             str       = Field(pattern=r'^[a-z][a-zA-Z0-9]{0,79}$')
    display_name:         str       = Field(min_length=1, max_length=200)
    description:          str       = Field(default="")
    base_type:            BaseTypeEnum
    value_type_ref:       str | None = None
    is_required:          bool       = False
    is_shared:            bool       = False
    is_edit_only:         bool       = False
    is_mandatory_control: bool       = False
    is_indexed:           bool       = False
    semantic_ref:         str | None = None   # external IRI (project-defined)
    sensitivity_override: SensitivityLevel | None = None
    derived_expression:   str | None = None   # compile to JS UDF
    struct_fields:        list[StructField] = Field(default_factory=list)

class SubmissionCriterion(EOMBaseModel):
    property:       str
    operator:       Literal["EQUALS","NOT_EQUALS","IN","NOT_IN",
                            "IS_NULL","IS_NOT_NULL","GT","LT"]
    value:          Any | None     = None
    value_param:    str | None     = None
    value_is_literal: bool         = True

class ActionParameter(EOMBaseModel):
    name:          str
    type:          BaseTypeEnum | str    # str allows "ObjectRef:order" etc.
    required:      bool           = True
    default_value: Any | None     = None
    object_ref:    str | None     = None  # target object type api_name

class EditDescriptor(EOMBaseModel):
    type:               Literal["SET_PROPERTY","CREATE_LINK","DELETE_LINK",
                                "CREATE_OBJECT","DELETE_OBJECT"]
    property:           str | None  = None
    link_type:          str | None  = None
    value:              Any | None  = None
    value_from_param:   str | None  = None
    target_id_from_param: str | None = None

class SideEffect(EOMBaseModel):
    type:   Literal["NOTIFICATION","WEBHOOK","DOWNSTREAM_ACTION"]
    config: dict

class ActionPermissions(EOMBaseModel):
    required_roles:  list[str]
    opa_policy_ref:  str | None = None

class ValidationRule(EOMBaseModel):
    description:  str
    cypher_check: str  # read-only Cypher returning {valid: bool, message: str}

class ActionTypeModel(EOMBaseModel):
    api_name:             str        = Field(pattern=r'^[a-z][a-z0-9_]{1,79}$')
    display_name:         str
    description:          str        = ""
    target_object_type:   str
    parameters:           list[ActionParameter]   = Field(default_factory=list)
    submission_criteria:  list[SubmissionCriterion] = Field(default_factory=list)
    validation_rules:     list[ValidationRule]    = Field(default_factory=list)
    edits:                list[EditDescriptor]    = Field(default_factory=list)
    side_effects:         list[SideEffect]        = Field(default_factory=list)
    permissions:          ActionPermissions
    undoable:             bool                    = False
    compiled_cypher_ref:  str | None              = None  # path to .cypher file

class DatasourceMapping(EOMBaseModel):
    dataset_id:         str
    source_type:        Literal["PARQUET","DELTA","JDBC","KAFKA","CSV"]
    property_mappings:  dict[str, str]  # {property_api_name: source_column}
    ingest_mode:        Literal["BATCH","STREAMING"] = "BATCH"
    batch_schedule:     str | None      = None   # cron expression
    kafka_topic:        str | None      = None
    mapping_confidence: float | None    = None
    last_sync_at:       datetime | None = None
    sync_status:        str | None      = None

class ObjectTypeModel(EOMBaseModel):
    api_name:           str       = Field(pattern=r'^[a-z][a-z0-9_]{1,79}$')
    display_name:       str       = Field(min_length=1, max_length=200)
    plural_display_name:str       = Field(default="")
    description:        str       = Field(default="")
    domain:             str       = Field(default="")
    status:             ObjectTypeStatus = ObjectTypeStatus.DRAFT
    tags:               list[str] = Field(default_factory=list)
    semantic_iri:       str | None = None
    external_type_refs: list[str] = Field(default_factory=list)
    primary_key:        str       = "_eom_id"
    interfaces:         list[str] = Field(default_factory=list)
    shared_property_refs: list[str] = Field(default_factory=list)
    properties:         list[PropertyModel] = Field(default_factory=list)
    action_types:       list[ActionTypeModel] = Field(default_factory=list)
    datasource:         DatasourceMapping | None = None
    steward_id:         str | None = None
    sensitivity_level:  SensitivityLevel = SensitivityLevel.INTERNAL
    version:            str        = "0.1.0"
    enable_embeddings:  bool       = False

    @field_validator('api_name')
    @classmethod
    def no_reserved_prefix(cls, v):
        reserved = ["tbl_","t_","fact_","dim_","vw_","tmp_","stg_","raw_","ext_"]
        for prefix in reserved:
            if v.startswith(prefix):
                raise ValueError(f"api_name must not start with reserved prefix '{prefix}'")
        return v

    @property
    def falkor_label(self) -> str:
        return f"ObjType_{self.api_name}"

    @property
    def es_alias(self) -> str:
        return "eom_{space_id}_" + self.api_name  # space_id substituted at publish
```

---

### Link Type

```python
# apps/api/models/link_type.py
class LinkCardinality(str, Enum):
    ONE_TO_ONE   = "ONE_TO_ONE"
    ONE_TO_MANY  = "ONE_TO_MANY"
    MANY_TO_ONE  = "MANY_TO_ONE"
    MANY_TO_MANY = "MANY_TO_MANY"

class CascadeRule(str, Enum):
    RESTRICT = "RESTRICT"
    CASCADE  = "CASCADE"
    SET_NULL = "SET_NULL"
    ARCHIVE  = "ARCHIVE"

class LinkTypeModel(EOMBaseModel):
    api_name:               str     = Field(pattern=r'^[a-z][a-z0-9_]{1,79}$')
    display_name:           str
    description:            str     = ""
    source_object_type:     str
    target_object_type:     str
    cardinality:            LinkCardinality
    inverse_api_name:       str | None = None
    link_properties:        list[PropertyModel] = Field(default_factory=list)
    is_temporally_bounded:  bool    = False
    cascade_rule:           CascadeRule = CascadeRule.RESTRICT
    semantic_ref:           str | None = None

    @property
    def falkor_rel_type(self) -> str:
        return f"LINK_{self.api_name.upper()}"
```

---

### Interface

```python
# apps/api/models/interface.py
class InterfaceModel(EOMBaseModel):
    api_name:              str     = Field(pattern=r'^[A-Z][a-zA-Z0-9]{1,79}$')
    display_name:          str
    description:           str     = ""
    extends_interfaces:    list[str] = Field(default_factory=list)
    required_properties:   list[str] = Field(default_factory=list)  # PropertyModel or SharedProp ref
    optional_properties:   list[str] = Field(default_factory=list)
    required_link_types:   list[str] = Field(default_factory=list)
    semantic_ref:          str | None = None
    version:               str     = "1.0.0"
```

---

### Shared Property & Value Type

```python
# apps/api/models/shared_property.py
class SharedPropertyModel(EOMBaseModel):
    api_name:         str     = Field(pattern=r'^[a-z][a-z0-9_]{1,79}$')
    display_name:     str
    description:      str     = ""
    base_type:        BaseTypeEnum
    value_type_ref:   str | None = None
    semantic_ref:     str | None = None
    sensitivity_level:SensitivityLevel = SensitivityLevel.INTERNAL
    steward_id:       str | None = None
    version:          str     = "1.0.0"
    used_by:          list[str] = Field(default_factory=list)  # auto-populated

class ValueTypeConstraints(EOMBaseModel):
    pattern:              str | None   = None
    min_value:            float | None = None
    max_value:            float | None = None
    max_length:           int | None   = None
    allowed_values:       list[Any]    = Field(default_factory=list)
    cross_ref_object_type:str | None   = None  # value must be a valid ID of this type

class ValueTypeModel(EOMBaseModel):
    api_name:     str     = Field(pattern=r'^[A-Z][a-zA-Z0-9]{1,79}$')
    display_name: str
    description:  str     = ""
    base_type:    BaseTypeEnum
    constraints:  ValueTypeConstraints = Field(default_factory=ValueTypeConstraints)
    version:      str     = "1.0.0"
```

---

### Branch / PR / Version Control

```python
# apps/api/models/branch.py
class BranchStatus(str, Enum):
    PENDING   = "PENDING"
    ACTIVE    = "ACTIVE"
    IN_REVIEW = "IN_REVIEW"
    APPROVED  = "APPROVED"
    MERGED    = "MERGED"
    REJECTED  = "REJECTED"

class BranchInfo(EOMBaseModel):
    id:             UUID             = Field(default_factory=uuid4)
    space_id:       UUID
    branch_name:    str
    branch_slug:    str
    status:         BranchStatus     = BranchStatus.ACTIVE
    creator_id:     str
    created_at:     datetime         = Field(default_factory=datetime.utcnow)
    last_commit_sha:str | None       = None
    worktree_path:  str | None       = None
    sandbox_graph:  str | None       = None
    sandbox_es_prefix: str | None    = None

class ProposalInfo(EOMBaseModel):
    id:             UUID             = Field(default_factory=uuid4)
    space_id:       UUID
    branch_name:    str
    title:          str
    description:    str              = ""
    status:         BranchStatus     = BranchStatus.IN_REVIEW
    author_id:      str
    reviewer_ids:   list[str]        = Field(default_factory=list)
    approvals:      list[dict]       = Field(default_factory=list)
    change_class:   str | None       = None  # ADDITIVE | NON_BREAKING | BREAKING
    impact_score:   float | None     = None
    ci_status:      str | None       = None
    created_at:     datetime         = Field(default_factory=datetime.utcnow)
    updated_at:     datetime         = Field(default_factory=datetime.utcnow)

class SchemaDiff(EOMBaseModel):
    space_id:    str
    base:        str
    head:        str
    edits:       list[dict]           # [{operation, api_name, ...}]
    change_class:str | None = None    # filled by OPA after evaluation
```

---

### Action Invocation

```python
# apps/api/models/action.py
class ActionInvokeRequest(EOMBaseModel):
    space_id:    UUID
    object_type: str
    object_id:   str
    params:      dict      = Field(default_factory=dict)

class ActionStatus(str, Enum):
    SUCCESS = "SUCCESS"
    FAILED  = "FAILED"
    DENIED  = "DENIED"

class ActionResult(EOMBaseModel):
    event_id:       str
    space_id:       str
    action_type:    str
    object_id:      str
    object_type:    str
    actor_id:       str
    status:         ActionStatus
    deny_reason:    str | None    = None
    error_message:  str | None    = None
    timestamp:      datetime      = Field(default_factory=datetime.utcnow)
    duration_ms:    int | None    = None
    side_effects:   list[dict]    = Field(default_factory=list)

class ActionLogEntry(EOMBaseModel):
    event_id:     str
    action_type:  str
    object_id:    str
    object_type:  str
    actor_id:     str
    actor_org_id: str
    status:       ActionStatus
    deny_reason:  str | None    = None
    params:       dict
    before_state: dict | None   = None
    after_state:  dict | None   = None
    source_ip:    str | None    = None
    duration_ms:  int | None    = None
    timestamp:    datetime
```

---

### Health Score

```python
# apps/api/models/health.py
class OHSDimension(EOMBaseModel):
    name:       str
    weight:     float
    score:      float       # 0.0 – 100.0
    violations: list[str]   = Field(default_factory=list)

class OntologyHealthScore(EOMBaseModel):
    space_id:       str
    computed_at:    datetime
    overall_score:  float
    completeness:   OHSDimension
    dry_conformance:OHSDimension
    change_governance: OHSDimension
    freshness:      OHSDimension
    utilisation:    OHSDimension
    alerts:         list[dict]  = Field(default_factory=list)
```

---

## TypeScript — Frontend Interfaces

```typescript
// apps/studio/src/types/index.ts

export type SpaceVisibility = 'PRIVATE' | 'PUBLIC' | 'SHARED';
export type SpaceTier       = 'CORE' | 'DOMAIN' | 'EXPERIMENTAL';
export type ObjectTypeStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'RETIRED';
export type SensitivityLevel = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type BaseType = 'String' | 'Integer' | 'Long' | 'Double' | 'Boolean'
                     | 'Timestamp' | 'Date' | 'GeoPoint' | 'GeoShape' | 'Struct'
                     | 'TimeseriesRef' | 'MediaRef' | 'AttachmentRef';
export type LinkCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';
export type ActionStatus    = 'SUCCESS' | 'FAILED' | 'DENIED';
export type BranchStatus    = 'PENDING' | 'ACTIVE' | 'IN_REVIEW' | 'APPROVED' | 'MERGED' | 'REJECTED';
export type ChangeClass     = 'ADDITIVE' | 'NON_BREAKING' | 'BREAKING';

export interface Space {
  id:              string;
  name:            string;
  description:     string;
  visibility:      SpaceVisibility;
  owning_org_id:   string;
  member_org_ids:  string[];
  tier:            SpaceTier;
  created_at:      string;  // ISO string
}

export interface Property {
  api_name:             string;
  display_name:         string;
  description:          string;
  base_type:            BaseType;
  value_type_ref?:      string;
  is_required:          boolean;
  is_shared:            boolean;
  is_edit_only:         boolean;
  is_mandatory_control: boolean;
  is_indexed:           boolean;
  semantic_ref?:        string;
  sensitivity_override?:SensitivityLevel;
  derived_expression?:  string;
}

export interface ActionParameter {
  name:          string;
  type:          string;
  required:      boolean;
  default_value?: unknown;
  object_ref?:   string;
}

export interface EditDescriptor {
  type:               'SET_PROPERTY' | 'CREATE_LINK' | 'DELETE_LINK' | 'CREATE_OBJECT' | 'DELETE_OBJECT';
  property?:          string;
  link_type?:         string;
  value?:             unknown;
  value_from_param?:  string;
  target_id_from_param?: string;
}

export interface ActionType {
  api_name:            string;
  display_name:        string;
  description:         string;
  target_object_type:  string;
  parameters:          ActionParameter[];
  submission_criteria: unknown[];
  validation_rules:    unknown[];
  edits:               EditDescriptor[];
  side_effects:        unknown[];
  permissions:         { required_roles: string[] };
  undoable:            boolean;
}

export interface DatasourceMapping {
  dataset_id:        string;
  source_type:       'PARQUET' | 'DELTA' | 'JDBC' | 'KAFKA' | 'CSV';
  property_mappings: Record<string, string>;
  ingest_mode:       'BATCH' | 'STREAMING';
  batch_schedule?:   string;
  kafka_topic?:      string;
  mapping_confidence?: number;
  last_sync_at?:     string;
  sync_status?:      string;
}

export interface ObjectType {
  api_name:             string;
  display_name:         string;
  plural_display_name:  string;
  description:          string;
  domain:               string;
  status:               ObjectTypeStatus;
  tags:                 string[];
  semantic_iri?:        string;
  external_type_refs:   string[];
  primary_key:          string;
  interfaces:           string[];
  shared_property_refs: string[];
  properties:           Property[];
  action_types:         ActionType[];
  datasource?:          DatasourceMapping;
  steward_id?:          string;
  sensitivity_level:    SensitivityLevel;
  version:              string;
  enable_embeddings:    boolean;
  falkor_label:         string;
  es_alias:             string;
}

export interface LinkType {
  api_name:              string;
  display_name:          string;
  description:           string;
  source_object_type:    string;
  target_object_type:    string;
  cardinality:           LinkCardinality;
  inverse_api_name?:     string;
  link_properties:       Property[];
  is_temporally_bounded: boolean;
  cascade_rule:          'RESTRICT' | 'CASCADE' | 'SET_NULL' | 'ARCHIVE';
  semantic_ref?:         string;
  falkor_rel_type:       string;
}

export interface Interface {
  api_name:            string;
  display_name:        string;
  description:         string;
  extends_interfaces:  string[];
  required_properties: string[];
  optional_properties: string[];
  required_link_types: string[];
  semantic_ref?:       string;
  version:             string;
}

export interface SharedProperty {
  api_name:          string;
  display_name:      string;
  description:       string;
  base_type:         BaseType;
  value_type_ref?:   string;
  semantic_ref?:     string;
  sensitivity_level: SensitivityLevel;
  steward_id?:       string;
  version:           string;
  used_by:           string[];
}

export interface BranchInfo {
  id:              string;
  space_id:        string;
  branch_name:     string;
  branch_slug:     string;
  status:          BranchStatus;
  creator_id:      string;
  created_at:      string;
  last_commit_sha?: string;
}

export interface ProposalInfo {
  id:           string;
  space_id:     string;
  branch_name:  string;
  title:        string;
  description:  string;
  status:       BranchStatus;
  author_id:    string;
  reviewer_ids: string[];
  approvals:    unknown[];
  change_class?: ChangeClass;
  impact_score?: number;
  ci_status?:   string;
  created_at:   string;
  updated_at:   string;
}

export interface ActionResult {
  event_id:     string;
  action_type:  string;
  object_id:    string;
  object_type:  string;
  actor_id:     string;
  status:       ActionStatus;
  deny_reason?: string;
  error_message?: string;
  timestamp:    string;
  duration_ms?: number;
}

export interface SearchResult {
  id:          string;
  score:       number;
  final_score: number;
  source:      Record<string, unknown>;
}

export interface OHSDimension {
  name:       string;
  weight:     number;
  score:      number;
  violations: string[];
}

export interface OntologyHealthScore {
  space_id:         string;
  computed_at:      string;
  overall_score:    number;
  completeness:     OHSDimension;
  dry_conformance:  OHSDimension;
  change_governance:OHSDimension;
  freshness:        OHSDimension;
  utilisation:      OHSDimension;
  alerts:           unknown[];
}

// ─── React Flow types (Authoring Canvas) ────────────────────────────────────

export interface OntologyNode {
  id:       string;   // object type api_name
  type:     'objectType' | 'interface' | 'superset';
  data:     ObjectType | Interface;
  position: { x: number; y: number };
}

export interface OntologyEdge {
  id:     string;
  source: string;
  target: string;
  type:   'linkType';
  data:   LinkType;
  label:  string;
}

// ─── AntV G6 types (Exploration Graph) ──────────────────────────────────────
// G6 NodeData and EdgeData are the raw data shapes passed to the G6 Graph instance.
// G6 manages rendering internally — do not mix these with React Flow node/edge shapes.

export interface G6NodeData {
  id:          string;              // object type api_name
  label:       string;              // display_name
  objectType:  ObjectType;          // full definition (for panel on click)
  // G6 combo (cluster) support
  comboId?:    string;              // domain name — used for combo/cluster grouping
  // Visual state flags (set by G6 state machine, not manually)
  status:      ObjectTypeStatus;
  sensitivity: SensitivityLevel;
  hasDataSource: boolean;
  isBlastRadius?: boolean;          // true when highlighted in blast-radius mode
  isDependent?:   boolean;          // true when in dependency chain
  isFocused?:     boolean;          // true when this node is the selected pivot
}

export interface G6EdgeData {
  id:       string;                 // source__linkApiName__target
  source:   string;                 // source object type api_name
  target:   string;                 // target object type api_name
  label:    string;                 // link type display_name
  linkType: LinkType;               // full definition
  isTemporal:    boolean;
  cardinality:   LinkCardinality;
  isHighlighted?:boolean;           // set true in blast-radius / path-finder mode
}

export interface G6GraphData {
  nodes:  G6NodeData[];
  edges:  G6EdgeData[];
  combos?: G6ComboData[];           // optional domain clusters
}

export interface G6ComboData {
  id:    string;   // domain name
  label: string;
}

export type G6LayoutType =
  | 'force'        // default — good for general exploration
  | 'dagre'        // hierarchical — best for dependency trees
  | 'radial'       // radial from a pivot node — blast radius view
  | 'circular'     // circular — good for interface relationships
  | 'grid';        // grid — compact overview of all types

// ─── 3d-force-graph types (Galaxy View — Phase 3) ───────────────────────────

export interface GalaxyNode {
  id:     string;
  name:   string;   // display_name
  type:   string;   // object type api_name
  spaceId:string;
  domain: string;
  status: ObjectTypeStatus;
  color?: string;   // assigned by domain colour scheme
}

export interface GalaxyLink {
  source: string;
  target: string;
  label:  string;
}
```

---

## Database Schema (PostgreSQL — EOM Control Plane)

EOM uses a small PostgreSQL database for control-plane state (spaces, branches,
proposals, users, organisations). FalkorDB and Elasticsearch store domain data.

```sql
-- Control plane tables

CREATE TABLE spaces (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    visibility      TEXT        NOT NULL CHECK (visibility IN ('PRIVATE','PUBLIC','SHARED')),
    owning_org_id   UUID        NOT NULL,
    tier            TEXT        NOT NULL DEFAULT 'DOMAIN',
    git_repo_path   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE space_members (
    space_id   UUID NOT NULL REFERENCES spaces(id),
    org_id     UUID NOT NULL,
    PRIMARY KEY (space_id, org_id)
);

CREATE TABLE organisations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    org_id       UUID        NOT NULL REFERENCES organisations(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_roles (
    user_id    UUID NOT NULL REFERENCES users(id),
    space_id   UUID NOT NULL REFERENCES spaces(id),
    role       TEXT NOT NULL CHECK (role IN ('VIEWER','EDITOR','STEWARD','PUBLISHER','ADMIN')),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, space_id, role)
);

CREATE TABLE branches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID        NOT NULL REFERENCES spaces(id),
    branch_name     TEXT        NOT NULL,
    branch_slug     TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'ACTIVE',
    creator_id      UUID        NOT NULL REFERENCES users(id),
    last_commit_sha TEXT,
    worktree_path   TEXT,
    sandbox_graph   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (space_id, branch_name)
);

CREATE TABLE proposals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID        NOT NULL REFERENCES spaces(id),
    branch_name     TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    status          TEXT        NOT NULL DEFAULT 'IN_REVIEW',
    author_id       UUID        NOT NULL REFERENCES users(id),
    change_class    TEXT,
    impact_score    FLOAT,
    ci_status       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE proposal_approvals (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id  UUID        NOT NULL REFERENCES proposals(id),
    approver_id  UUID        NOT NULL REFERENCES users(id),
    role         TEXT        NOT NULL,
    approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    comment      TEXT
);

CREATE INDEX idx_branches_space   ON branches(space_id);
CREATE INDEX idx_proposals_space  ON proposals(space_id);
CREATE INDEX idx_proposals_status ON proposals(status);
```
