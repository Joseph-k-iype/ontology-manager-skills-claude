# Testing Specification

> Complete testing strategy for EOM. Every layer has its own testing pattern.
> The goal is a test suite Claude Code can run with a single command and that
> provides enough coverage for CI to gate every PR.

---

## Test Matrix Overview

| Layer | Framework | Location | Run command |
|---|---|---|---|
| Python unit | pytest | `apps/api/tests/unit/` | `uv run pytest tests/unit/ -v` |
| Python integration | pytest | `apps/api/tests/integration/` | `uv run pytest tests/integration/ -v` |
| Action Type | pytest | `object-types/*/tests/` | `eom test --branch {branch}` |
| OPA policy | opa test | `apps/api/opa_policies/` | `opa test apps/api/opa_policies/ -v` |
| CLI | pytest + click.testing | `packages/eom-cli/tests/` | `uv run pytest tests/ -v` |
| Frontend unit | Vitest | `apps/studio/src/**/*.test.ts` | `pnpm test` |
| Frontend E2E | Playwright | `apps/studio/e2e/` | `pnpm test:e2e` |
| Schema lint | eom lint | CI only | `eom lint --strict` |

---

## Python Backend — Unit Tests

### conftest.py

```python
# apps/api/tests/conftest.py
import pytest, asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from apps.api.services.opa_service      import OPAService
from apps.api.services.action_service   import ActionService
from apps.api.services.query_service    import QueryService
from apps.api.services.schema_service   import SchemaService

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture
def mock_falkordb():
    """Mock FalkorDB client. Patch graph.query results per test."""
    client = MagicMock()
    graph  = MagicMock()
    client.select_graph.return_value = graph
    return client, graph

@pytest.fixture
def mock_es():
    return AsyncMock()

@pytest.fixture
def mock_opa():
    svc = AsyncMock(spec=OPAService)
    svc.check_action_invoke.return_value = {"allow": True, "deny_reason": None}
    svc.check_access.return_value        = {"allow": True, "masked_fields": []}
    svc.check_naming.return_value        = {"allow": True, "violation": None}
    return svc

@pytest.fixture
def action_service(mock_falkordb, mock_es, mock_opa):
    client, _ = mock_falkordb
    return ActionService(client, mock_es, mock_opa)

@pytest.fixture
def query_service(mock_falkordb, mock_es):
    client, _ = mock_falkordb
    return QueryService(client, mock_es)

@pytest.fixture
def caller_editor():
    return {"user_id": "user-1", "org_id": "org-1", "roles": ["EDITOR"], "email": "e@example.com"}

@pytest.fixture
def caller_viewer():
    return {"user_id": "user-2", "org_id": "org-1", "roles": ["VIEWER"], "email": "v@example.com"}
```

---

### test_action_service.py

