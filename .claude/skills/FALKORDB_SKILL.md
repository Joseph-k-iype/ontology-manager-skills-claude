# FalkorDB Skill

> Read this before writing any FalkorDB code. FalkorDB is the graph engine
> for EOM. It stores ontology instances (data graph) and the schema itself
> (meta-graph). It runs as a Redis module — all commands use the Redis
> protocol.

---

## Connection

```python
# apps/api/dependencies.py
from falkordb import FalkorDB
import os

_client: FalkorDB | None = None

def get_falkordb_client() -> FalkorDB:
    global _client
    if _client is None:
        _client = FalkorDB(
            host=os.environ["FALKORDB_HOST"],
            port=int(os.environ["FALKORDB_PORT"]),
            password=os.environ.get("FALKORDB_PASSWORD") or None,
        )
    return _client

def get_data_graph(client: FalkorDB, space_id: str, branch: str | None = None) -> Graph:
    name = f"eom_{space_id}_data"
    if branch:
        name = f"eom_{space_id}_{branch}_data"  # sandbox graph
    return client.select_graph(name)

def get_meta_graph(client: FalkorDB) -> Graph:
    return client.select_graph("eom_meta")
```

**Critical:** FalkorDB's Python client is synchronous. Always wrap in
`asyncio.to_thread()` inside async FastAPI handlers:

```python
import asyncio

async def query_objects(graph, cypher: str, params: dict):
    return await asyncio.to_thread(graph.query, cypher, params)
```

---

## Graph Naming Conventions

| Graph | Name pattern | Purpose |
|---|---|---|
| Data (production) | `eom_{space_id}_data` | All object and link instances |
| Data (sandbox) | `eom_{space_id}_{branch_slug}_data` | Branch-isolated dev/test |
| Meta | `eom_meta` | Schema as a graph (shared, one instance) |

`branch_slug` = branch name with `/` replaced by `_`, max 40 chars.

---

## Node Labels

```
Object type instances:   :ObjType_{snake_case_api_name}
                         e.g.  :ObjType_order
                               :ObjType_customer
                               :ObjType_product_category

Meta-graph nodes:        :OntMeta_ObjectType
                         :OntMeta_LinkType
                         :OntMeta_Property
                         :OntMeta_SharedProperty
                         :OntMeta_Interface
                         :OntMeta_ActionType
                         :OntMeta_ValueType
                         :OntMeta_Space
                         :OntMeta_OntologyVersion
```

---

## Relationship Types

```
Link type instances:     :LINK_{UPPER_SNAKE_CASE_api_name}
                         e.g.  :LINK_PLACED_BY
                               :LINK_ASSIGNED_TO
                               :LINK_IS_PART_OF

Meta-graph edges:        :IMPLEMENTS        (ObjectType → Interface)
                         :HAS_PROPERTY      (ObjectType → Property)
                         :USES_SHARED_PROPERTY  (ObjectType → SharedProperty)
                         :HAS_LINK_TYPE     (ObjectType → LinkType)
                         :HAS_ACTION_TYPE   (ObjectType → ActionType)
                         :EDITS             (ActionType → Property)
                         :CREATES_LINK      (ActionType → LinkType)
                         :EXTENDS           (Interface → Interface)
                         :BELONGS_TO_SPACE  (any meta node → Space)
```

---

## System Properties on Every Object Node

```cypher
// Every node carries these system properties (set by Action Service, never by users)
{
  _eom_id:          String,   // primary key
  _eom_type:        String,   // object type api_name
  _eom_space_id:    String,   // space UUID
  _eom_version:     String,   // schema version at creation
  _eom_sensitivity: String,   // PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  _eom_created_at:  Integer,  // epoch ms
  _eom_updated_at:  Integer,  // epoch ms
  _last_action:     String,   // api_name of last action
  _last_actor:      String,   // user id
  _last_action_at:  Integer   // epoch ms
}
```

---

## Schema DDL — Creating Node Labels and Indices

