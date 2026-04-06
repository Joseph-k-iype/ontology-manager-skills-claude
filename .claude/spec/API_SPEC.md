# API Specification

> Complete REST API contract and GraphQL schema for EOM.
> All endpoints require a Bearer JWT unless noted otherwise.
> Error shape is always `{ detail: string | { code, message, ... } }`.

---

## REST API — Full Endpoint Reference

### Authentication

```
Authorization: Bearer <jwt>
```

JWT payload must contain:
```json
{
  "sub":    "user-uuid",
  "org_id": "org-uuid",
  "roles":  ["VIEWER", "EDITOR"],
  "email":  "user@example.com",
  "aud":    "http://eom-api"
}
```

---

### Spaces

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET`  | `/api/v1/spaces` | List all accessible Spaces | Any role |
| `POST` | `/api/v1/spaces` | Create a new Space | ORG_ADMIN |
| `GET`  | `/api/v1/spaces/{spaceId}` | Get Space details | VIEWER+ |
| `PATCH`| `/api/v1/spaces/{spaceId}` | Update Space metadata | ADMIN |
| `GET`  | `/api/v1/spaces/{spaceId}/ontology` | Get full ontology manifest | VIEWER+ |
| `POST` | `/api/v1/spaces/{spaceId}/export` | Export ontology | VIEWER+ |
| `POST` | `/api/v1/spaces/{spaceId}/import` | Import external package | PUBLISHER |

#### `POST /api/v1/spaces` Request

```json
{
  "name":           "Global Trade Operations",
  "description":    "Semantic model for trade lifecycle",
  "visibility":     "SHARED",
  "owning_org_id":  "a1b2c3d4-...",
  "member_org_ids": ["e5f6g7h8-..."],
  "tier":           "DOMAIN"
}
```

#### `POST /api/v1/spaces` Response `201`

```json
{
  "id":            "space-uuid",
  "name":          "Global Trade Operations",
  "visibility":    "SHARED",
  "owning_org_id": "a1b2c3d4-...",
  "tier":          "DOMAIN",
  "created_at":    "2026-04-06T10:00:00Z"
}
```

#### `POST /api/v1/spaces/{spaceId}/export` Request

```json
{ "format": "yaml" }
```

Supported formats: `yaml`, `jsonld`, `turtle`, `avro`, `graphql`

---

### Object Types

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/spaces/{spaceId}/object-types` | List all Object Types in Space |
| `GET`  | `/api/v1/spaces/{spaceId}/object-types/{apiName}` | Get Object Type schema |
| `GET`  | `/api/v1/spaces/{spaceId}/object-types/{apiName}/volume` | Volume metrics |
| `GET`  | `/api/v1/spaces/{spaceId}/shared-properties` | List Shared Property Registry |
| `GET`  | `/api/v1/spaces/{spaceId}/interfaces` | List Interfaces |

#### `GET /api/v1/spaces/{spaceId}/object-types` Response

```json
{
  "items": [
    {
      "api_name":       "order",
      "display_name":   "Order",
      "status":         "PUBLISHED",
      "domain":         "Trade",
      "version":        "3.1.0",
      "properties_count": 12,
      "action_types_count": 4,
      "has_datasource": true,
      "sensitivity_level": "INTERNAL"
    }
  ],
  "total": 47
}
```

---

### Objects (Instances)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/spaces/{spaceId}/objects/{objectType}` | List objects (ES) |
| `GET`  | `/api/v1/spaces/{spaceId}/objects/{objectType}/{objectId}` | Get single object |
| `GET`  | `/api/v1/spaces/{spaceId}/objects/{objectType}/{objectId}/links/{linkType}` | Traverse links |

#### `GET /api/v1/spaces/{spaceId}/objects/{objectType}` Query Params

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | — | Filter by status field |
| `tag` | string[] | — | Filter by tags |
| `page` | int | 1 | Page number |
| `page_size` | int | 20 | Items per page (max 200) |
| `sort_field` | string | `_eom_created_at` | Sort field |
| `sort_dir` | string | `desc` | `asc` or `desc` |

#### Response

```json
{
  "items": [
    {
      "_eom_id":          "obj-uuid",
      "_eom_type":        "order",
      "_eom_created_at":  1744000000000,
      "_eom_sensitivity": "INTERNAL",
      "status":           "SUBMITTED",
      "totalAmount":      150000.00,
      "currency":         "USD",
      "submittedAt":      1744000000000
    }
  ],
  "total":    1248,
  "page":     1,
  "page_size":20
}
```

#### `GET .../links/{linkType}` Query Params

| Param | Type | Default |
|-------|------|---------|
| `depth` | int | 1 |
| `as_of_date` | ISO 8601 | now |

---

### Semantic Search

#### `POST /api/v1/spaces/{spaceId}/search`

