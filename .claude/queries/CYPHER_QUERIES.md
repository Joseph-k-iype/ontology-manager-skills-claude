# Cypher Query Reference

> Every Cypher query pattern used by EOM. All queries use parameterised
> inputs ($param). Never interpolate user data into Cypher strings.
> All write queries run through the Action Service after OPA clearance.

---

## Query Service — Read Patterns

### Get Object by Primary Key

```cypher
MATCH (n:ObjType_{type} {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN n
```

### Get Multiple Objects by IDs

```cypher
MATCH (n:ObjType_{type})
WHERE n._eom_id IN $object_ids
  AND n._eom_space_id = $space_id
  AND n._eom_deleted_at IS NULL
RETURN n
ORDER BY n._eom_created_at DESC
```

### Filter Objects by Property

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
  AND n.status = $status
  AND n._eom_created_at >= $created_after
RETURN n
ORDER BY n._eom_created_at DESC
SKIP $skip LIMIT $limit
```

### Count Objects

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN count(n) AS total
```

### Full-Scan with Pagination (large datasets — prefer ES instead)

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN n
ORDER BY n._eom_id
SKIP $skip LIMIT $limit
```

---

## Link Traversal Patterns

### Follow One Link (outgoing)

```cypher
MATCH (src:ObjType_{source_type} {_eom_id: $source_id, _eom_space_id: $space_id})
MATCH (src)-[r:LINK_{LINK_TYPE}]->(tgt:ObjType_{target_type})
WHERE tgt._eom_deleted_at IS NULL
RETURN tgt, r
```

### Follow One Link (incoming)

```cypher
MATCH (tgt:ObjType_{target_type} {_eom_id: $target_id, _eom_space_id: $space_id})
MATCH (src:ObjType_{source_type})-[r:LINK_{LINK_TYPE}]->(tgt)
WHERE src._eom_deleted_at IS NULL
RETURN src, r
```

### All Links from an Object (any direction)

```cypher
MATCH (n {_eom_id: $object_id, _eom_space_id: $space_id})
MATCH (n)-[r]-(related)
WHERE related._eom_space_id = $space_id
  AND related._eom_deleted_at IS NULL
RETURN type(r)               AS rel_type,
       r._link_type          AS link_api_name,
       startNode(r)._eom_id  AS from_id,
       endNode(r)._eom_id    AS to_id,
       related._eom_id       AS related_id,
       related._eom_type     AS related_type
```

### Multi-Hop Traversal (fixed depth)

```cypher
MATCH (start:ObjType_{type} {_eom_id: $start_id, _eom_space_id: $space_id})
MATCH (start)-[:LINK_{LINK_TYPE}*1..{depth}]->(node)
WHERE node._eom_space_id = $space_id
  AND node._eom_deleted_at IS NULL
RETURN DISTINCT node
```

### Multi-Hop Variable Depth (use carefully on large graphs)

```cypher
MATCH (start:ObjType_{type} {_eom_id: $start_id})
MATCH path = (start)-[*1..$max_depth]-(end)
WHERE ALL(n IN nodes(path) WHERE n._eom_space_id = $space_id)
RETURN path
ORDER BY length(path)
LIMIT $limit
```

### Shortest Path Between Two Objects

```cypher
MATCH (a:ObjType_{type_a} {_eom_id: $id_a, _eom_space_id: $space_id})
MATCH (b:ObjType_{type_b} {_eom_id: $id_b, _eom_space_id: $space_id})
MATCH path = shortestPath((a)-[*..10]-(b))
RETURN path, length(path) AS hops
```

### Point-in-Time Temporal Link Query

```cypher
MATCH (src:ObjType_{source_type} {_eom_id: $source_id})
MATCH (src)-[r:LINK_{LINK_TYPE}]->(tgt:ObjType_{target_type})
WHERE r.valid_from <= $as_of_date
  AND (r.valid_to IS NULL OR r.valid_to > $as_of_date)
  AND tgt._eom_deleted_at IS NULL
RETURN tgt, r.valid_from AS from_date, r.valid_to AS to_date
ORDER BY r.valid_from DESC
```

### History of Temporal Links (all versions)

```cypher
MATCH (src:ObjType_{type} {_eom_id: $id})-[r:LINK_{LINK_TYPE}]->(tgt)
RETURN tgt._eom_id AS target_id,
       r.valid_from AS start_date,
       r.valid_to   AS end_date,
       r._created_by AS created_by,
       r._action_ref  AS action