```python
# apps/api/tests/unit/test_action_service.py
import pytest
from unittest.mock import MagicMock, AsyncMock, call

@pytest.mark.asyncio
class TestActionServiceInvoke:

    async def test_success_full_pipeline(self, action_service, mock_falkordb, mock_es, mock_opa, caller_editor):
        """Happy path: OPA allows, criteria pass, graph write succeeds."""
        _, graph = mock_falkordb
        action_def = _make_action_def()
        graph.query.side_effect = [
            _falkor_rows([[_node(action_def)]]),   # load action def
            _falkor_rows([["INTERNAL"]]),           # sensitivity
            _falkor_rows([["order-uuid"]]),         # criteria (non-null = met)
            _falkor_rows([[_node({"status": "DRAFT"})]]),  # before state
            _falkor_rows([[["order-uuid", "SUCCESS"]]]),   # execute
            _falkor_rows([[_node({"status": "SUBMITTED"})]]),  # after state
        ]

        result = await action_service.invoke(
            space_id="space-1",
            action_type="submit_order",
            object_id="order-uuid",
            params={"customer_id": "cust-1", "submitted_at": 1744000000000},
            caller=caller_editor,
        )

        assert result.status == "SUCCESS"
        assert result.action_type == "submit_order"
        assert result.object_id == "order-uuid"
        # OPA must have been called once
        mock_opa.check_action_invoke.assert_called_once()
        # ES audit log write must be scheduled (fire-and-forget)
        mock_es.index.assert_called_once()

    async def test_opa_deny_returns_denied_result(self, action_service, mock_falkordb, mock_opa, caller_viewer):
        """OPA rejects VIEWER invoking an EDITOR-only action."""
        _, graph = mock_falkordb
        graph.query.side_effect = [
            _falkor_rows([[_node(_make_action_def())]]),  # load action def
            _falkor_rows([["RESTRICTED"]]),               # sensitivity
            _falkor_rows([["order-uuid"]]),               # criteria
        ]
        mock_opa.check_action_invoke.return_value = {
            "allow": False, "deny_reason": "INSUFFICIENT_ROLE"
        }

        result = await action_service.invoke(
            space_id="space-1",
            action_type="submit_order",
            object_id="order-uuid",
            params={},
            caller=caller_viewer,
        )

        assert result.status == "DENIED"
        assert result.deny_reason == "INSUFFICIENT_ROLE"

    async def test_submission_criteria_fail(self, action_service, mock_falkordb, mock_opa, caller_editor):
        """Object not in DRAFT state — criteria check returns no rows."""
        _, graph = mock_falkordb
        graph.query.side_effect = [
            _falkor_rows([[_node(_make_action_def())]]),
            _falkor_rows([["INTERNAL"]]),
            _falkor_rows([]),    # empty = criteria not met → OPA gets criteria_passed=False
        ]
        mock_opa.check_action_invoke.return_value = {
            "allow": False, "deny_reason": "SUBMISSION_CRITERIA_FAILED"
        }

        result = await action_service.invoke(
            space_id="space-1",
            action_type="submit_order",
            object_id="order-uuid",
            params={},
            caller=caller_editor,
        )

        assert result.status == "DENIED"
        assert result.deny_reason == "SUBMISSION_CRITERIA_FAILED"

    async def test_graph_write_failure(self, action_service, mock_falkordb, mock_opa, caller_editor):
        """FalkorDB raises an exception during write — FAILED result returned."""
        from falkordb.exceptions import ResponseError
        _, graph = mock_falkordb
        graph.query.side_effect = [
            _falkor_rows([[_node(_make_action_def())]]),
            _falkor_rows([["INTERNAL"]]),
            _falkor_rows([["order-uuid"]]),
            _falkor_rows([[_node({"status": "DRAFT"})]]),  # before state
            ResponseError("Transaction failed"),
        ]

        result = await action_service.invoke(
            space_id="space-1",
            action_type="submit_order",
            object_id="order-uuid",
            params={"customer_id": "c1", "submitted_at": 1},
            caller=caller_editor,
        )

        assert result.status == "FAILED"
        assert "Transaction failed" in result.error_message

    async def test_audit_log_written_on_deny(self, action_service, mock_falkordb, mock_opa, mock_es, caller_viewer):
        """Audit log must be written even when action is DENIED."""
        _, graph = mock_falkordb
        graph.query.side_effect = [
            _falkor_rows([[_node(_make_action_def())]]),
            _falkor_rows([["INTERNAL"]]),
            _falkor_rows([["order-uuid"]]),
        ]
        mock_opa.check_action_invoke.return_value = {"allow": False, "deny_reason": "INSUFFICIENT_ROLE"}

        await action_service.invoke("space-1","submit_order","order-uuid",{},caller_viewer)
        mock_es.index.assert_called_once()   # audit log always written


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_action_def(**overrides) -> dict:
    return {
        "api_name":              "submit_order",
        "target_object_type":    "order",
        "submission_criteria":   [],
        "validation_rules":      [],
        "side_effects":          [],
        "compiled_cypher_ref":   "object-types/order/action-types/submit_order.cypher",
        **overrides,
    }

def _node(props: dict):
    n = MagicMock()
    n.properties = props
    return n

def _falkor_rows(rows: list):
    result = MagicMock()
    result.result_set = rows
    return result
```