```json
{
  "query":         "outstanding trade confirmations pending settlement",
  "object_types":  ["order", "trade_confirmation"],
  "filters": [
    { "term": { "status": "SUBMITTED" } }
  ],
  "k":             20,
  "use_embeddings":true
}
```

#### Response

```json
{
  "results": [
    {
      "id":          "obj-uuid",
      "score":       0.93,
      "final_score": 1.02,
      "object_type": "trade_confirmation",
      "source": {
        "_eom_id":        "obj-uuid",
        "confirmationRef":"TC-2026-001",
        "status":         "PENDING",
        "settlementDate": "2026-04-08",
        "_linked_ids":    ["counterparty-uuid", "account-uuid"]
      }
    }
  ],
  "total": 20
}
```

---

### Actions

#### `POST /api/v1/spaces/{spaceId}/actions/{actionType}/invoke`

```json
{
  "object_id": "order-uuid",
  "params": {
    "customer_id":   "customer-uuid",
    "submitted_at":  1744000000000
  }
}
```

#### Response `200`

```json
{
  "event_id":    "audit-uuid",
  "action_type": "submit_order",
  "object_id":   "order-uuid",
  "object_type": "order",
  "actor_id":    "user-uuid",
  "status":      "SUCCESS",
  "timestamp":   "2026-04-06T10:00:00Z",
  "duration_ms": 87
}
```

#### Response `403` (OPA deny)

```json
{
  "detail": {
    "code":        "OPA_DENY",
    "reason":      "SUBMISSION_CRITERIA_FAILED",
    "action_type": "submit_order",
    "object_id":   "order-uuid"
  }
}
```

#### Response `422` (validation failure)

```json
{
  "detail": {
    "code":              "ACTION_FAILED",
    "validation_errors": ["Order must have at least one line item before submission"]
  }
}
```

---

### Branches & Proposals

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/spaces/{spaceId}/branches` | List branches |
| `POST` | `/api/v1/spaces/{spaceId}/branches` | Create branch |
| `DELETE`| `/api/v1/spaces/{spaceId}/branches/{branch}` | Delete branch |
| `POST` | `/api/v1/spaces/{spaceId}/branches/{branch}/rebase` | Rebase onto main |
| `GET`  | `/api/v1/spaces/{spaceId}/branches/{branch}/diff` | Get semantic diff |
| `POST` | `/api/v1/spaces/{spaceId}/proposals` | Open proposal (PR) |
| `GET`  | `/api/v1/spaces/{spaceId}/proposals` | List proposals |
| `GET`  | `/api/v1/spaces/{spaceId}/proposals/{prId}` | Get proposal |
| `GET`  | `/api/v1/spaces/{spaceId}/proposals/{prId}/impact` | Impact analysis |
| `POST` | `/api/v1/spaces/{spaceId}/proposals/{prId}/approve` | Submit approval |
| `POST` | `/api/v1/spaces/{spaceId}/proposals/{prId}/merge` | Merge proposal |

#### `POST /api/v1/spaces/{spaceId}/branches`

```json
{
  "branch_name": "feat/add-settlement-type",
  "description": "Add settlement type classification to trade confirmation"
}
```

#### `GET /api/v1/spaces/{spaceId}/branches/{branch}/diff` Response

```json
{
  "space_id":    "space-uuid",
  "base":        "main",
  "head":        "feat/add-settlement-type",
  "change_class":"ADDITIVE",
  "edits": [
    {
      "operation":  "ADD_OPTIONAL_PROPERTY",
      "api_name":   "trade_confirmation",
      "property":   "settlementType",
      "base_type":  "String"
    }
  ]
}
```

---

### Health & Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/spaces/{spaceId}/health` | Ontology Health Score |
| `POST` | `/api/v1/spaces/{spaceId}/health/recompute` | Trigger recompute |
| `GET`  | `/api/v1/spaces/{spaceId}/metrics` | Volume + index metrics |
| `GET`  | `/api/v1/spaces/{spaceId}/metrics/{objectType}` | Per-type metrics |

---

### Global Registries

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/shared-properties` | List global Shared Properties |
| `GET`  | `/api/v1/marketplace/packages` | Browse published packages |
| `POST` | `/api/v1/marketplace/packages/{id}/import` | Import package into Space |

---

## WebSocket Events

```
WS /api/v1/spaces/{spaceId}/objects/{objectType}/subscribe
```

Client message to subscribe to specific objects:
```json
{ "type": "subscribe", "object_ids": ["uuid1", "uuid2"] }
```

Server pushes on every successful action execution:
```json
{
  "type":        "object_updated",
  "object_id":   "uuid1",
  "object_type": "order",
  "action_type": "submit_order",
  "actor_id":    "user-uuid",
  "timestamp":   1744000000000,
  "fields_changed": ["status", "submittedAt"]
}
```

---

## GraphQL Schema (auto-generated per Space)

```graphql
# Generated on every production publish — stored in apps/api/graphql/generated/
# Example for a Space with Object Types: Order, Customer, Product

