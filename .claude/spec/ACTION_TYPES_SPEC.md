# Action Types Specification

> Complete end-to-end guide for the Action Type system: YAML authoring,
> Cypher template compilation, OPA gating, execution, audit logging,
> and testing. This is the most complex feature in EOM — read it fully.

---

## What an Action Type Is

An Action Type is the **schema-level definition of an atomic change** to a
graph object. It specifies:

1. Which Object Type it targets
2. What parameters it accepts from the caller
3. What state the object must be in before it can execute (submission criteria)
4. Custom validation rules (read-only Cypher checks)
5. What changes it makes (property sets, link creates, link deletes)
6. What roles are required to invoke it
7. What side-effects it emits after success (webhooks, notifications)

At publish time, the Schema Compiler converts the YAML definition into a
**parameterised Cypher write template** stored as a `.cypher` file in the
Git worktree. At runtime, the Action Service executes that template atomically.

---

## YAML Authoring Reference

```yaml
# object-types/order/action-types/submit_order.yaml

api_name:           submit_order
display_name:       Submit Order
description: |
  Submits a DRAFT order for processing. Links the order to a customer,
  sets status to SUBMITTED, and records the submission timestamp.
  Requires the order to be in DRAFT status with a non-zero total amount.

target_object_type: order

parameters:
  - name:        customer_id
    type:        String
    required:    true
    object_ref:  customer          # value must be a valid customer _eom_id

  - name:        submitted_at
    type:        Timestamp
    required:    true

  - name:        submission_note
    type:        String
    required:    false
    default_value: ""

submission_criteria:
  - property:  status
    operator:  EQUALS
    value:     DRAFT              # object must be DRAFT to accept this action

  - property:  totalAmount
    operator:  GT
    value:     0                  # amount must be positive

validation_rules:
  - description: Order must have at least one line item
    cypher_check: |
      MATCH (n:ObjType_order {_eom_id: $object_id})
      OPTIONAL MATCH (n)-[:LINK_HAS_LINE_ITEM]->(item)
      RETURN count(item) > 0 AS valid, 'No line items found' AS message

  - description: Customer must be ACTIVE
    cypher_check: |
      MATCH (c:ObjType_customer {_eom_id: $customer_id, _eom_space_id: $space_id})
      RETURN c.status = 'ACTIVE' AS valid, 'Customer is not active' AS message

edits:
  - type:             SET_PROPERTY
    property:         status
    value:            SUBMITTED

  - type:             SET_PROPERTY
    property:         submittedAt
    value_from_param: submitted_at

  - type:             SET_PROPERTY
    property:         submissionNote
    value_from_param: submission_note

  - type:             CREATE_LINK
    link_type:        placed_by
    target_id_from_param: customer_id

side_effects:
  - type: WEBHOOK
    config:
      url:    "${ORDER_SUBMITTED_WEBHOOK_URL}"
      method: POST
      payload_template: |
        {
          "event":      "order.submitted",
          "order_id":   "${object_id}",
          "customer_id":"${customer_id}",
          "timestamp":  "${submitted_at}"
        }

  - type: NOTIFICATION
    config:
      channel:  order-ops
      template: "Order ${object_id} submitted by ${actor_id}"

permissions:
  required_roles: ["EDITOR", "STEWARD", "PUBLISHER", "ADMIN"]
  opa_policy_ref: null              # use default action_invoke.rego

undoable: false
```

---

## Compiled Cypher Template

The Schema Compiler generates this file at publish time. Never edit it manually.

```cypher
-- Auto-generated Cypher template for action: submit_order
-- Object type: order
-- DO NOT EDIT — regenerate by running: eom compile --branch main

-- Step 1: Match target object and validate submission criteria
MATCH (target:ObjType_order {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE target._eom_deleted_at IS NULL
  AND target.status = 'DRAFT'
  AND target.totalAmount > 0

-- Step 2: Match object references
WITH target
MATCH (ref_customer:ObjType_customer {_eom_id: $customer_id, _eom_space_id: $space_id})
WHERE ref_customer._eom_deleted_at IS NULL

-- Step 3: Apply property edits + system metadata
SET target.status             = 'SUBMITTED',
    target.submittedAt        = $submitted_at,
    target.submissionNote     = $submission_note,
    target._last_action       = $__action_type,
    target._last_actor        = $__actor_id,
    target._last_action_at    = timestamp(),
    target._eom_updated_at    = timestamp()

-- Step 4: Create link
CREATE (target)-[:LINK_PLACED_BY {
  _link_type:  'placed_by',
  _created_by: $__actor_id,
  _created_at: timestamp(),
  _action_ref: $__action_type
}]->(ref_customer)

-- Return
RETURN target._eom_id AS object_id, 'SUCCESS' AS status
```