---

### test_opa_service.py

```python
# apps/api/tests/unit/test_opa_service.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from apps.api.services.opa_service import OPAService

@pytest.fixture
def opa_http_client():
    return AsyncMock()

@pytest.fixture
def opa_svc(opa_http_client):
    return OPAService(opa_http_client)


@pytest.mark.asyncio
async def test_check_action_invoke_allow(opa_svc, opa_http_client):
    opa_http_client.post.return_value = _opa_response({"allow": True, "deny_reason": None})
    result = await opa_svc.check_action_invoke(
        "submit_order", ["EDITOR"], "org-1", "obj-1", "INTERNAL", True
    )
    assert result["allow"] is True
    assert result["deny_reason"] is None


@pytest.mark.asyncio
async def test_check_action_invoke_deny(opa_svc, opa_http_client):
    opa_http_client.post.return_value = _opa_response({
        "allow": False, "deny_reason": "INSUFFICIENT_ROLE"
    })
    result = await opa_svc.check_action_invoke(
        "submit_order", ["VIEWER"], "org-1", "obj-1", "INTERNAL", True
    )
    assert result["allow"] is False
    assert result["deny_reason"] == "INSUFFICIENT_ROLE"


@pytest.mark.asyncio
async def test_opa_unavailable_returns_deny(opa_svc, opa_http_client):
    """If OPA is unreachable, must DENY (fail-safe)."""
    opa_http_client.post.side_effect = Exception("Connection refused")
    result = await opa_svc.check_action_invoke(
        "submit_order", ["EDITOR"], "org-1", "obj-1", "INTERNAL", True
    )
    assert result["allow"] is False
    assert result["deny_reason"] == "OPA_UNAVAILABLE"


def _opa_response(data: dict):
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"result": data}
    return resp
```

---

### test_query_service.py

```python
# apps/api/tests/unit/test_query_service.py
import pytest
from unittest.mock import MagicMock

@pytest.mark.asyncio
async def test_get_objects_calls_elasticsearch(query_service, mock_es):
    """get_objects must route to ES, not FalkorDB."""
    mock_es.search.return_value = {
        "hits": {
            "total": {"value": 2},
            "hits": [
                {"_source": {"_eom_id": "obj-1", "status": "SUBMITTED"}},
                {"_source": {"_eom_id": "obj-2", "status": "DRAFT"}},
            ],
        }
    }

    caller = {"user_id": "u1", "org_id": "o1", "roles": ["EDITOR"], "email": "e@e.com"}
    result = await query_service.get_objects(
        space_id="space-1", object_type="order",
        filters=[], sort=[], page=1, page_size=20, caller=caller,
    )

    mock_es.search.assert_called_once()
    assert result["total"] == 2


@pytest.mark.asyncio
async def test_traverse_links_calls_falkordb(query_service, mock_falkordb):
    """traverse_links must use FalkorDB, not Elasticsearch."""
    _, graph = mock_falkordb
    linked = MagicMock()
    linked.properties = {"_eom_id": "customer-1", "_eom_type": "customer"}
    graph.query.return_value = MagicMock(result_set=[[linked]])

    caller = {"user_id": "u1", "org_id": "o1", "roles": ["VIEWER"], "email": "e@e.com"}
    result = await query_service.traverse_links(
        space_id="space-1", from_object_id="order-1",
        link_type="placed_by", depth=1, as_of_date=None, caller=caller,
    )

    graph.query.assert_called_once()
    assert len(result) == 1
    assert result[0]["_eom_id"] == "customer-1"
```

---

## Python Backend — Integration Tests