type Query {
  # ── Object Type queries ───────────────────────────────────────────────────
  orders(
    filter:    OrderFilter
    sort:     [OrderSort!]
    first:     Int = 20
    after:     String
  ): OrderConnection!

  order(id: ID!): Order

  searchOrders(query: String!, k: Int = 20): [OrderSearchResult!]!

  customers(filter: CustomerFilter, first: Int = 20, after: String): CustomerConnection!
  customer(id: ID!): Customer

  # ── Link traversal ────────────────────────────────────────────────────────
  orderCustomer(orderId: ID!): Customer
  customerOrders(customerId: ID!, asOfDate: String): [Order!]!
}

type Mutation {
  # ── Action Type mutations (one per Action Type) ──────────────────────────
  submitOrder(
    objectId:    ID!
    customerId:  ID!
    submittedAt: DateTime!
  ): ActionResult!

  cancelOrder(
    objectId:    ID!
    reason:      String!
    cancelledAt: DateTime!
  ): ActionResult!

  createOrder(
    totalAmount: Float!
    currency:    String!
    orderDate:   Date!
  ): ActionResult!
}

type Subscription {
  orderUpdated(orderId: ID!): OrderEvent!
}

# ── Object Types ─────────────────────────────────────────────────────────────

type Order {
  _eomId:          ID!
  _eomType:        String!
  _eomCreatedAt:   DateTime!
  _eomUpdatedAt:   DateTime!
  _eomSensitivity: String!
  status:          String
  totalAmount:     Float
  currency:        String
  submittedAt:     DateTime
  orderDate:       Date
  customer:        Customer    # resolved via LINK_PLACED_BY traversal
}

type Customer {
  _eomId:        ID!
  displayName:   String
  email:         String
  status:        String
  orders:        [Order!]!    # resolved via reverse LINK_PLACED_BY
}

# ── Connection / Pagination ───────────────────────────────────────────────────

type OrderConnection {
  edges:      [OrderEdge!]!
  pageInfo:   PageInfo!
  totalCount: Int!
}

type OrderEdge {
  node:   Order!
  cursor: String!
}

type PageInfo {
  hasNextPage:     Boolean!
  hasPreviousPage: Boolean!
  startCursor:     String
  endCursor:       String
}

# ── Search ───────────────────────────────────────────────────────────────────

type OrderSearchResult {
  node:        Order!
  score:       Float!
  finalScore:  Float!
  highlights:  [String!]!
}

# ── Action Result ─────────────────────────────────────────────────────────────

type ActionResult {
  eventId:     ID!
  actionType:  String!
  objectId:    ID!
  objectType:  String!
  actorId:     String!
  status:      ActionStatus!
  denyReason:  String
  timestamp:   DateTime!
  durationMs:  Int
}

enum ActionStatus { SUCCESS FAILED DENIED }

# ── Filters ───────────────────────────────────────────────────────────────────

input OrderFilter {
  status:      StringFilter
  currency:    StringFilter
  totalAmount: FloatRangeFilter
  submittedAt: DateRangeFilter
}

input StringFilter {
  eq:     String
  in:     [String!]
  notEq:  String
}

input FloatRangeFilter {
  gte: Float
  lte: Float
}

input DateRangeFilter {
  gte: DateTime
  lte: DateTime
}

enum OrderSort {
  SUBMITTED_AT_ASC
  SUBMITTED_AT_DESC
  TOTAL_AMOUNT_ASC
  TOTAL_AMOUNT_DESC
  CREATED_AT_ASC
  CREATED_AT_DESC
}

# ── Events ────────────────────────────────────────────────────────────────────

type OrderEvent {
  type:          String!
  objectId:      ID!
  actionType:    String!
  actorId:       String!
  timestamp:     DateTime!
  fieldsChanged: [String!]!
}

scalar DateTime
scalar Date
```

---

## Standard Error Codes

| HTTP Status | Code | When |
|-------------|------|------|
| `400` | `INVALID_REQUEST` | Missing or malformed request body |
| `401` | `UNAUTHENTICATED` | Missing or expired Bearer token |
| `403` | `OPA_DENY` | OPA policy denied the operation |
| `403` | `ACCESS_DENIED` | Space access denied |
| `404` | `NOT_FOUND` | Resource does not exist |
| `409` | `REBASE_CONFLICT` | Ontology-level conflict during rebase |
| `409` | `VERSION_CONFLICT` | Concurrent edit conflict |
| `422` | `VALIDATION_ERROR` | Action Type validation rules failed |
| `422` | `SCHEMA_LINT_ERROR` | YAML schema validation failed |
| `422` | `SUBMISSION_CRITERIA_FAILED` | Object not in required state for action |
| `429` | `RATE_LIMITED` | Too many requests |
| `500` | `GRAPH_ERROR` | FalkorDB write failed |
| `503` | `OPA_UNAVAILABLE` | OPA sidecar unreachable (fail-safe deny) |
