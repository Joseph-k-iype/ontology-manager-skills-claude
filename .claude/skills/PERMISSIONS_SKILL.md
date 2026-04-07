# Permissions Skill

> Patterns for the EOM fine-grained permission system.
> Covers RBAC, ABAC, FalkorDB storage, cascade logic, OPA evaluation, and API patterns.

---

## Permission Model Overview

EOM supports two complementary policy models:

| Model | Description | Use when |
|---|---|---|
| **RBAC** | Role-Based Access Control — grant actions to roles, assign roles to users | Simple org-level access (Admin / Editor / Viewer) |
| **ABAC** | Attribute-Based Access Control — conditional rules using user/resource attributes | Dynamic rules (department, clearance, data sensitivity) |

Both models are stored as `:OntMeta_Permission` nodes in FalkorDB and evaluated
by OPA at runtime. The UI generates the policies; neither humans nor services
write Rego by hand at runtime.

---

## FalkorDB Permission Node

```cypher
CREATE (:OntMeta_Permission {
  id:              $id,            -- ULID
  resource_type:   $resource_type, -- "SPACE"|"FOLDER"|"ONTOLOGY"|"OBJECT_TYPE"|"PROPERTY"|"RELATIONSHIP"
  resource_id:     $resource_id,
  subject_type:    $subject_type,  -- "USER"|"GROUP"|"ROLE"
  subject_id:      $subject_id,
  actions:         $actions,       -- list: ["READ","WRITE","EDIT","DELETE"]
  policy_type:     $policy_type,   -- "RBAC"|"ABAC"
  abac_condition:  $abac_condition, -- null for RBAC; expression string for ABAC
  created_at:      $ts
})

-- Link permission to its target resource
MATCH (perm:OntMeta_Permission {id: $id}), (res {id: $resource_id})
CREATE (perm)-[:APPLIES_TO]->(res)
```

### Indexes

```cypher
CREATE INDEX FOR (p:OntMeta_Permission) ON (p.resource_id)
CREATE INDEX FOR (p:OntMeta_Permission) ON (p.subject_id)
```

---

## Resource Hierarchy

```
OntMeta_Space
  └── OntMeta_Folder          -[:BELONGS_TO]-> Space
        └── OntMeta_Ontology  -[:BELONGS_TO]-> Folder
              └── OntMeta_ObjectType -[:BELONGS_TO]-> Ontology
                    └── OntMeta_Property -[:BELONGS_TO]-> ObjectType
```

Relationships to traverse:
```cypher
(child)-[:BELONGS_TO*1..4]->(ancestor)
```

---

## Permission Cascade Logic

1. **Inherit by default** — a permission on a Space applies to all Folders,
   Ontologies, ObjectTypes, and Properties within it.
2. **Child overrides parent** — a permission set directly on an Ontology
   overrides the inherited Space permission for the same subject.
3. **Most specific wins** — depth 0 (direct) beats depth 1 (parent), etc.

### Python: Resolve Effective Permissions

```python
from dataclasses import dataclass

@dataclass
class PermissionRow:
    actions: list[str]
    policy_type: str
    abac_condition: str | None
    source_resource_id: str
    depth: int


def resolve_effective_permissions(rows: list[PermissionRow]) -> list[str]:
    """
    Given permission rows ordered by depth ASC (most specific first),
    return the actions from the most specific entry.
    Returns [] if no permissions exist (implicit DENY).
    """
    if not rows:
        return []
    rows_sorted = sorted(rows, key=lambda r: r.depth)
    return rows_sorted[0].actions


def has_permission(rows: list[PermissionRow], required_action: str) -> bool:
    effective = resolve_effective_permissions(rows)
    return required_action in effective
```

---

## Cypher: Fetch All Permissions for a Subject on a Resource

```cypher
-- Direct + inherited permissions in one query
MATCH (resource {id: $resource_id})
OPTIONAL MATCH (resource)-[:BELONGS_TO*1..4]->(ancestor)
WITH resource, collect(ancestor) AS ancestors
UNWIND ([resource] + ancestors) AS node
MATCH (perm:OntMeta_Permission)-[:APPLIES_TO]->(node)
WHERE perm.subject_id = $subject_id
RETURN
  perm.id              AS id,
  perm.actions         AS actions,
  perm.policy_type     AS policy_type,
  perm.abac_condition  AS abac_condition,
  node.id              AS source_resource_id,
  CASE node.id WHEN resource.id THEN 0
    ELSE length((resource)-[:BELONGS_TO*]->(node))
  END                  AS depth
ORDER BY depth ASC
```

---

## OPA Rego: Full Permission Policy

Save as `apps/api/opa_policies/permissions.rego`:

```rego
package eom.permissions

import future.keywords.if
import future.keywords.in

# ── Entry point ─────────────────────────────────────────────────────────────

default allow := false

# Allow if the most specific applicable permission grants the requested action
allow if {
    entry := most_specific_entry
    input.action in entry.actions
    policy_passes(entry)
}

# ── Helpers ──────────────────────────────────────────────────────────────────

# Most specific = lowest depth; direct permissions (depth 0) win over inherited
most_specific_entry := entry if {
    chain := input.permission_chain
    count(chain) > 0
    min_depth := min({e.depth | e := chain[_]})
    entry := [e | e := chain[_]; e.depth == min_depth][0]
}

# RBAC: pass unconditionally (role assignment already checked server-side)
policy_passes(entry) if { entry.policy_type == "RBAC" }

# ABAC: evaluate condition expression
policy_passes(entry) if {
    entry.policy_type == "ABAC"
    entry.abac_condition != null
    abac_condition_passes(entry.abac_condition)
}

# ── ABAC DSL evaluators ──────────────────────────────────────────────────────

# Pattern: user.department == "Finance"
abac_condition_passes(cond) if {
    regex.match(`^user\.department\s*==\s*"[^"]+"$`, cond)
    expected := regex.find_all_string_submatch_n(`"([^"]+)"`, cond, 1)[0][1]
    input.user.attributes.department == expected
}

