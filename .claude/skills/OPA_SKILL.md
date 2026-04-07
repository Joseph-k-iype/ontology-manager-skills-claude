# OPA Skill

> Open Policy Agent is the sole policy decision point for EOM.
> Every write goes through OPA before touching FalkorDB or Elasticsearch.
> Policies are Rego files in `.eom/opa-policies/` in the Space's Git repo.
> OPA runs as a sidecar at `http://opa:8181`.

---

## OPA Service Client

```python
# apps/api/services/opa_service.py
import httpx, os
from typing import Any

OPA_BASE = os.environ.get("OPA_URL", "http://localhost:8181")

class OPAService:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def _query(self, policy_path: str, input_data: dict) -> Any:
        """
        Call OPA REST API.
        policy_path: e.g. "eom/schema/allow" → /v1/data/eom/schema/allow
        """
        url      = f"{OPA_BASE}/v1/data/{policy_path}"
        response = await self.client.post(
            url,
            json={"input": input_data},
            timeout=5.0,
        )
        if response.status_code == 200:
            result = response.json()
            return result.get("result")
        # OPA unreachable — fail-safe: deny all
        raise RuntimeError(f"OPA unreachable: {response.status_code}")

    async def check_schema_change(
        self,
        diff: dict,           # from git_service.compute_diff()
        approvals: dict,      # {steward_ids: [], arb_ids: [], ...}
    ) -> dict:
        """Returns {allow: bool, change_classes: list, violations: list}"""
        result = await self._query("eom/schema", {
            "edits": diff["edits"],
            "approvals": approvals,
        })
        return {
            "allow": result.get("allow", False),
            "change_classes": result.get("change_classes", []),
            "violations": result.get("violations", []),
        }

    async def check_action_invoke(
        self,
        action_type_api_name: str,
        caller_roles: list[str],
        caller_org_id: str,
        object_id: str,
        object_sensitivity: str,
        submission_criteria_passed: bool,
    ) -> dict:
        """Returns {allow: bool, deny_reason: str | None}"""
        try:
            result = await self._query("eom/action", {
                "action_type_api_name": action_type_api_name,
                "caller": {
                    "roles":  caller_roles,
                    "org_id": caller_org_id,
                },
                "object_id":                    object_id,
                "object_sensitivity":           object_sensitivity,
                "submission_criteria_passed":   submission_criteria_passed,
            })
            return {
                "allow":       result.get("allow", False),
                "deny_reason": result.get("deny_reason"),
            }
        except RuntimeError:
            # OPA down — fail-safe DENY
            return {"allow": False, "deny_reason": "OPA_UNAVAILABLE"}

    async def check_access(
        self,
        space_id: str,
        resource_type: str,        # "ontology" | "object_type" | "objects"
        operation: str,            # "read" | "write" | "admin"
        caller_roles: list[str],
        caller_org_id: str,
        space_visibility: str,
        space_member_org_ids: list[str],
    ) -> dict:
        """Returns {allow: bool, masked_fields: list[str]}"""
        try:
            result = await self._query("eom/access", {
                "space_id":             space_id,
                "resource_type":        resource_type,
                "operation":            operation,
                "caller": {
                    "roles":  caller_roles,
                    "org_id": caller_org_id,
                },
                "space_visibility":     space_visibility,
                "space_member_org_ids": space_member_org_ids,
            })
            return {
                "allow":         result.get("allow", False),
                "masked_fields": result.get("masked_fields", []),
            }
        except RuntimeError:
            return {"allow": False, "masked_fields": []}

    async def check_naming(
        self,
        api_name: str,
        name_type: str,            # "object_type" | "property" | "link_type"
        shared_properties: list[str],  # existing shared property names
    ) -> dict:
        """Returns {allow: bool, violation: str | None}"""
        result = await self._query("eom/schema/naming", {
            "api_name":          api_name,
            "name_type":         name_type,
            "shared_properties": shared_properties,
        })
        return {
            "allow":     result.get("valid_object_type_name"
                                   if name_type == "object_type"
                                   else "valid_property_name", False),
            "violation": result.get("violation"),
        }
```

---

## Rego Policies

### `schema.rego` — Change Classification and Approval