```cypher
-- Create a new object type (run once at publish time)
-- FalkorDB creates the label implicitly on first node creation
-- Create primary key index:
CREATE INDEX FOR (n:ObjType_order) ON (n._eom_id)

-- Create status index (if object type has a status property):
CREATE INDEX FOR (n:ObjType_order) ON (n.status)

-- Create a compound index on a user property:
CREATE INDEX FOR (n:ObjType_order) ON (n.createdAt)

-- Create a full-text index on meta-graph:
CREATE FULLTEXT INDEX FOR (n:OntMeta_ObjectType) ON EACH [n.api_name, n.display_name, n.description]

-- Create a vector index for semantic similarity:
CREATE VECTOR INDEX FOR (n:ObjType_order) ON (n._embedding)
OPTIONS {dimension: 1536, similarityFunction: 'cosine'}

-- Create a relationship index for temporal links:
CREATE INDEX FOR ()-[r:LINK_PLACED_BY]->() ON (r.valid_from)
```

---

## CRUD Patterns

### Create Object

```cypher
// Executed atomically by Action Service
CREATE (n:ObjType_order {
  _eom_id:          $id,
  _eom_type:        'order',
  _eom_space_id:    $spaceId,
  _eom_version:     $schemaVersion,
  _eom_sensitivity: 'INTERNAL',
  _eom_created_at:  timestamp(),
  _eom_updated_at:  timestamp(),
  _last_action:     'create_order',
  _last_actor:      $actorId,
  _last_action_at:  timestamp(),
  status:           'DRAFT',
  orderDate:        $orderDate,
  totalAmount:      $totalAmount,
  currency:         $currency
})
RETURN n._eom_id AS id
```

### Read Object by ID

```cypher
MATCH (n:ObjType_order {_eom_id: $id, _eom_space_id: $spaceId})
RETURN n
```

### Update Properties (Action Type execution)

```cypher
MATCH (n:ObjType_order {_eom_id: $id, _eom_space_id: $spaceId})
SET n.status        = $newStatus,
    n.submittedAt   = $submittedAt,
    n._last_action  = 'submit_order',
    n._last_actor   = $actorId,
    n._last_action_at = timestamp(),
    n._eom_updated_at = timestamp()
RETURN n._eom_id AS id, n.status AS status
```

### Soft Delete (mark as DELETED, preserve node)

```cypher
MATCH (n:ObjType_order {_eom_id: $id, _eom_space_id: $spaceId})
SET n._eom_deleted_at = timestamp(),
    n._eom_deleted_by = $actorId,
    n.status          = 'DELETED',
    n._last_action    = 'delete_order',
    n._last_actor     = $actorId,
    n._last_action_at = timestamp()
RETURN n._eom_id AS id
```

---

## Link Operations

### Create Link

```cypher
MATCH (src:ObjType_order   {_eom_id: $orderId,    _eom_space_id: $spaceId})
MATCH (tgt:ObjType_customer {_eom_id: $customerId, _eom_space_id: $spaceId})
CREATE (src)-[:LINK_PLACED_BY {
  _link_type:  'placed_by',
  _created_by: $actorId,
  _created_at: timestamp(),
  _action_ref: 'submit_order'
}]->(tgt)
RETURN id(src) AS src_id, id(tgt) AS tgt_id
```

### Create Temporally Bounded Link

```cypher
MATCH (src:ObjType_employee {_eom_id: $employeeId, _eom_space_id: $spaceId})
MATCH (tgt:ObjType_department {_eom_id: $deptId,   _eom_space_id: $spaceId})
CREATE (src)-[:LINK_WORKS_IN {
  _link_type:  'works_in',
  _created_by: $actorId,
  _created_at: timestamp(),
  valid_from:  $startDate,
  valid_to:    null,
  role:        $role
}]->(tgt)
```

### Close a Temporally Bounded Link (set valid_to)