# Pattern: user.clearance >= 3
abac_condition_passes(cond) if {
    regex.match(`^user\.clearance\s*>=\s*\d+$`, cond)
    required := to_number(regex.find_n(`\d+`, cond, 1)[0])
    input.user.attributes.clearance >= required
}

# Pattern: resource.sensitivity == "PUBLIC"
abac_condition_passes(cond) if {
    regex.match(`^resource\.sensitivity\s*==\s*"[^"]+"$`, cond)
    expected := regex.find_all_string_submatch_n(`"([^"]+)"`, cond, 1)[0][1]
    input.resource.sensitivity == expected
}
```

### OPA Unit Tests

```rego
package eom.permissions_test

import data.eom.permissions

test_rbac_read_allowed if {
    permissions.allow with input as {
        "user": {"id": "u1", "attributes": {}},
        "action": "READ",
        "resource": {"id": "s1", "type": "SPACE"},
        "permission_chain": [{
            "actions": ["READ", "WRITE"],
            "policy_type": "RBAC",
            "abac_condition": null,
            "depth": 0
        }]
    }
}

test_abac_department_deny if {
    not permissions.allow with input as {
        "user": {"id": "u2", "attributes": {"department": "Engineering"}},
        "action": "READ",
        "resource": {"id": "o1", "type": "ONTOLOGY"},
        "permission_chain": [{
            "actions": ["READ"],
            "policy_type": "ABAC",
            "abac_condition": "user.department == \"Finance\"",
            "depth": 1
        }]
    }
}

test_child_overrides_parent if {
    permissions.allow with input as {
        "user": {"id": "u3", "attributes": {}},
        "action": "DELETE",
        "resource": {"id": "ot1", "type": "OBJECT_TYPE"},
        "permission_chain": [
            {"actions": ["READ"], "policy_type": "RBAC", "abac_condition": null, "depth": 2},
            {"actions": ["READ", "WRITE", "EDIT", "DELETE"], "policy_type": "RBAC", "abac_condition": null, "depth": 0}
        ]
    }
}
```

---

## Python: OPA Service Integration

```python
# apps/api/services/opa_service.py (permission check method)

async def check_permission(
    self,
    user_id: str,
    user_roles: list[str],
    user_attributes: dict,
    action: str,
    resource_type: str,
    resource_id: str,
    permission_rows: list[dict],
) -> bool:
    payload = {
        "input": {
            "user": {
                "id": user_id,
                "roles": user_roles,
                "attributes": user_attributes,
            },
            "action": action,
            "resource": {
                "type": resource_type,
                "id": resource_id,
            },
            "permission_chain": permission_rows,
        }
    }
    try:
        resp = await self._client.post(
            f"{self._opa_url}/v1/data/eom/permissions/allow",
            json=payload,
            timeout=2.0,
        )
        resp.raise_for_status()
        return resp.json().get("result", False)
    except Exception:
        # Fail open in dev, fail closed in prod
        if self._env == "production":
            return False
        return True
```

---

## API Endpoints

```
POST   /api/v1/permissions                           Create permission
GET    /api/v1/permissions?resource_type=X&resource_id=Y  List permissions on resource
DELETE /api/v1/permissions/{permission_id}           Remove permission
GET    /api/v1/permissions/effective?resource_id=X&subject_id=Y  Resolve effective permissions
```

### Create Permission Request

```json
{
  "resource_type": "ONTOLOGY",
  "resource_id": "01J9XXXXX",
  "subject_type": "USER",
  "subject_id": "user_abc",
  "actions": ["READ", "WRITE"],
  "policy_type": "ABAC",
  "abac_condition": "user.department == \"Finance\""
}
```

### Effective Permission Response

```json
{
  "subject_id": "user_abc",
  "resource_id": "01J9XXXXX",
  "effective_actions": ["READ", "WRITE"],
  "source_resource_id": "01J8FOLDER",
  "source_resource_type": "FOLDER",
  "depth": 1,
  "policy_type": "ABAC"
}
```

---

## ABAC Condition DSL Reference

The ABAC condition is a simple one-line expression evaluated by OPA Rego:

| Pattern | Example |
|---|---|
| `user.department == "X"` | `user.department == "Finance"` |
| `user.clearance >= N` | `user.clearance >= 3` |
| `resource.sensitivity == "X"` | `resource.sensitivity == "PUBLIC"` |
| Compound (AND) | Not supported in v1 — use two separate permissions |

---

## Predefined RBAC Roles

| Role | Default Actions |
|---|---|
| `space:admin` | READ, WRITE, EDIT, DELETE on all resources in space |
| `space:editor` | READ, WRITE, EDIT on all resources in space |
| `space:viewer` | READ only on all resources in space |
| `ontology:publisher` | READ, WRITE, EDIT + publish action on ontologies |

Roles are assigned by setting `subject_type: "ROLE"` and `subject_id: "<role_name>"`.
The caller's roles are resolved server-side from the JWT and passed to OPA.