```rego
# .eom/opa-policies/schema.rego
package eom.schema

import future.keywords.in

# ── Per-edit change classification ─────────────────────────────────────────

additive_operations := {
  "ADD_OBJECT_TYPE", "ADD_LINK_TYPE", "ADD_ACTION_TYPE", "ADD_INTERFACE",
  "ADD_OPTIONAL_PROPERTY", "ADD_INTERFACE_IMPLEMENTATION", "ADD_TAG",
  "ADD_SEMANTIC_ANNOTATION", "ASSIGN_STEWARD", "ADD_TYPE_REFERENCE",
  "ADD_DERIVED_PROPERTY", "ADD_SHARED_PROPERTY_REF",
}

non_breaking_operations := {
  "UPDATE_DESCRIPTION", "UPDATE_DISPLAY_NAME", "UPDATE_SENSITIVITY_LABEL",
  "ADD_REQUIRED_PROPERTY_TO_DRAFT", "UPDATE_VALUE_TYPE_CONSTRAINT_WIDEN",
}

breaking_operations := {
  "RENAME_PROPERTY", "CHANGE_PROPERTY_BASE_TYPE", "DELETE_PROPERTY",
  "DELETE_OBJECT_TYPE", "DELETE_LINK_TYPE", "CHANGE_PRIMARY_KEY",
  "MAKE_PROPERTY_REQUIRED", "REDUCE_LINK_CARDINALITY",
  "REMOVE_INTERFACE_IMPLEMENTATION", "UPDATE_VALUE_TYPE_CONSTRAINT_NARROW",
  "CHANGE_SHARED_PROPERTY_BASE_TYPE",
}

classify(edit) := "ADDITIVE"     if { edit.operation in additive_operations }
classify(edit) := "NON_BREAKING" if { edit.operation in non_breaking_operations }
classify(edit) := "BREAKING"     if { edit.operation in breaking_operations }

change_classes contains cls if {
  some edit in input.edits
  cls := classify(edit)
}

# ── Overall PR approval decision ────────────────────────────────────────────

default allow := false

allow if {
  not has_unapproved_breaking
  not has_unapproved_non_breaking
}

has_unapproved_breaking if {
  "BREAKING" in change_classes
  not breaking_approved
}

has_unapproved_non_breaking if {
  "NON_BREAKING" in change_classes
  count(input.approvals.steward_ids) < 1
}

breaking_approved if {
  count(input.approvals.arb_ids)     >= 2
  count(input.approvals.steward_ids) >= 1
  input.approvals.impact_simulation_passed == true
  input.approvals.migration_plan_reviewed  == true
  all_breaking_have_sunset_date
}

all_breaking_have_sunset_date if {
  every edit in input.edits {
    classify(edit) != "BREAKING"
  }
}

all_breaking_have_sunset_date if {
  every edit in input.edits {
    some _ in input.approvals.sunset_dates[edit.id]
  }
}

# ── Violation messages for UI display ──────────────────────────────────────

violations contains msg if {
  has_unapproved_breaking
  msg := "BREAKING changes require 2 ARB approvals, steward approval, impact simulation, and migration plan"
}

violations contains msg if {
  has_unapproved_non_breaking
  msg := "NON_BREAKING changes require at least 1 steward approval"
}
```

### `naming.rego` — Naming Convention Enforcement

```rego
# .eom/opa-policies/naming.rego
package eom.schema.naming

import future.keywords.in

# Object type api_name: lowercase snake_case, no reserved DB prefixes
valid_object_type_name if {
  regex.match(`^[a-z][a-z0-9_]{1,79}$`, input.api_name)
  not has_reserved_prefix
}

reserved_prefixes := {
  "tbl_", "t_", "fact_", "dim_", "vw_", "tmp_", "stg_", "raw_", "ext_", "src_"
}

has_reserved_prefix if {
  some prefix in reserved_prefixes
  startswith(input.api_name, prefix)
}

# Property api_name: camelCase
valid_property_name if {
  regex.match(`^[a-z][a-zA-Z0-9]{0,79}$`, input.api_name)
}

# Link type api_name: lowercase snake_case, starts with approved verb
approved_link_verbs := {
  "placed_by", "assigned_to", "belongs_to", "is_part_of", "managed_by",
  "owned_by", "linked_to", "reported_to", "associated_with", "derived_from",
  "refers_to", "contains", "has", "uses", "applies_to", "governs",
  "executed_by", "created_by", "updated_by", "submitted_by", "approved_by",
}

valid_link_type_name if {
  regex.match(`^[a-z][a-z0-9_]{1,79}$`, input.api_name)
  some verb in approved_link_verbs
  startswith(input.api_name, verb)
}

# DRY: block local property if a matching shared property exists
no_shared_property_duplication if {
  not input.api_name in input.shared_properties
}

# Interface api_name: PascalCase
valid_interface_name if {
  regex.match(`^[A-Z][a-zA-Z0-9]{1,79}$`, input.api_name)
}
```