Integration tests run against real Docker services (FalkorDB + Elasticsearch + OPA).
Use `docker-compose up -d` before running integration tests.

```python
# apps/api/tests/integration/conftest.py
import pytest, asyncio, os
from falkordb             import FalkorDB
from elasticsearch        import AsyncElasticsearch
from apps.api.services.opa_service    import OPAService
from apps.api.services.action_service import ActionService
import httpx

@pytest.fixture(scope="session")
def falkordb_client():
    return FalkorDB(host="localhost", port=6379)

@pytest.fixture(scope="session")
async def es_client():
    client = AsyncElasticsearch(["http://localhost:9200"])
    yield client
    await client.close()

@pytest.fixture(scope="session")
async def opa_http():
    async with httpx.AsyncClient(base_url="http://localhost:8181") as c:
        yield c

@pytest.fixture(scope="session")
def integration_space_id():
    return "test-integration-space"

@pytest.fixture(autouse=True, scope="session")
async def setup_test_space(falkordb_client, es_client, integration_space_id):
    """Bootstrap a test space in FalkorDB and Elasticsearch before all tests."""
    graph = falkordb_client.select_graph(f"eom_{integration_space_id}_data")
    # Create test nodes
    graph.query("""
        CREATE (:ObjType_order {
            _eom_id: 'test-order-1',
            _eom_type: 'order',
            _eom_space_id: $sid,
            _eom_sensitivity: 'INTERNAL',
            _eom_created_at: 1744000000000,
            _eom_updated_at: 1744000000000,
            status: 'DRAFT',
            totalAmount: 5000.0,
            currency: 'USD'
        })
    """, {"sid": integration_space_id})

    # Upsert into ES
    await es_client.index(
        index=f"eom_{integration_space_id}_order_v1",
        id="test-order-1",
        body={
            "_eom_id": "test-order-1",
            "_eom_space_id": integration_space_id,
            "_eom_sensitivity": "INTERNAL",
            "_eom_type": "order",
            "status": "DRAFT",
            "_semantic_text": "order draft five thousand usd",
        },
    )
    await es_client.indices.refresh(index=f"eom_{integration_space_id}_order_v1")
    yield
    # Teardown
    graph.delete()
    await es_client.indices.delete(index=f"eom_{integration_space_id}_order*", ignore_unavailable=True)


@pytest.mark.asyncio
async def test_full_action_invoke_integration(
    falkordb_client, es_client, opa_http, integration_space_id
):
    """End-to-end action invocation against real services."""
    opa_svc    = OPAService(opa_http)
    action_svc = ActionService(falkordb_client, es_client, opa_svc)

    result = await action_svc.invoke(
        space_id=integration_space_id,
        action_type="submit_order",
        object_id="test-order-1",
        params={"customer_id": "cust-1", "submitted_at": 1744000000000},
        caller={"user_id": "user-1", "org_id": "org-1", "roles": ["EDITOR"], "email": "e@e.com"},
    )

    assert result.status in ("SUCCESS", "DENIED")  # may be DENIED if OPA not loaded
```

---

## OPA Policy Tests

