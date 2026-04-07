# User Journey Specification

> Authoritative step-by-step reference for implementing the EOM user journey.
> Every step includes: UI component, route, API endpoint, FalkorDB operation,
> OPA check, state management, animation, and error handling.

---

## Full Flow (Strict Order)

```
1.  Create Space            (POST /api/v1/spaces)
2.  Define Space Permissions
3.  Create Folder(s)        (POST /api/v1/spaces/:id/folders)
4.  Define Folder Permissions
5.  Create Ontology         (POST /api/v1/folders/:id/ontologies)
6.  Define Object Types     (POST /api/v1/ontologies/:id/object-types)
7.  Add Properties          (POST /api/v1/object-types/:id/properties)
8.  Define Relationships    (POST /api/v1/ontologies/:id/relationships)
9.  (Optional) Attach Dataset
10. (Optional) Enable SKOS
11. Define Fine-Grained Permissions
12. Publish                 (POST /api/v1/ontologies/:id/publish)
13. Export OWL / SKOS       (GET  /api/v1/ontologies/:id/export/owl|skos)
14. Consume
15. Iterate
```

---

## Step 1 — Create Space

### UI
- **Page:** `SpacesPage` (`/spaces`)
- **Trigger:** "New Space" button in top-right → opens `CreateSpaceModal`
- **Component:** `src/components/spaces/CreateSpaceModal.tsx`

### Form Fields
| Field | Type | Validation |
|---|---|---|
| `name` | text input | required, 2–80 chars |
| `description` | textarea | optional, max 500 chars |
| `visibility` | radio group | `PUBLIC` / `PRIVATE` / `SHARED` |

### Animation
- Modal entrance: `scale 0.95→1, opacity 0→1, duration 180ms, ease easeOut`
- Backdrop: `opacity 0→0.5`

### API Call
```
POST /api/v1/spaces
Content-Type: application/json

{
  "name": "Finance Space",
  "description": "All finance domain ontologies",
  "visibility": "PRIVATE"
}
```

### Response
```json
{
  "id": "01J9ABC...",
  "name": "Finance Space",
  "description": "All finance domain ontologies",
  "visibility": "PRIVATE",
  "owner_id": "user_xyz",
  "created_at": "2026-04-07T10:00:00Z",
  "updated_at": "2026-04-07T10:00:00Z"
}
```

### FalkorDB Operation (eom_meta graph)
```cypher
CREATE (:OntMeta_Space {
  id: $id,
  name: $name,
  description: $description,
  visibility: $visibility,
  owner_id: $owner_id,
  created_at: $ts,
  updated_at: $ts
})
```

### OPA Check
```python
# Input
{
  "input": {
    "user": { "id": "user_xyz", "roles": ["space:creator"] },
    "action": "CREATE",
    "resource": { "type": "SPACE", "id": "" }
  }
}
# Policy: eom.access — allow if user is authenticated
```

### State Management
```typescript
// TanStack Query mutation
const mutation = useMutation({
  mutationFn: spacesApi.create,
  onSuccess: (space) => {
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
    useAppStore.getState().setCurrentSpaceId(space.id);
    toast.success(`Space "${space.name}" created`);
    navigate(`/spaces/${space.id}`);
  },
});
// Zustand
useAppStore.setState({ currentSpaceId: space.id });
```

### Error States
| HTTP | Toast message |
|---|---|
| 403 | "You don't have permission to create spaces" |
| 422 | Field-level validation errors inline |
| 500 | "Server error — please try again" |

---

## Step 2 — Define Space Permissions

### UI
- **Page:** `SpacePage` → "Permissions" tab
- **Component:** `src/components/permissions/PermissionsPanel.tsx`