### `access.rego` — Space Access Control

```rego
# .eom/opa-policies/access.rego
package eom.access

import future.keywords.in

default allow := false

# PRIVATE space: only owning org members
allow if {
  input.space_visibility == "PRIVATE"
  input.caller.org_id == input.space_owning_org_id
  caller_has_role_for_operation
}

# PUBLIC space: all authenticated users can read
allow if {
  input.space_visibility == "PUBLIC"
  input.operation == "read"
}

# PUBLIC space: only members can write
allow if {
  input.space_visibility == "PUBLIC"
  input.operation in {"write", "admin"}
  input.caller.org_id in input.space_member_org_ids
  caller_has_role_for_operation
}

# SHARED space: all member orgs
allow if {
  input.space_visibility == "SHARED"
  input.caller.org_id in input.space_member_org_ids
  caller_has_role_for_operation
}

caller_has_role_for_operation if {
  input.operation == "read"
  some r in input.caller.roles
  r in {"VIEWER", "EDITOR", "STEWARD", "PUBLISHER", "ADMIN"}
}

caller_has_role_for_operation if {
  input.operation == "write"
  some r in input.caller.roles
  r in {"EDITOR", "STEWARD", "PUBLISHER", "ADMIN"}
}

caller_has_role_for_operation if {
  input.operation == "admin"
  "ADMIN" in input.caller.roles
}

# Field masking for sensitivity
masked_fields contains field if {
  some field in input.sensitive_fields
  not "ELEVATED_CLEARANCE" in input.caller.roles
}
```

### `action_invoke.rego` — Runtime Action Policy

```rego
# .eom/opa-policies/action_invoke.rego
package eom.action

import future.keywords.in

default allow := false

allow if {
  caller_has_required_role
  object_sensitivity_cleared
  not object_locked
  input.submission_criteria_passed == true
}

caller_has_required_role if {
  action_def := data.action_types[input.action_type_api_name]
  some required_role in action_def.required_roles
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
  data.object_locks[input.object_id].locked == true
  not "LOCK_OVERRIDE" in input.caller.roles
}

deny_reason := "INSUFFICIENT_ROLE" if {
  not caller_has_required_role
}

deny_reason := "SENSITIVITY_NOT_CLEARED" if {
  caller_has_required_role
  not object_sensitivity_cleared
}

deny_reason := "OBJECT_LOCKED" if {
  caller_has_required_role
  object_sensitivity_cleared
  object_locked
}

deny_reason := "SUBMISSION_CRITERIA_FAILED" if {
  caller_has_required_role
  object_sensitivity_cleared
  not object_locked
  input.submission_criteria_passed != true
}
```

---

## OPA Unit Tests

```rego
# .eom/opa-policies/schema_test.rego
package eom.schema_test

import data.eom.schema

# Test: additive change is always allowed (no approvals needed)
test_additive_change_allowed if {
  schema.allow with input as {
    "edits": [{"operation": "ADD_OBJECT_TYPE", "id": "e1"}],
    "approvals": {"steward_ids": [], "arb_ids": [],
                  "impact_simulation_passed": false,
                  "migration_plan_reviewed": false,
                  "sunset_dates": {}},
  }
}

# Test: breaking change is denied without approvals
test_breaking_change_denied_without_approvals if {
  not schema.allow with input as {
    "edits": [{"operation": "DELETE_PROPERTY", "id": "e1"}],
    "approvals": {"steward_ids": [], "arb_ids": [],
                  "impact_simulation_passed": false,
                  "migration_plan_reviewed": false,
                  "sunset_dates": {}},
  }
}

# Test: breaking change is allowed with full approvals
test_breaking_change_approved if {
  schema.allow with input as {
    "edits": [{"operation": "DELETE_PROPERTY", "id": "e1"}],
    "approvals": {
      "steward_ids": ["user-1"],
      "arb_ids":     ["arb-1", "arb-2"],
      "impact_simulation_passed": true,
      "migration_plan_reviewed": true,
      "sunset_dates": {"e1": "2026-07-01"},
    },
  }
}
```

Run tests:
```bash
opa test apps/api/opa_policies/ -v
# or from root:
opa test .eom/opa-policies/ -v
```

---

## OPA Data Loading (action_types and object_locks)

OPA reads external data from the `/v1/data` endpoint. EOM pushes current
action type definitions and object lock states to OPA on every publish:

```python
async def push_data_to_opa(
    opa_client: httpx.AsyncClient,
    action_types: dict,    # {api_name: {required_roles: [...]}}
    object_locks: dict,    # {object_id: {locked: bool}}
) -> None:
    await opa_client.put(
        f"{OPA_BASE}/v1/data/action_types",
        json=action_types,
    )
    await opa_client.put(
        f"{OPA_BASE}/v1/data/object_locks",
        json=object_locks,
    )
```

---

## CI Pipeline Integration

```bash
# In GitHub Actions / GitLab CI — runs on every PR
- name: OPA schema classification
  run: |
    opa eval \
      --bundle .eom/opa-policies/ \
      --data eom-runtime-data.json \
      --input diff.json \
      --format pretty \
      'data.eom.schema'

- name: OPA policy unit tests
  run: |
    opa test .eom/opa-policies/ -v --exit-zero-on-skipped

- name: OPA naming check
  run: |
    eom check-naming --opa-bundle .eom/opa-policies/
```

---

## Hierarchy Permission Cascade

Permissions in EOM cascade top-down through the resource hierarchy:

```
Space → Folder → Ontology → ObjectType → Property
```

A permission defined on a parent resource is automatically inherited by all
child resources. A child-level permission **overrides** the inherited parent
permission for the same subject.

### FalkorDB Traversal — Fetch Inherited Permissions

```cypher
-- Get all permissions for a resource, including inherited from ancestors
MATCH (child {id: $resource_id})-[:BELONGS_TO*1..4]->(parent)
MATCH (perm:OntMeta_Permission)-[:APPLIES_TO]->(parent)
WHERE perm.subject_id = $subject_id
RETURN perm.actions       AS actions,
       perm.policy_type   AS policy_type,
       perm.abac_condition AS abac_condition,
       parent.id          AS source_resource_id,
       labels(parent)     AS source_resource_type,
       length((child)-[:BELONGS_TO*]->(parent)) AS depth
ORDER BY depth ASC  -- closest ancestor first (lower depth = more specific)

UNION

-- Also return direct permissions on the resource itself (depth 0)
MATCH (perm:OntMeta_Permission)-[:APPLIES_TO]->(resource {id: $resource_id})
WHERE perm.subject_id = $subject_id
RETURN perm.actions, perm.policy_type, perm.abac_condition,
       resource.id AS source_resource_id,
       labels(resource) AS source_resource_type,
       0 AS depth
ORDER BY depth ASC
```

### Override Rule

The **most specific** (lowest depth) permission wins. Direct permissions
on a resource always override inherited permissions from ancestors.

```python
def resolve_effective_permissions(
    rows: list[dict],
) -> list[str]:
    """Return the most specific permission's actions."""
    if not rows:
        return []
    # rows are already ordered ASC by depth; first row is most specific
    return rows[0]["actions"]
```

### OPA Input — Full Permission Chain as Context

When calling OPA, pass the full resolved chain so policies can express
attribute-based rules against any ancestor:

```python
opa_input = {
    "user": {
        "id": user_id,
        "roles": user_roles,
        "attributes": user_attributes,   # dept, clearance, etc.
    },
    "action": action,                    # "READ" | "WRITE" | "EDIT" | "DELETE"
    "resource": {
        "type": resource_type,
        "id": resource_id,
    },
    "permission_chain": [
        {
            "source_resource_id": row["source_resource_id"],
            "source_resource_type": row["source_resource_type"],
            "actions": row["actions"],
            "policy_type": row["policy_type"],
            "abac_condition": row["abac_condition"],
            "depth": row["depth"],
        }
        for row in permission_rows
    ],
}
```

### Rego — Cascade Evaluation

```rego
package eom.access

import future.keywords.if
import future.keywords.in

# Allow if the most specific permission in the chain grants the action
default allow := false

allow if {
    chain := input.permission_chain
    count(chain) > 0
    # Take the entry with minimum depth (most specific)
    min_depth := min({entry.depth | entry := chain[_]})
    specific := [e | e := chain[_]; e.depth == min_depth][0]
    input.action in specific.actions
    evaluate_policy(specific)
}

# RBAC: always allow if roles match
evaluate_policy(entry) if {
    entry.policy_type == "RBAC"
}

# ABAC: evaluate the condition string (simplified DSL)
evaluate_policy(entry) if {
    entry.policy_type == "ABAC"
    entry.abac_condition != null
    abac_passes(entry.abac_condition)
}

# ABAC DSL — department check
abac_passes(condition) if {
    regex.match(`user\.department\s*==\s*"([^"]+)"`, condition)
    dept := regex.find_n(`"([^"]+)"`, condition, 1)[0]
    trim(dept, `"`) == input.user.attributes.department
}
```