---

## Full Execution Flow

```
POST /api/v1/spaces/{spaceId}/actions/submit_order/invoke
  Body: { object_id, params: { customer_id, submitted_at } }

              │
              ▼
┌─────────────────────────────────────────────────────┐
│  1. Pydantic parameter validation                   │
│     Rejects: missing required params,               │
│     wrong types, pattern violations                 │
│     → 400 INVALID_REQUEST on failure                │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  2. Load action type definition from eom_meta       │
│     Cypher: MATCH (at:OntMeta_ActionType {...})     │
│     → 404 if not found                              │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  3. Load object sensitivity (FalkorDB read)         │
│     MATCH (n:ObjType_order {_eom_id: $id})          │
│     RETURN n._eom_sensitivity                       │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  4. OPA evaluation: data.eom.action.invoke          │
│     Input:                                          │
│     {                                               │
│       action_type_api_name: "submit_order",         │
│       caller: { roles, org_id },                    │
│       object_id, object_sensitivity,                │
│       submission_criteria_passed: true/false        │
│     }                                               │
│     → 403 OPA_DENY on deny                         │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  5. Validation rules (read-only Cypher per rule)    │
│     Runs each cypher_check, collects failures       │
│     → 422 VALIDATION_ERROR if any rule fails        │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  6. Capture before_state (for audit log)            │
│     MATCH (n:ObjType_order {_eom_id: $id})          │
│     RETURN n                                        │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  7. Execute compiled Cypher template (ATOMIC write) │
│     GRAPH.QUERY eom_{spaceId}_data                  │
│     template + params                               │
│     → 500 GRAPH_ERROR on failure                    │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  8. Capture after_state                             │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  9-11. Fire-and-forget background tasks:            │
│   9.  Write audit log to eom_audit_log (ES)         │
│   10. Sync object document to ES write alias        │
│   11. Emit side effects (webhooks, notifications)   │
│                                                     │
│   These MUST NOT block the HTTP response.           │
│   Failures are logged but do not affect status.     │
└──────────────────────────┬──────────────────────────┘
                           │
              ▼
┌─────────────────────────────────────────────────────┐
│  12. Return ActionResult { status: SUCCESS }        │
│      HTTP 200                                       │
└─────────────────────────────────────────────────────┘
```

---

## Action Type Patterns

### Pattern 1: Status Transition

Most common pattern. Change an object's status field and record metadata.

```yaml
api_name:          approve_trade
target_object_type:trade_confirmation

submission_criteria:
  - property: status
    operator: EQUALS
    value:    PENDING_APPROVAL

edits:
  - type:     SET_PROPERTY
    property: status
    value:    APPROVED

  - type:             SET_PROPERTY
    property:         approvedAt
    value_from_param: approved_at

  - type:             SET_PROPERTY
    property:         approvedBy
    value_from_param: approved_by_id

permissions:
  required_roles: ["STEWARD", "PUBLISHER"]
```

### Pattern 2: Create Link

```yaml
api_name:          assign_to_portfolio
target_object_type:position

parameters:
  - name:       portfolio_id
    type:       String
    required:   true
    object_ref: portfolio

submission_criteria:
  - property: portfolioId
    operator: IS_NULL    # not yet assigned

edits:
  - type:                   SET_PROPERTY
    property:               portfolioId
    value_from_param:       portfolio_id

  - type:                   CREATE_LINK
    link_type:              belongs_to_portfolio
    target_id_from_param:   portfolio_id
```

### Pattern 3: Close Temporal Link and Create New One

```yaml
api_name:          transfer_department
target_object_type:employee

parameters:
  - name:     new_department_id
    type:     String
    required: true
    object_ref: department
  - name:     transfer_date
    type:     Timestamp
    required: true
  - name:     old_department_id
    type:     String
    required: true
    object_ref: department

# Note: This action uses a custom compiled Cypher template
# because temporal link close+open is complex.
# Set compiled_cypher_override: true in YAML and provide
# the template manually in action-types/transfer_department.cypher
```

Manually authored Cypher template for temporal link pattern:

```cypher
-- Transfer department: close existing link, open new one

-- Step 1: Match target employee
MATCH (emp:ObjType_employee {_eom_id: $object_id, _eom_space_id: $space_id})
WHERE emp._eom_deleted_at IS NULL

-- Step 2: Match department references
WITH emp
MATCH (old_dept:ObjType_department {_eom_id: $old_department_id, _eom_space_id: $space_id})
MATCH (new_dept:ObjType_department {_eom_id: $new_department_id, _eom_space_id: $space_id})

-- Step 3: Close the old link (set valid_to)
WITH emp, old_dept, new_dept
OPTIONAL MATCH (emp)-[old_link:LINK_WORKS_IN {valid_to: null}]->(old_dept)
SET old_link.valid_to = $transfer_date

-- Step 4: Update employee's current department property
SET emp.currentDepartmentId = $new_department_id,
    emp._last_action       = $__action_type,
    emp._last_actor        = $__actor_id,
    emp._last_action_at    = timestamp(),
    emp._eom_updated_at    = timestamp()

-- Step 5: Create new temporal link
CREATE (emp)-[:LINK_WORKS_IN {
  _link_type:  'works_in',
  _created_by: $__actor_id,
  _created_at: timestamp(),
  _action_ref: $__action_type,
  valid_from:  $transfer_date,
  valid_to:    null
}]->(new_dept)

RETURN emp._eom_id AS object_id, 'SUCCESS' AS status
```

### Pattern 4: Create New Object

```yaml
api_name:           create_position
target_object_type: position   # creates a NEW object (object_id is generated)

parameters:
  - name:     instrument_id
    type:     String
    required: true
    object_ref: instrument
  - name:     quantity
    type:     Double
    required: true
  - name:     portfolio_id
    type:     String
    required: true
    object_ref: portfolio

edits:
  - type:                  CREATE_OBJECT
    target_object_type:    position
    id_from_system: true   # system generates UUID

  - type:                  SET_PROPERTY
    property:              quantity
    value_from_param:      quantity

  - type:                  CREATE_LINK
    link_type:             holds_instrument
    target_id_from_param:  instrument_id

  - type:                  CREATE_LINK
    link_type:             belongs_to_portfolio
    target_id_from_param:  portfolio_id
```

---

## Testing Action Types

### Schema Tests (YAML assertion)

```yaml
# object-types/order/tests/schema_test.yaml
action_type: submit_order

test_cases:
  - name:         "Draft order can be submitted"
    object_state:
      status:      DRAFT
      totalAmount: 1000.0
    params:
      customer_id:  customer-test-uuid
      submitted_at: 1744000000000
    expected_outcome:
      status: SUCCESS
      object_after:
        status: SUBMITTED

  - name:         "Non-draft order cannot be submitted"
    object_state:
      status:      SUBMITTED
      totalAmount: 1000.0
    params:
      customer_id:  customer-test-uuid
      submitted_at: 1744000000000
    expected_outcome:
      status:      DENIED
      deny_reason: SUBMISSION_CRITERIA_FAILED

  - name:         "Zero amount order blocked"
    object_state:
      status:      DRAFT
      totalAmount: 0
    params:
      customer_id:  customer-test-uuid
      submitted_at: 1744000000000
    expected_outcome:
      status:      DENIED
      deny_reason: SUBMISSION_CRITERIA_FAILED
```

### Integration Test (Python pytest)

```python
# object-types/order/tests/test_submit_order.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_submit_order_success(action_service, mock_falkordb, mock_es, mock_opa):
    # Setup: OPA allows, criteria pass, graph write succeeds
    mock_opa.check_action_invoke.return_value = {"allow": True, "deny_reason": None}
    mock_falkordb.query.side_effect = [
        # Load action def
        MagicMock(result_set=[[MagicMock(properties={
            "api_name": "submit_order",
            "target_object_type": "order",
            "compiled_cypher_ref": "object-types/order/action-types/submit_order.cypher",
            "submission_criteria": [],
            "validation_rules": [],
            "side_effects": [],
        })]]),
        # Get sensitivity
        MagicMock(result_set=[["INTERNAL"]]),
        # Criteria check
        MagicMock(result_set=[["order-uuid"]]),
        # Before state
        MagicMock(result_set=[[MagicMock(properties={"status": "DRAFT"})]]),
        # Execute template
        MagicMock(result_set=[[["order-uuid", "SUCCESS"]]]),
        # After state
        MagicMock(result_set=[[MagicMock(properties={"status": "SUBMITTED"})]]),
    ]

    result = await action_service.invoke(
        space_id="space-uuid",
        action_type="submit_order",
        object_id="order-uuid",
        params={"customer_id": "cust-uuid", "submitted_at": 1744000000000},
        caller={"user_id": "user-1", "org_id": "org-1", "roles": ["EDITOR"]},
    )

    assert result.status == "SUCCESS"
    assert result.action_type == "submit_order"

@pytest.mark.asyncio
async def test_submit_order_opa_deny(action_service, mock_falkordb, mock_opa):
    mock_opa.check_action_invoke.return_value = {
        "allow": False,
        "deny_reason": "INSUFFICIENT_ROLE"
    }
    # Still needs action def and sensitivity loaded before OPA call
    mock_falkordb.query.side_effect = [
        MagicMock(result_set=[[MagicMock(properties={
            "api_name": "submit_order",
            "target_object_type": "order",
            "submission_criteria": [],
            "validation_rules": [],
        })]]),
        MagicMock(result_set=[["RESTRICTED"]]),  # sensitivity
        MagicMock(result_set=[["order-uuid"]]),   # criteria
    ]

    result = await action_service.invoke(
        space_id="space-uuid",
        action_type="submit_order",
        object_id="order-uuid",
        params={"customer_id": "cust-uuid", "submitted_at": 1744000000000},
        caller={"user_id": "user-1", "org_id": "org-1", "roles": ["VIEWER"]},
    )

    assert result.status == "DENIED"
    assert result.deny_reason == "INSUFFICIENT_ROLE"
```