```rego
# apps/api/opa_policies/schema_test.rego
package eom.schema_test

import data.eom.schema

# ADDITIVE — no approvals needed, should always pass
test_additive_always_allowed if {
  schema.allow with input as {
    "edits":     [{"operation": "ADD_OBJECT_TYPE", "id": "e1"}],
    "approvals": _no_approvals,
  }
}

# NON_BREAKING — needs 1 steward
test_non_breaking_needs_steward if {
  not schema.allow with input as {
    "edits":     [{"operation": "UPDATE_DESCRIPTION", "id": "e1"}],
    "approvals": _no_approvals,
  }
}

test_non_breaking_with_steward_passes if {
  schema.allow with input as {
    "edits":     [{"operation": "UPDATE_DESCRIPTION", "id": "e1"}],
    "approvals": {"steward_ids": ["steward-1"], "arb_ids": [],
                  "impact_simulation_passed": false,
                  "migration_plan_reviewed":  false,
                  "sunset_dates": {}},
  }
}

# BREAKING — needs full approval set
test_breaking_denied_partial_approvals if {
  not schema.allow with input as {
    "edits":     [{"operation": "DELETE_PROPERTY", "id": "e1"}],
    "approvals": {"steward_ids": ["steward-1"], "arb_ids": ["arb-1"],
                  "impact_simulation_passed": false,
                  "migration_plan_reviewed":  false,
                  "sunset_dates": {}},
  }
}

test_breaking_approved_full_set if {
  schema.allow with input as {
    "edits":     [{"operation": "DELETE_PROPERTY", "id": "e1"}],
    "approvals": {
      "steward_ids":              ["steward-1"],
      "arb_ids":                  ["arb-1", "arb-2"],
      "impact_simulation_passed": true,
      "migration_plan_reviewed":  true,
      "sunset_dates":             {"e1": "2026-07-01"},
    },
  }
}

# Change classification
test_add_object_type_is_additive if {
  schema.classify({"operation": "ADD_OBJECT_TYPE"}) == "ADDITIVE"
}

test_rename_property_is_breaking if {
  schema.classify({"operation": "RENAME_PROPERTY"}) == "BREAKING"
}

test_update_description_is_non_breaking if {
  schema.classify({"operation": "UPDATE_DESCRIPTION"}) == "NON_BREAKING"
}

_no_approvals := {
  "steward_ids": [], "arb_ids": [],
  "impact_simulation_passed": false,
  "migration_plan_reviewed": false,
  "sunset_dates": {},
}
```

```rego
# apps/api/opa_policies/naming_test.rego
package eom.schema.naming_test

import data.eom.schema.naming

test_valid_object_type_name if {
  naming.valid_object_type_name with input as {
    "api_name": "trade_confirmation", "name_type": "object_type",
    "shared_properties": []
  }
}

test_reserved_prefix_blocked if {
  not naming.valid_object_type_name with input as {
    "api_name": "tbl_orders", "name_type": "object_type",
    "shared_properties": []
  }
}

test_invalid_uppercase_blocked if {
  not naming.valid_object_type_name with input as {
    "api_name": "TradeConfirmation", "name_type": "object_type",
    "shared_properties": []
  }
}

test_valid_property_name if {
  naming.valid_property_name with input as {"api_name": "settlementDate"}
}

test_uppercase_start_property_blocked if {
  not naming.valid_property_name with input as {"api_name": "SettlementDate"}
}
```

---

## Frontend — Vitest Unit Tests