### Form Fields
| Field | Type | Options |
|---|---|---|
| `subject_type` | select | USER / GROUP / ROLE |
| `subject_id` | text | user ID, group ID, or role name |
| `actions` | checkboxes | READ / WRITE / EDIT / DELETE |
| `policy_type` | radio | RBAC / ABAC |
| `abac_condition` | text (if ABAC) | e.g. `user.department == "Finance"` |

### API Call
```
POST /api/v1/permissions
{
  "resource_type": "SPACE",
  "resource_id": "01J9ABC...",
  "subject_type": "ROLE",
  "subject_id": "space:editor",
  "actions": ["READ", "WRITE", "EDIT"],
  "policy_type": "RBAC",
  "abac_condition": null
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_Permission {
  id: $id,
  resource_type: "SPACE",
  resource_id: $space_id,
  subject_type: $subject_type,
  subject_id: $subject_id,
  actions: $actions,
  policy_type: $policy_type,
  abac_condition: $abac_condition,
  created_at: $ts
})
MATCH (perm:OntMeta_Permission {id: $id}), (s:OntMeta_Space {id: $space_id})
CREATE (perm)-[:APPLIES_TO]->(s)
```

### Cascade Behavior
Owner automatically gets all actions on creation (bootstrapped in SpaceService).
All child Folders, Ontologies, ObjectTypes, and Properties inherit this permission
unless explicitly overridden. See `.claude/skills/PERMISSIONS_SKILL.md`.

---

## Step 3 — Create Folder

### UI
- **Page:** `SpacePage` (`/spaces/:spaceId`)
- **Trigger:** "New Folder" button in sidebar → `CreateFolderModal`
- **Component:** `src/components/folders/CreateFolderModal.tsx`

### Form Fields
| Field | Type | Validation |
|---|---|---|
| `name` | text input | required, 2–80 chars |
| `parent_folder_id` | select (optional) | existing folders in space |

### API Call
```
POST /api/v1/spaces/:spaceId/folders
{
  "name": "Customer Domain",
  "parent_folder_id": null
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_Folder {
  id: $id,
  space_id: $space_id,
  parent_folder_id: $parent_folder_id,
  name: $name,
  created_at: $ts
})
MATCH (f:OntMeta_Folder {id: $id}), (s:OntMeta_Space {id: $space_id})
CREATE (f)-[:BELONGS_TO]->(s)
// If nested:
MATCH (f:OntMeta_Folder {id: $id}), (p:OntMeta_Folder {id: $parent_folder_id})
CREATE (f)-[:BELONGS_TO]->(p)
```

### State Management
```typescript
// TanStack Query keys
['folders', spaceId]          // list
['folder', folderId]          // single
```

### UI Behavior
- FolderTree re-renders with GSAP height animation on new folder addition
- Nested folders indented 16px per level
- Max depth: 5 levels

---

## Step 4 — Define Folder Permissions

Same as Step 2 with `resource_type: "FOLDER"`. Inherits Space permissions by default.

---

## Step 5 — Create Ontology

### UI
- **Page:** `SpacePage` — right panel shows ontologies for selected folder
- **Trigger:** "New Ontology" button → `CreateOntologyModal`
- **Component:** `src/components/ontologies/CreateOntologyModal.tsx`

### Form Fields
| Field | Type | Validation |
|---|---|---|
| `name` | text input | required, 2–80 chars |
| `description` | textarea | optional |

### API Call
```
POST /api/v1/folders/:folderId/ontologies
{
  "name": "Customer Ontology",
  "description": "Core customer domain model"
}
```

### Response
```json
{
  "id": "01J9DEF...",
  "folder_id": "01J9FLD...",
  "space_id": "01J9ABC...",
  "name": "Customer Ontology",
  "description": "Core customer domain model",
  "version": "0.1.0",
  "status": "DRAFT",
  "created_at": "2026-04-07T10:05:00Z",
  "updated_at": "2026-04-07T10:05:00Z"
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_Ontology {
  id: $id,
  folder_id: $folder_id,
  space_id: $space_id,
  name: $name,
  description: $description,
  version: "0.1.0",
  status: "DRAFT",
  created_at: $ts,
  updated_at: $ts
})
MATCH (o:OntMeta_Ontology {id: $id}), (f:OntMeta_Folder {id: $folder_id})
CREATE (o)-[:BELONGS_TO]->(f)
```