---

## Action Type Governance Rules

| Rule | Enforcement |
|------|-------------|
| Every Action Type must have at least one `required_roles` entry | OPA naming policy + CI lint |
| Action Types targeting PUBLISHED Object Types cannot be deleted | OPA schema change classification → BREAKING |
| Compiled `.cypher` template must be committed alongside the YAML | CI lint checks for orphaned YAML |
| Cypher templates must not contain DDL (`CREATE INDEX`, `CREATE CONSTRAINT`) | CI Cypher linter |
| Cypher templates must not reference external URLs or shell commands | CI Cypher linter |
| `side_effects` failures must not affect `status: SUCCESS` | Enforced in Action Service code — fire-and-forget only |
| Every Action Type invocation must produce an audit log entry | Enforced in Action Service — non-optional |

---

## Undoable Actions

When `undoable: true` is set, the Action Service captures the full `before_state`
before execution and stores it in the audit log. A revert call replays the inverse:

```python
async def revert(self, space_id: str, audit_log_id: str, caller: dict) -> ActionResult:
    # 1. Load the original audit log entry from ES
    log_entry = await self._load_audit_log_entry(audit_log_id)
    if not log_entry:
        raise HTTPException(404, "Audit log entry not found")
    if not log_entry.get("before_state"):
        raise HTTPException(422, "Action was not captured as undoable")

    # 2. OPA check for revert permission
    opa_decision = await self.opa.check_action_invoke(
        action_type_api_name=f"revert_{log_entry['action_type']}",
        ...
    )

    # 3. Restore before_state via SET properties
    before = log_entry["before_state"]
    graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
    label  = f"ObjType_{log_entry['object_type']}"
    set_clause = ", ".join(f"n.{k} = ${k}" for k in before.keys()
                           if not k.startswith("_eom_"))
    cypher = (
        f"MATCH (n:{label} {{_eom_id: $id, _eom_space_id: $sid}}) "
        f"SET {set_clause}, "
        f"    n._last_action = 'revert', n._last_actor = $actor_id "
        f"RETURN n._eom_id AS object_id"
    )
    params = {**before, "id": log_entry["object_id"],
              "sid": space_id, "actor_id": caller["user_id"]}
    await asyncio.to_thread(graph.query, cypher, params)

    # 4. Async: audit log, ES sync
    ...

    return ActionResult(status="SUCCESS", action_type="revert", ...)
```

---

## Cypher Template Linting Rules

The CI pipeline runs these checks on every `.cypher` template file:

```python
CYPHER_LINT_RULES = [
    # Must have a RETURN clause
    (r'RETURN\s', "Template must have a RETURN clause"),
    # Must return object_id
    (r'object_id', "Template must return object_id"),
    # Must not contain DDL
    (r'CREATE\s+(INDEX|CONSTRAINT|DATABASE)', "DDL not allowed in action templates"),
    # Must not have hardcoded space IDs
    (r"_eom_space_id\s*=\s*'[a-f0-9-]{36}'", "Space ID must use $space_id parameter"),
    # Must use parameterised inputs only
    # (look for string literals that look like UUIDs)
    (r"_eom_id\s*=\s*'[a-f0-9-]{36}'", "Object IDs must use parameters, not literals"),
]
```