```cypher
MATCH (src:ObjType_employee {_eom_id: $employeeId})-[r:LINK_WORKS_IN {valid_to: null}]->(tgt)
WHERE tgt._eom_id = $deptId
SET r.valid_to = $endDate
RETURN r
```

### Delete Link Instance

```cypher
MATCH (src:ObjType_order {_eom_id: $orderId})-[r:LINK_PLACED_BY]->(tgt:ObjType_customer {_eom_id: $customerId})
DELETE r
```

---

## Graph Traversal Patterns

### Follow a Single Link

```cypher
MATCH (o:ObjType_order {_eom_id: $orderId})-[:LINK_PLACED_BY]->(c:ObjType_customer)
RETURN c
```

### Multi-Hop Traversal (variable depth)

```cypher
MATCH path = (start:ObjType_product {_eom_id: $productId})-[:LINK_IS_PART_OF*1..5]->(end)
RETURN [n IN nodes(path) | n._eom_id] AS chain,
       length(path) AS depth
```

### All Links from an Object

```cypher
MATCH (n {_eom_id: $objectId, _eom_space_id: $spaceId})
MATCH (n)-[r]->(related)
RETURN type(r) AS link_type,
       r._link_type AS link_api_name,
       related._eom_id AS related_id,
       related._eom_type AS related_type
```

### Point-in-Time Query on Temporal Links

```cypher
MATCH (e:ObjType_employee {_eom_id: $employeeId})-[r:LINK_WORKS_IN]->(d:ObjType_department)
WHERE r.valid_from <= $asOfDate
  AND (r.valid_to IS NULL OR r.valid_to > $asOfDate)
RETURN d, r.role AS role, r.valid_from AS start_date
```

---

## Meta-Graph Patterns

### Register a New Object Type (on publish)

```cypher
GRAPH.QUERY eom_meta
'MERGE (ot:OntMeta_ObjectType {api_name: $apiName, space_id: $spaceId})
 SET ot.display_name   = $displayName,
     ot.description    = $description,
     ot.status         = $status,
     ot.domain         = $domain,
     ot.sensitivity    = $sensitivity,
     ot.version        = $version,
     ot.falkor_label   = $falkorLabel,
     ot.es_alias       = $esAlias,
     ot.updated_at     = timestamp()
 RETURN ot'
```

### Register Property → Object Type relationship

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {api_name: $objectType, space_id: $spaceId})
 MERGE (p:OntMeta_Property {api_name: $propName, space_id: $spaceId})
 SET p.base_type     = $baseType,
     p.is_required   = $isRequired,
     p.is_shared     = $isShared,
     p.version       = $version
 MERGE (ot)-[:HAS_PROPERTY]->(p)
 RETURN p'
```

### Impact Analysis — Which Action Types edit a given property?

```cypher
GRAPH.QUERY eom_meta
'MATCH (at:OntMeta_ActionType)-[:EDITS]->(p:OntMeta_Property {api_name: $propName})
       <-[:HAS_PROPERTY]-(ot:OntMeta_ObjectType {api_name: $objectType})
 RETURN at.api_name AS action,
        at.display_name AS action_name,
        ot.api_name AS object_type
 ORDER BY at.api_name'
```

### Blast Radius — All dependents of an Object Type

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {api_name: $objectType, space_id: $spaceId})
 OPTIONAL MATCH (ot)<-[:HAS_PROPERTY|HAS_LINK_TYPE|HAS_ACTION_TYPE]-(dep)
 OPTIONAL MATCH (ot)-[:HAS_LINK_TYPE]->(lt:OntMeta_LinkType)<-[:CREATES_LINK]-(at)
 RETURN collect(DISTINCT dep.api_name) AS direct_dependents,
        collect(DISTINCT at.api_name)  AS action_dependents'
```

### Find All Orphaned Published Types (no datasource, no actions)

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {status: "PUBLISHED", space_id: $spaceId})
 WHERE NOT (ot)-[:HAS_DATASOURCE]->()
   AND NOT (ot)-[:HAS_ACTION_TYPE]->()
 RETURN ot.api_name, ot.display_name, ot.steward_id'