### Navigation
On success → navigate to `/spaces/:spaceId/ontology/:ontologyId`

---

## Step 6 — Define Object Types

### UI
- **Page:** `OntologyPage` (`/spaces/:spaceId/ontology/:ontologyId`)
- **Canvas:** React Flow (`OntologyCanvas`)
- **Trigger:** "Add Object" toolbar button → inline node creation OR right-click context menu
- **Component:** `src/components/canvas/ObjectTypeNode.tsx`

### Form (right panel)
| Field | Type | Validation |
|---|---|---|
| `display_name` | text | required |
| `api_name` | text | required, `lower_snake_case`, auto-derived from display_name |
| `description` | textarea | optional |
| `primary_key` | text | default `id` |
| `is_skos_concept` | toggle | default false |
| `is_skos_concept_scheme` | toggle | default false |

### API Call
```
POST /api/v1/ontologies/:ontologyId/object-types
{
  "display_name": "Customer",
  "api_name": "customer",
  "description": "A customer entity",
  "primary_key": "customer_id",
  "is_skos_concept": false,
  "is_skos_concept_scheme": false
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_ObjectType {
  id: $id,
  ontology_id: $ontology_id,
  api_name: $api_name,
  display_name: $display_name,
  description: $description,
  primary_key: $primary_key,
  is_skos_concept: $is_skos_concept,
  is_skos_concept_scheme: $is_skos_concept_scheme,
  created_at: $ts
})
MATCH (ot:OntMeta_ObjectType {id: $id}), (o:OntMeta_Ontology {id: $ontology_id})
CREATE (ot)-[:BELONGS_TO]->(o)
```

### Canvas Node Appearance
```
┌─────────────────────────┐
│ Customer          [Box] │  ← display_name + Lucide icon
│ api: customer           │  ← api_name badge (gray)
├─────────────────────────┤
│ ● customer_id  [PK]     │  ← primary key (indigo highlight)
│   created_at            │
│   + 3 more...           │
└─────────────────────────┘
```
- SKOS concept: amber `skos:Concept` badge top-right
- Selected: indigo ring `ring-2 ring-indigo-500`

### OPA Check
```python
check_access(user_id, "WRITE", "ONTOLOGY", ontology_id)
check_naming(api_name)  # OPA naming.rego validates lower_snake_case
```

### State Management
```typescript
// After creation, add node to canvas store
useCanvasStore.getState().addNode({
  id: objectType.id,
  type: 'objectType',
  position: { x: Math.random() * 400, y: Math.random() * 300 },
  data: objectType,
});
```

---

## Step 7 — Add Properties

### UI
- **Trigger:** Click ObjectTypeNode → right panel expands → "Add Property" button
- **Panel component:** `src/components/canvas/ObjectTypeNode.tsx` (inline form)

### Form Fields
| Field | Type | Validation |
|---|---|---|
| `display_name` | text | required |
| `api_name` | text | `camelCase`, auto-derived |
| `data_type` | select | string/integer/float/boolean/date/datetime/uri |
| `required` | toggle | default false |
| `skos_mapping` | text | optional, e.g. `skos:prefLabel` |

### API Call
```
POST /api/v1/object-types/:objectTypeId/properties
{
  "display_name": "Full Name",
  "api_name": "fullName",
  "data_type": "string",
  "required": true,
  "skos_mapping": null
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_Property {
  id: $id,
  object_type_id: $object_type_id,
  api_name: $api_name,
  display_name: $display_name,
  data_type: $data_type,
  required: $required,
  skos_mapping: $skos_mapping,
  created_at: $ts
})
MATCH (p:OntMeta_Property {id: $id}), (ot:OntMeta_ObjectType {id: $object_type_id})
CREATE (p)-[:BELONGS_TO]->(ot)
```