ORDER BY r.valid_from ASC
```

---

## Write Patterns (executed by Action Service only)

### Create Object Node

```cypher
CREATE (n:ObjType_{type} {
  _eom_id:          $id,
  _eom_type:        $object_type,
  _eom_space_id:    $space_id,
  _eom_version:     $schema_version,
  _eom_sensitivity: $sensitivity,
  _eom_created_at:  timestamp(),
  _eom_updated_at:  timestamp(),
  _last_action:     $action_type,
  _last_actor:      $actor_id,
  _last_action_at:  timestamp()
})
RETURN n._eom_id AS id, 'CREATED' AS status
```

### Update Object Properties

```cypher
MATCH (n:ObjType_{type} {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
SET n.{property_1}    = ${param_1},
    n.{property_2}    = ${param_2},
    n._last_action    = $action_type,
    n._last_actor     = $actor_id,
    n._last_action_at = timestamp(),
    n._eom_updated_at = timestamp()
RETURN n._eom_id AS id, 'UPDATED' AS status
```

### Create Link

```cypher
MATCH (src:ObjType_{src_type} {_eom_id: $src_id, _eom_space_id: $space_id})
MATCH (tgt:ObjType_{tgt_type} {_eom_id: $tgt_id, _eom_space_id: $space_id})
CREATE (src)-[:LINK_{LINK_TYPE} {
  _link_type:  $link_api_name,
  _created_by: $actor_id,
  _created_at: timestamp(),
  _action_ref: $action_type
}]->(tgt)
RETURN 'LINK_CREATED' AS status
```

### Create Temporally Bounded Link

```cypher
MATCH (src:ObjType_{src_type} {_eom_id: $src_id, _eom_space_id: $space_id})
MATCH (tgt:ObjType_{tgt_type} {_eom_id: $tgt_id, _eom_space_id: $space_id})
CREATE (src)-[:LINK_{LINK_TYPE} {
  _link_type:  $link_api_name,
  _created_by: $actor_id,
  _created_at: timestamp(),
  _action_ref: $action_type,
  valid_from:  $valid_from,
  valid_to:    null
}]->(tgt)
RETURN 'LINK_CREATED' AS status
```

### Close Temporal Link (set valid_to)

```cypher
MATCH (src:ObjType_{src_type} {_eom_id: $src_id})
      -[r:LINK_{LINK_TYPE} {valid_to: null}]->
      (tgt:ObjType_{tgt_type} {_eom_id: $tgt_id})
SET r.valid_to = $end_date
RETURN 'LINK_CLOSED' AS status
```

### Delete Link

```cypher
MATCH (src:ObjType_{src_type} {_eom_id: $src_id})
      -[r:LINK_{LINK_TYPE}]->
      (tgt:ObjType_{tgt_type} {_eom_id: $tgt_id})
DELETE r
RETURN 'LINK_DELETED' AS status
```

### Soft Delete Object

```cypher
MATCH (n:ObjType_{type} {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
SET n._eom_deleted_at = timestamp(),
    n._eom_deleted_by = $actor_id,
    n._last_action    = $action_type,
    n._last_actor     = $actor_id,
    n._last_action_at = timestamp()
RETURN n._eom_id AS id, 'DELETED' AS status
```

---

## Submission Criteria Checks (read-only, run before any write)

```cypher
-- Check: object exists and has expected status
MATCH (n:ObjType_{type} {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN n._eom_id IS NOT NULL AS exists,
       n.status = $expected_status AS criteria_met,
       n.status AS actual_status

-- Check: object has no existing open link of a given type
MATCH (n:ObjType_{type} {_eom_id: $object_id})
OPTIONAL MATCH (n)-[r:LINK_{LINK_TYPE} {valid_to: null}]->()
RETURN r IS NULL AS no_open_link

-- Check: linked target object exists and is in valid state
MATCH (target:ObjType_{target_type} {_eom_id: $target_id, _eom_space_id: $space_id})
WHERE target._eom_deleted_at IS NULL
  AND target.status IN ['ACTIVE', 'PUBLISHED']
RETURN target._eom_id IS NOT NULL AS valid_target
```

---

## Aggregation Queries

### Count by Property Value (use ES for large datasets)

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN n.status AS value, count(n) AS count
ORDER BY count DESC
```

### Sum a Numeric Property

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
  AND n.currency = $currency
RETURN sum(n.amount) AS total
```

### Distinct Values of a Property

```cypher
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN DISTINCT n.{property} AS value
ORDER BY value
```

---

## Meta-Graph — Schema Queries

### Get Object Type Schema

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {api_name: $api_name, space_id: $space_id})
 OPTIONAL MATCH (ot)-[:HAS_PROPERTY]->(p:OntMeta_Property)
 OPTIONAL MATCH (ot)-[:IMPLEMENTS]->(i:OntMeta_Interface)
 OPTIONAL MATCH (ot)-[:HAS_ACTION_TYPE]->(at:OntMeta_ActionType)
 OPTIONAL MATCH (ot)-[:HAS_LINK_TYPE]->(lt:OntMeta_LinkType)
 RETURN ot,
        collect(DISTINCT p)  AS properties,
        collect(DISTINCT i)  AS interfaces,
        collect(DISTINCT at) AS action_types,
        collect(DISTINCT lt) AS link_types'
```

### List All Object Types in a Space

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {space_id: $space_id})
 RETURN ot.api_name      AS api_name,
        ot.display_name  AS display_name,
        ot.status        AS status,
        ot.domain        AS domain,
        ot.version       AS version
 ORDER BY ot.api_name'
```

### Find All Implementors of an Interface

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType)-[:IMPLEMENTS]->(i:OntMeta_Interface {api_name: $interface_name})
 WHERE ot.space_id = $space_id
 RETURN ot.api_name, ot.display_name, ot.status'
```

### Blast Radius — Direct Dependents of an Object Type

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {api_name: $api_name, space_id: $space_id})
 OPTIONAL MATCH (ot)-[:HAS_LINK_TYPE]->(lt:OntMeta_LinkType)<-[:CREATES_LINK]-(at:OntMeta_ActionType)
 OPTIONAL MATCH (ot)-[:HAS_ACTION_TYPE]->(direct_at:OntMeta_ActionType)
 OPTIONAL MATCH (dep_ot:OntMeta_ObjectType)-[:HAS_LINK_TYPE]->(lt2:OntMeta_LinkType)-[:POINTS_TO]->(ot)
 RETURN collect(DISTINCT at.api_name)      AS action_types_using_links,
        collect(DISTINCT direct_at.api_name) AS direct_action_types,
        collect(DISTINCT dep_ot.api_name)  AS dependent_object_types'
```

### Full Transitive Dependency Chain

```cypher
GRAPH.QUERY eom_meta
'MATCH path = (sp:OntMeta_SharedProperty {api_name: $shared_prop_name})
       <-[:USES_SHARED_PROPERTY*1..10]-(dep)
 WHERE ALL(n IN nodes(path) WHERE n.space_id = $space_id)
 RETURN [n IN nodes(path) | n.api_name] AS chain,
        length(path) AS depth
 ORDER BY depth ASC'
```

### Find Orphaned Published Types

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {status: "PUBLISHED", space_id: $space_id})
 WHERE NOT (ot)-[:HAS_DATASOURCE]->()
   AND NOT (ot)-[:HAS_ACTION_TYPE]->()
 RETURN ot.api_name, ot.display_name, ot.steward_id
 ORDER BY ot.api_name'
```

### Property Fill Rate Analysis (for OHS)

```cypher
GRAPH.QUERY eom_meta
'MATCH (ot:OntMeta_ObjectType {space_id: $space_id, status: "PUBLISHED"})
 MATCH (ot)-[:HAS_PROPERTY]->(p:OntMeta_Property)
 WHERE NOT p.is_required
   AND p.fill_rate < $threshold
 RETURN ot.api_name, p.api_name, p.fill_rate
 ORDER BY p.fill_rate ASC'
```

---

## UDF Calls in Read Queries

```cypher
-- Derived property: full display label
MATCH (n:ObjType_person {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN n._eom_id AS id,
       EomCore.displayLabel('Person', n.firstName, n.employeeCode) AS label,
       EomCore.truncateText(n.bio, 200) AS short_bio
LIMIT $limit

-- Derived property: compute similarity between two node tag sets
MATCH (a:ObjType_product {_eom_id: $id_a})
MATCH (b:ObjType_product {_eom_id: $id_b})
RETURN EomCore.jaccardSimilarity(a.feature_tags, b.feature_tags) AS similarity

-- Custom traversal scoring UDF (if registered)
MATCH (start:ObjType_risk_event {_eom_id: $start_id})
MATCH (start)-[*1..3]-(related:ObjType_control)
RETURN related._eom_id AS id,
       EomRisk.controlCoverage(related.type, related.effectiveness) AS coverage_score
ORDER BY coverage_score DESC
LIMIT 10
```

---

## Volume & Metrics Queries

```cypher
-- Total object count per type (run hourly by Health Agent)
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN count(n) AS total_objects

-- Property fill rate (run daily)
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NULL
RETURN count(n)                  AS total,
       count(n.{property_name})  AS non_null,
       toFloat(count(n.{property_name})) / toFloat(count(n)) AS fill_rate

-- Link instance count (run hourly)
MATCH ()-[r:LINK_{LINK_TYPE}]->()
WHERE r._eom_space_id = $space_id
RETURN count(r) AS link_count

-- Average in-degree (daily)
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WITH n, size((n)<--()) AS in_degree
RETURN avg(in_degree) AS avg_in_degree,
       max(in_degree) AS max_in_degree

-- Recently modified objects (for freshness check)
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_updated_at >= $since_timestamp
  AND n._eom_deleted_at IS NULL
RETURN count(n) AS recently_modified
```

---

## Admin / Cleanup Queries

### Hard Delete All Soft-Deleted Objects Older Than Retention Period

```cypher
-- Only run as a scheduled maintenance job with explicit approval
MATCH (n:ObjType_{type} {_eom_space_id: $space_id})
WHERE n._eom_deleted_at IS NOT NULL
  AND n._eom_deleted_at < $cutoff_timestamp
DETACH DELETE n
RETURN count(n) AS deleted_count
```

### Recount and Fix Meta-Graph Property Usage Stats

```cypher
GRAPH.QUERY eom_meta
'MATCH (sp:OntMeta_SharedProperty {space_id: $space_id})
 OPTIONAL MATCH (ot:OntMeta_ObjectType)-[:USES_SHARED_PROPERTY]->(sp)
 WITH sp, count(DISTINCT ot) AS usage_count
 SET sp.usage_count = usage_count
 RETURN sp.api_name, usage_count
 ORDER BY usage_count DESC'
```