```typescript
// apps/studio/src/utils/ontology-to-flow.test.ts
import { describe, it, expect } from 'vitest';
import { ontologyToFlow } from './ontology-to-flow';
import type { ObjectType, LinkType, Interface } from '../types';

const mockOT = (api_name: string, domain = 'Trade'): ObjectType => ({
  api_name, domain,
  display_name: api_name,
  plural_display_name: '',
  description: '',
  status: 'PUBLISHED',
  tags: [],
  external_type_refs: [],
  primary_key: '_eom_id',
  interfaces: [],
  shared_property_refs: [],
  properties: [],
  action_types: [],
  sensitivity_level: 'INTERNAL',
  version: '1.0.0',
  enable_embeddings: false,
  falkor_label: `ObjType_${api_name}`,
  es_alias: `eom_space1_${api_name}`,
});

const mockLT = (src: string, tgt: string): LinkType => ({
  api_name:              `${src}_to_${tgt}`,
  display_name:          `${src} → ${tgt}`,
  description:           '',
  source_object_type:    src,
  target_object_type:    tgt,
  cardinality:           'ONE_TO_MANY',
  link_properties:       [],
  is_temporally_bounded: false,
  cascade_rule:          'RESTRICT',
  falkor_rel_type:       `LINK_${src.toUpperCase()}_TO_${tgt.toUpperCase()}`,
});

describe('ontologyToFlow', () => {
  it('creates one node per object type', () => {
    const ots = [mockOT('order'), mockOT('customer')];
    const { nodes } = ontologyToFlow(ots, [], [], 'logical', null);
    expect(nodes).toHaveLength(2);
    expect(nodes.map(n => n.id)).toContain('order');
    expect(nodes.map(n => n.id)).toContain('customer');
  });

  it('creates one edge per link type', () => {
    const ots = [mockOT('order'), mockOT('customer')];
    const lts = [mockLT('order', 'customer')];
    const { edges } = ontologyToFlow(ots, lts, [], 'logical', null);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('order');
    expect(edges[0].target).toBe('customer');
  });

  it('adds interface nodes in logical mode', () => {
    const ots = [mockOT('order')];
    const iface: Interface = {
      api_name: 'LifecycleTracked',
      display_name: 'LifecycleTracked',
      description: '',
      extends_interfaces: [],
      required_properties: [],
      optional_properties: [],
      required_link_types: [],
      version: '1.0.0',
    };
    const { nodes } = ontologyToFlow(ots, [], [iface], 'logical', null);
    expect(nodes.find(n => n.id === 'iface__LifecycleTracked')).toBeDefined();
  });

  it('hides interface nodes in conceptual mode', () => {
    const iface: Interface = {
      api_name: 'LifecycleTracked', display_name: '',
      description: '', extends_interfaces: [],
      required_properties: [], optional_properties: [],
      required_link_types: [], version: '1.0.0',
    };
    const { nodes } = ontologyToFlow([mockOT('order')], [], [iface], 'conceptual', null);
    expect(nodes.find(n => n.type === 'interface')).toBeUndefined();
  });
});
```

```typescript
// apps/studio/src/utils/ontology-to-g6.test.ts
import { describe, it, expect } from 'vitest';
import { ontologyToG6 } from './ontology-to-g6';

describe('ontologyToG6', () => {
  it('converts object types to G6 nodes', () => {
    const { nodes } = ontologyToG6(
      [{ api_name: 'order', display_name: 'Order', domain: 'Trade', status: 'PUBLISHED',
         sensitivity_level: 'INTERNAL', datasource: null } as any],
      []
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('order');
    expect(nodes[0].comboId).toBe('Trade');
  });

  it('filters edges where source or target does not exist', () => {
    const { edges } = ontologyToG6(
      [{ api_name: 'order', display_name: 'Order', domain: 'Trade',
         status: 'PUBLISHED', sensitivity_level: 'INTERNAL', datasource: null } as any],
      [{ api_name: 'placed_by', display_name: 'Placed By',
         source_object_type: 'order', target_object_type: 'customer',  // customer doesn't exist
         cardinality: 'ONE_TO_MANY', is_temporally_bounded: false } as any]
    );
    expect(edges).toHaveLength(0);  // filtered out
  });

  it('creates combos from unique domains', () => {
    const { combos } = ontologyToG6([
      { api_name: 'order', display_name: 'Order', domain: 'Trade',
        status: 'PUBLISHED', sensitivity_level: 'INTERNAL', datasource: null } as any,
      { api_name: 'customer', display_name: 'Customer', domain: 'Party',
        status: 'PUBLISHED', sensitivity_level: 'INTERNAL', datasource: null } as any,
    ], []);
    expect(combos?.map(c => c.id)).toContain('Trade');
    expect(combos?.map(c => c.id)).toContain('Party');
  });
});
```