### Canvas Behavior
Node body re-renders immediately with new property row (Zustand update → React re-render).

---

## Step 8 — Define Relationships

### UI
- **Trigger:** Drag from source node handle → drop on target node → `CreateRelationshipModal`
- **React Flow event:** `onConnect` callback
- **Component:** `src/components/canvas/RelationshipEdge.tsx`

### Form Fields (modal)
| Field | Type | Validation |
|---|---|---|
| `api_name` | text | `lower_snake_case` verb phrase, e.g. `placed_by` |
| `cardinality` | select | ONE_TO_ONE / ONE_TO_MANY / MANY_TO_MANY |

Source and target are pre-filled from the drag action.

### API Call
```
POST /api/v1/ontologies/:ontologyId/relationships
{
  "api_name": "placed_by",
  "source_object_type_id": "01J9OBJ1...",
  "target_object_type_id": "01J9OBJ2...",
  "cardinality": "MANY_TO_MANY"
}
```

### FalkorDB Operation
```cypher
CREATE (:OntMeta_Relationship {
  id: $id,
  ontology_id: $ontology_id,
  api_name: $api_name,
  cardinality: $cardinality,
  created_at: $ts
})
MATCH (r:OntMeta_Relationship {id: $id}),
      (src:OntMeta_ObjectType {id: $source_object_type_id}),
      (tgt:OntMeta_ObjectType {id: $target_object_type_id})
CREATE (r)-[:SOURCE]->(src),
       (r)-[:TARGET]->(tgt)
```

### Edge Appearance
```
[Customer] ──── placed_by (MANY_TO_MANY) ────> [Order]
```
- ONE_TO_ONE: solid thin line
- ONE_TO_MANY: solid line with arrowhead
- MANY_TO_MANY: dashed line with double arrowhead

### OPA Check
```python
check_naming(api_name)  # naming.rego: lower_snake_case + verb phrase
check_access(user_id, "WRITE", "ONTOLOGY", ontology_id)
```

---

## Step 9 — Attach Dataset (Optional)

### UI
- **Trigger:** "Attach Dataset" button in OntologyPage toolbar
- **Component:** `src/components/ontologies/DatasetMappingModal.tsx`
- Ontology remains fully functional without this step

### Behavior
1. User selects a dataset source (file upload, database connection, API)
2. Columns are mapped to ObjectType properties
3. Mapping stored in FalkorDB: `(Dataset)-[:MAPS_TO]->(OntMeta_Property)`

---

## Step 10 — Enable SKOS (Optional)

### UI
- **Trigger:** Toggle on ObjectTypeNode right panel: "Mark as SKOS Concept"

### Fields
| Toggle | Sets |
|---|---|
| SKOS Concept | `is_skos_concept: true` |
| SKOS Concept Scheme | `is_skos_concept_scheme: true` |

### Property SKOS Mappings
| Property api_name | skos_mapping |
|---|---|
| `prefLabel` | `skos:prefLabel` |
| `altLabel` | `skos:altLabel` |
| `broader` | `skos:broader` |
| `narrower` | `skos:narrower` |
| `definition` | `skos:definition` |

### Relationship SKOS Mappings
| api_name | Semantic |
|---|---|
| `broader` | `skos:broader` |
| `narrower` | `skos:narrower` |
| `related` | `skos:related` |

---

## Step 11 — Fine-Grained Permissions

Same as Steps 2 and 4, but applied at any level:

| Level | resource_type |
|---|---|
| Space | `SPACE` |
| Folder | `FOLDER` |
| Ontology | `ONTOLOGY` |
| Object Type | `OBJECT_TYPE` |
| Property | `PROPERTY` |
| Relationship | `RELATIONSHIP` |