```

---

## JavaScript UDFs (Read-Only Computed Functions)

### Register a UDF library

```python
# In Schema Service — called once at startup / on publish
from falkordb import FalkorDB

def register_udf_library(client: FalkorDB, lib_name: str, js_source: str):
    client.udf_load(lib_name, js_source, replace=True)

# Example: EomCore library
EOM_CORE_UDF_SOURCE = """
function displayLabel(type, name, code) {
  if (!name) return code || type;
  return code ? name + ' (' + code + ')' : name;
}
falkor.register('displayLabel', displayLabel);

function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.length === 0) return 0.0;
  var a = setA.reduce(function(s, x) { s[x] = true; return s; }, {});
  var inter = setB.filter(function(x) { return a[x]; }).length;
  var union = Object.keys(setA.reduce(function(s, x) {
    s[x] = true; return s;
  }, setB.reduce(function(s, x) { s[x] = true; return s; }, {}))).length;
  return inter / union;
}
falkor.register('jaccardSimilarity', jaccardSimilarity);

function truncateText(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}
falkor.register('truncateText', truncateText);
"""
```

### Call a UDF in a Cypher read query

```cypher
-- Use displayLabel UDF for computed display name
MATCH (p:ObjType_person {_eom_space_id: $spaceId})
RETURN p._eom_id AS id,
       EomCore.displayLabel('Person', p.firstName, p.employeeCode) AS label,
       EomCore.truncateText(p.bio, 200) AS short_bio
```

**UDFs CANNOT:**
- Create, update, or delete nodes or relationships
- Start transactions
- Call external services
- Access the file system

---

## Volume Metrics Queries

```cypher
-- Object instance count per type
MATCH (n:ObjType_order {_eom_space_id: $spaceId})
RETURN count(n) AS total_objects

-- Property fill rate (% non-null for a specific property)
MATCH (n:ObjType_order {_eom_space_id: $spaceId})
RETURN count(n) AS total,
       count(n.submittedAt) AS filled,
       toFloat(count(n.submittedAt)) / toFloat(count(n)) AS fill_rate

-- Link count per link type
MATCH ()-[r:LINK_PLACED_BY {_eom_space_id: $spaceId}]->()
RETURN count(r) AS link_count

-- In-degree distribution for an object type
MATCH (n:ObjType_customer {_eom_space_id: $spaceId})
WITH n, size((n)<--()) AS in_degree
RETURN avg(in_degree) AS avg_in_degree,
       max(in_degree) AS max_in_degree,
       min(in_degree) AS min_in_degree
```

---

## Sandbox Graph Management

```python
# In Git Service: create sandbox graph for a new branch
async def create_sandbox_graph(client: FalkorDB, space_id: str, branch_slug: str):
    production_name = f"eom_{space_id}_data"
    sandbox_name    = f"eom_{space_id}_{branch_slug}_data"

    # FalkorDB GRAPH.COPY creates a full copy of the graph
    await asyncio.to_thread(
        client.connection.execute_command,
        "GRAPH.COPY", production_name, sandbox_name
    )

async def delete_sandbox_graph(client: FalkorDB, space_id: str, branch_slug: str):
    sandbox_name = f"eom_{space_id}_{branch_slug}_data"
    sandbox_graph = client.select_graph(sandbox_name)
    await asyncio.to_thread(sandbox_graph.delete)
```

---

## Error Handling

```python
from falkordb.exceptions import ResponseError

async def safe_graph_query(graph, cypher: str, params: dict) -> list:
    try:
        result = await asyncio.to_thread(graph.query, cypher, params)
        return result.result_set
    except ResponseError as e:
        if "No such property" in str(e):
            raise ValueError(f"Property not found in query: {e}")
        if "Type mismatch" in str(e):
            raise ValueError(f"Cypher type error: {e}")
        raise RuntimeError(f"FalkorDB query failed: {e}")
```