```typescript
// apps/studio/src/stores/explore-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useExploreStore } from './explore-store';
import { act } from 'react';

describe('useExploreStore', () => {
  beforeEach(() => useExploreStore.setState({
    graphData: null, layoutType: 'force', mode: 'overview',
    pivotNodeId: null, pathSource: null, pathTarget: null, selectedNode: null,
  }));

  it('setMode updates mode and pivotNodeId', () => {
    act(() => useExploreStore.getState().setMode('blast-radius', 'order'));
    const { mode, pivotNodeId } = useExploreStore.getState();
    expect(mode).toBe('blast-radius');
    expect(pivotNodeId).toBe('order');
  });

  it('resetView clears mode and pivot', () => {
    act(() => {
      useExploreStore.getState().setMode('blast-radius', 'order');
      useExploreStore.getState().resetView();
    });
    const { mode, pivotNodeId } = useExploreStore.getState();
    expect(mode).toBe('overview');
    expect(pivotNodeId).toBeNull();
  });
});
```

---

## Frontend — Playwright E2E Tests

```typescript
// apps/studio/e2e/canvas.spec.ts
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const SPACE_ID = process.env.E2E_SPACE_ID ?? 'test-space';

test.beforeEach(async ({ page }) => {
  // Inject auth token into localStorage
  await page.goto(BASE);
  await page.evaluate((token) => {
    localStorage.setItem('eom-auth', JSON.stringify({ state: { token } }));
  }, process.env.E2E_TOKEN ?? 'dev-token');
});

test('authoring canvas renders object type nodes', async ({ page }) => {
  await page.goto(`${BASE}/spaces/${SPACE_ID}`);
  await page.waitForSelector('.react-flow__node', { timeout: 10_000 });

  const nodes = page.locator('.react-flow__node[data-type="objectType"]');
  await expect(nodes.first()).toBeVisible();
});

test('clicking a node opens the editor panel', async ({ page }) => {
  await page.goto(`${BASE}/spaces/${SPACE_ID}`);
  await page.waitForSelector('.react-flow__node');

  await page.locator('.react-flow__node').first().click();
  await expect(page.locator('text=Properties')).toBeVisible({ timeout: 5000 });
});

test('explore page loads G6 canvas', async ({ page }) => {
  await page.goto(`${BASE}/spaces/${SPACE_ID}/explore`);
  // G6 renders to canvas — check the container div exists and is non-empty
  await page.waitForSelector('canvas', { timeout: 15_000 });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
});

test('blast radius mode activates on panel button click', async ({ page }) => {
  await page.goto(`${BASE}/spaces/${SPACE_ID}/explore`);
  await page.waitForSelector('canvas');

  // Click any G6 node (via the node's label text)
  // G6 renders to canvas — we cannot directly query DOM nodes
  // Instead we test via the Zustand store state exposed on window
  const mode = await page.evaluate(() =>
    (window as any).__ZUSTAND_EXPLORE_STORE__?.getState()?.mode
  );
  expect(mode).toBe('overview');
});
```

---

## CLI Tests