Permission cascade: child inherits parent, direct override wins.
See `.claude/skills/PERMISSIONS_SKILL.md` for full details.

---

## Step 12 — Publish Ontology

### UI
- **Trigger:** "Publish" button in OntologyPage toolbar (indigo, Upload icon)
- **Confirmation modal:** shows version bump preview (`0.1.0 → 0.2.0`)

### API Call
```
POST /api/v1/ontologies/:ontologyId/publish
```

### Backend Pipeline
1. OPA: `check_schema_change(change_type="PUBLISH", ontology_id=...)`
2. Load all ObjectTypes + Properties + Relationships from `eom_meta`
3. `SchemaService.compile()` — validate naming, build FalkorDB DDL + ES mappings
4. Create FalkorDB label indexes on `eom_{spaceId}_data` graph
5. Create/update ES index `eom_{spaceId}_{apiName}_v{N}` with alias
6. Update: `SET o.status = "PUBLISHED", o.version = $new_version, o.updated_at = $ts`

### FalkorDB Update
```cypher
MATCH (o:OntMeta_Ontology {id: $ontology_id})
SET o.status = "PUBLISHED",
    o.version = $new_version,
    o.updated_at = $ts
```

### UI Response
- Status badge changes: `DRAFT` (gray) → `PUBLISHED` (green)
- Version badge updates
- Toast: "Ontology published as v0.2.0"

---

## Step 13 — Export

### UI
- **Triggers:** "Export" dropdown in toolbar → "Export as OWL" / "Export as SKOS"
- Browser file download (Content-Disposition: attachment)

### OWL Export
```
GET /api/v1/ontologies/:ontologyId/export/owl
Accept: text/turtle
```

**Output (Turtle):**
```turtle
@prefix : <https://eom.example.com/ontologies/customer#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

:Customer rdf:type owl:Class ;
    rdfs:label "Customer" .

:fullName rdf:type owl:DatatypeProperty ;
    rdfs:domain :Customer ;
    rdfs:range xsd:string ;
    rdfs:label "Full Name" .

:placed_by rdf:type owl:ObjectProperty ;
    rdfs:domain :Order ;
    rdfs:range :Customer ;
    rdfs:label "placed by" .
```

### SKOS Export
```
GET /api/v1/ontologies/:ontologyId/export/skos
Accept: text/turtle
```

**Output (Turtle):**
```turtle
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix : <https://eom.example.com/ontologies/customer#> .

:RiskLevel rdf:type skos:ConceptScheme ;
    skos:prefLabel "Risk Level" .

:HighRisk rdf:type skos:Concept ;
    skos:inScheme :RiskLevel ;
    skos:prefLabel "High Risk" ;
    skos:broader :RiskLevel .
```

---

## Step 14 — Consume

### Ways to consume a published ontology:

1. **Browse** — `SpacePage` lists ontologies with status/version badges
2. **Canvas view** — `OntologyPage` React Flow canvas (read-only for non-editors)
3. **Explore view** — `ExplorePage` AntV G6 graph traversal (`/explore` route)
4. **REST API** — `GET /api/v1/ontologies/:id/object-types` etc.
5. **Search** — Elasticsearch full-text + vector search via `GET /api/v1/search`

---

## Step 15 — Iterate

### Schema Changes
- Non-breaking (add property, add object type): allowed without approval
- Breaking (rename/delete property, change data type): requires OPA approval
- See `.claude/skills/OPA_SKILL.md` `check_schema_change` for classification rules

### Versioning
| Change class | Version bump |
|---|---|
| Breaking | Major: `1.0.0 → 2.0.0` |
| Non-breaking structural | Minor: `0.1.0 → 0.2.0` |
| Metadata only | Patch: `0.1.0 → 0.1.1` |

---

## Data Model Reference