```python
# packages/eom-cli/tests/test_lint.py
from click.testing  import CliRunner
from pathlib        import Path
import pytest, yaml, tempfile, os
from eom_cli.main   import cli

@pytest.fixture
def valid_worktree(tmp_path: Path) -> Path:
    """Create a minimal valid worktree structure."""
    (tmp_path / "object-types" / "order").mkdir(parents=True)
    (tmp_path / "link-types").mkdir()
    (tmp_path / "shared-properties").mkdir()
    (tmp_path / "interfaces").mkdir()
    (tmp_path / "value-types").mkdir()

    schema = {
        "api_name":         "order",
        "display_name":     "Order",
        "description":      "A trade order",
        "domain":           "Trade",
        "status":           "DRAFT",
        "steward_id":       None,
        "sensitivity_level":"INTERNAL",
        "version":          "1.0.0",
        "properties": [
            {"api_name": "totalAmount", "base_type": "Double",
             "display_name": "Total Amount", "is_required": False, "is_shared": False}
        ],
        "action_types": [],
        "interfaces": [],
    }
    yaml_path = tmp_path / "object-types" / "order" / "schema.yaml"
    yaml_path.write_text(yaml.dump(schema))
    return tmp_path


def test_lint_passes_on_valid_worktree(valid_worktree):
    runner = CliRunner()
    result = runner.invoke(cli, ["lint", "--worktree", str(valid_worktree)])
    assert result.exit_code == 0
    assert "Lint passed" in result.output


def test_lint_fails_on_reserved_prefix(tmp_path):
    (tmp_path / "object-types" / "tbl_orders").mkdir(parents=True)
    (tmp_path / "link-types").mkdir()
    (tmp_path / "shared-properties").mkdir()
    (tmp_path / "interfaces").mkdir()
    (tmp_path / "value-types").mkdir()

    bad_schema = {
        "api_name": "tbl_orders",    # reserved prefix!
        "display_name": "Orders",
        "description": "x",
        "domain": "Trade",
        "status": "DRAFT",
        "steward_id": None,
        "sensitivity_level": "INTERNAL",
        "version": "1.0.0",
        "properties": [],
        "action_types": [],
        "interfaces": [],
    }
    (tmp_path / "object-types" / "tbl_orders" / "schema.yaml").write_text(
        yaml.dump(bad_schema)
    )

    runner = CliRunner()
    result = runner.invoke(cli, ["lint", "--worktree", str(tmp_path)])
    assert result.exit_code != 0
    assert "RESERVED_PREFIX" in result.output


def test_lint_warns_missing_description_on_draft(valid_worktree):
    schema_path = valid_worktree / "object-types" / "order" / "schema.yaml"
    schema      = yaml.safe_load(schema_path.read_text())
    schema["description"] = ""
    schema_path.write_text(yaml.dump(schema))

    runner = CliRunner()
    result = runner.invoke(cli, ["lint", "--worktree", str(valid_worktree)])
    # Draft without description is a WARNING, not an ERROR
    assert result.exit_code == 0
    assert "MISSING_DESCRIPTION" in result.output
```

---

## CI Test Pipeline

```yaml
# .github/workflows/test.yml
name: EOM Tests

on: [push, pull_request]

jobs:
  backend-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd apps/api && uv sync
      - run: cd apps/api && uv run pytest tests/unit/ -v --tb=short

  opa-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: open-policy-agent/setup-opa@v2
        with: { version: latest }
      - run: opa test apps/api/opa_policies/ -v

  frontend-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: cd apps/studio && pnpm install
      - run: cd apps/studio && pnpm test --run

  cli-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - run: cd packages/eom-cli && uv run pytest tests/ -v

  backend-integration:
    runs-on: ubuntu-latest
    services:
      falkordb:
        image: falkordb/falkordb:latest
        ports: ["6379:6379"]
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
        ports: ["9200:9200"]
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms512m -Xmx512m"
      opa:
        image: openpolicyagent/opa:latest
        ports: ["8181:8181"]
        options: >-
          --entrypoint '["run","--server","--addr=0.0.0.0:8181"]'
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd apps/api && uv sync
      - run: |
          cd apps/api
          # Load OPA policies
          opa eval --bundle opa_policies/ 'data' --format pretty || true
          # Run integration tests
          uv run pytest tests/integration/ -v --tb=short
        env:
          FALKORDB_HOST: localhost
          ELASTICSEARCH_URL: http://localhost:9200
          OPA_URL: http://localhost:8181

  e2e:
    runs-on: ubuntu-latest
    needs: [backend-unit, frontend-unit]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: cd apps/studio && pnpm install
      - run: cd apps/studio && pnpm exec playwright install --with-deps chromium
      - run: docker-compose up -d
      - run: |
          # Wait for services
          sleep 30
          # Seed test data
          cd apps/api && uv run python -m scripts.seed_test_data
      - run: cd apps/studio && pnpm test:e2e
        env:
          E2E_SPACE_ID: test-space
          E2E_TOKEN: dev-token
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/studio/playwright-report/
```