```python
# All Pydantic v2 models (apps/api/models/)

class SpaceVisibility(str, Enum):
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"
    SHARED = "SHARED"

class Space(BaseModel):
    id: str
    name: str
    description: str | None = None
    visibility: SpaceVisibility
    owner_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class Folder(BaseModel):
    id: str
    space_id: str
    parent_folder_id: str | None = None
    name: str
    created_at: datetime

class OntologyStatus(str, Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    DEPRECATED = "DEPRECATED"

class Ontology(BaseModel):
    id: str
    folder_id: str
    space_id: str
    name: str
    description: str | None = None
    version: str
    status: OntologyStatus
    created_at: datetime
    updated_at: datetime

class ObjectType(BaseModel):
    id: str
    ontology_id: str
    api_name: str          # lower_snake_case
    display_name: str
    description: str | None = None
    primary_key: str
    is_skos_concept: bool
    is_skos_concept_scheme: bool
    created_at: datetime

class PropertyDataType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    URI = "uri"

class Property(BaseModel):
    id: str
    object_type_id: str
    api_name: str          # camelCase
    display_name: str
    data_type: PropertyDataType
    required: bool
    skos_mapping: str | None = None
    created_at: datetime

class Cardinality(str, Enum):
    ONE_TO_ONE = "ONE_TO_ONE"
    ONE_TO_MANY = "ONE_TO_MANY"
    MANY_TO_MANY = "MANY_TO_MANY"

class Relationship(BaseModel):
    id: str
    ontology_id: str
    api_name: str          # lower_snake_case verb phrase
    source_object_type_id: str
    target_object_type_id: str
    cardinality: Cardinality
    created_at: datetime

class Permission(BaseModel):
    id: str
    resource_type: Literal["SPACE","FOLDER","ONTOLOGY","OBJECT_TYPE","PROPERTY","RELATIONSHIP"]
    resource_id: str
    subject_type: Literal["USER","GROUP","ROLE"]
    subject_id: str
    actions: list[Literal["READ","WRITE","EDIT","DELETE"]]
    policy_type: Literal["RBAC","ABAC"]
    abac_condition: str | None = None
    created_at: datetime
```

---

## Route Map

| Route | Page | Renderer |
|---|---|---|
| `/` | `HomePage` | — |
| `/spaces` | `SpacesPage` | — |
| `/spaces/:spaceId` | `SpacePage` | — |
| `/spaces/:spaceId/ontology/:ontologyId` | `OntologyPage` | React Flow |
| `/spaces/:spaceId/ontology/:ontologyId/explore` | `ExplorePage` | AntV G6 (lazy) |

---

## TanStack Query Key Conventions

```typescript
['spaces']                                    // all spaces
['spaces', spaceId]                           // single space
['folders', spaceId]                          // folders in space
['folder', folderId]                          // single folder
['ontologies', folderId]                      // ontologies in folder
['ontology', ontologyId]                      // single ontology
['object-types', ontologyId]                  // object types in ontology
['properties', objectTypeId]                  // properties of object type
['relationships', ontologyId]                 // relationships in ontology
['permissions', resourceType, resourceId]     // permissions on resource
```

---

## OPA Check Summary

| Step | OPA policy | Input action |
|---|---|---|
| Create space | `eom.access` | `CREATE` on `SPACE` |
| Create folder | `eom.access` | `CREATE` on `FOLDER` |
| Create ontology | `eom.access` | `CREATE` on `ONTOLOGY` |
| Create object type | `eom.access` + `eom.naming` | `WRITE` on `ONTOLOGY` |
| Create property | `eom.access` + `eom.naming` | `WRITE` on `OBJECT_TYPE` |
| Create relationship | `eom.access` + `eom.naming` | `WRITE` on `ONTOLOGY` |
| Publish ontology | `eom.schema` | `PUBLISH` schema change |
| Delete any resource | `eom.access` | `DELETE` on resource type |
| Export | `eom.access` | `READ` on `ONTOLOGY` |
