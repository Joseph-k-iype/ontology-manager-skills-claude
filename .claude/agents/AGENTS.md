# EOM — Agents & Services

> Every logical service in EOM is described here: its responsibility boundary,
> its inputs/outputs, its allowed dependencies, and its error contract.
> Claude Code agents must stay within their service boundary. Cross-service
> calls always go through the defined interface — never import internals.

---

## Service Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        EOM Platform                              │
│                                                                  │
│   Studio (React) ──► API Gateway (FastAPI)                       │
│   CLI (Click)    ──►      │                                      │
│                           ▼                                      │
│            ┌──────────────┬──────────────┬──────────────┐       │
│            │              │              │              │       │
│      SchemaService  QueryService  ActionService  GitService      │
│            │              │              │              │       │
│            ▼              ▼              ▼              ▼       │
│         FalkorDB      FalkorDB     OPA → FalkorDB     pygit2    │
│          (meta)       (data+ES)     (data write)   (worktrees)  │
│                           │                                      │
│                     Elasticsearch                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Agent 1 — Schema Service

**File:** `apps/api/services/schema_service.py`

### Responsibility

Owns all schema compilation and publication operations. Takes YAML manifests
from a Git worktree and produces:
- FalkorDB Cypher DDL (node labels, indices, UDF registrations)
- Elasticsearch index mappings (JSON)
- Compiled Cypher transaction templates for Action Types
- Meta-graph update operations (Cypher to update `eom_meta`)

### Inputs

| Input | Type | Source |
|---|---|---|
| Worktree path | `str` | Git Service |
| Space ID | `UUID` | API request |
| Branch name | `str` | API request |

### Outputs

| Output | Type | Destination |
|---|---|---|
| FalkorDB DDL statements | `list[str]` | FalkorDB client |
| ES index mapping | `dict` | Elasticsearch client |
| Compiled Cypher templates | `dict[str, str]` | Written back to worktree + stored in DB |
| Meta-graph operations | `list[str]` | FalkorDB `eom_meta` graph |
| SDK generation trigger | Event | SDK Generator |

### Rules

- MUST NOT write directly to the production FalkorDB data graph — only DDL and meta-graph
- MUST NOT call OPA — schema compilation is pre-policy
- MUST validate all YAML against Pydantic models before compiling
- MUST produce idempotent operations (re-running compile produces identical output)
- MUST store compiled Cypher templates in the worktree alongside the YAML

### Key Methods

```python
class SchemaService:
    async def compile_branch(self, space_id: UUID, branch: str) -> CompileResult
    async def validate_yaml(self, worktree_path: str) -> ValidationResult
    async def apply_to_production(self, space_id: UUID) -> PublishResult
    async def estimate_index_size(self, space_id: UUID, branch: str) -> SizeEstimate
    async def generate_diff(self, space_id: UUID, base: str, head: str) -> SchemaDiff
```

---

## Agent 2 — Query Service

**File:** `apps/api/services/query_service.py`

### Responsibility

All **read operations** on ontology instances. Routes queries to FalkorDB
(graph traversal, multi-hop relationships) or Elasticsearch (full-text,
vector, aggregations) based on query type. Never performs writes.

### Inputs

| Input | Type |
|---|---|
| Object type API name | `str` |
| Filter criteria | `FilterExpr` |
| Graph traversal spec | `TraversalSpec \| None` |
| Search query (NL or structured) | `SearchQuery \| None` |
| Caller identity (for sensitivity filtering) | `CallerContext` |

### Outputs

| Output | Type |
|---|---|
| Object instances | `list[ObjectInstance]` |
| Ranked search results | `list[SearchResult]` |
| Graph traversal paths | `list[TraversalResult]` |
| Aggregation results | `AggregationResult` |

### Rules

- MUST NOT write to FalkorDB or Elasticsearch
- MUST apply sensitivity filters on every query (strip CONFIDENTIAL/RESTRICTED
  fields for callers without `ELEVATED_CLEARANCE` role)
- MUST route purely structural queries (follow link, count linked, path) to FalkorDB
- MUST route text/vector search, aggregations to Elasticsearch
- MUST apply graph-topology boost after RRF fusion for semantic search

### Key Methods

```python
class QueryService:
    async def get_objects(
        self, space_id: UUID, object_type: str,
        filters: FilterExpr, caller: CallerContext,
        page: int, page_size: int
    ) -> Page[ObjectInstance]

    async def get_object(
        self, space_id: UUID, object_type: str,
        object_id: str, caller: CallerContext
    ) -> ObjectInstance

    async def semantic_search(
        self, space_id: UUID, object_type: str,
        query: SemanticSearchQuery, caller: CallerContext
    ) -> list[SearchResult]

    async def traverse_links(
        self, space_id: UUID, from_object_id: str,
        link_type: str, depth: int, caller: CallerContext
    ) -> list[TraversalResult]

    async def meta_graph_query(self, cypher: str) -> list[dict]
```

---

## Agent 3 — Action Service

**File:** `apps/api/services/action_service.py`

### Responsibility

All **write operations** on ontology instances. Executes Action Types
as atomic FalkorDB Cypher write transactions, gated by OPA.

### Execution Pipeline (strict order — never skip a step)

```
1. Validate parameters (Pydantic)
2. Load action type definition from meta-graph
3. Call OPA → data.eom.action.invoke
   → DENY: raise HTTPException(403, deny_reason)
4. Evaluate submission_criteria (read-only Cypher)
   → FAIL: raise HTTPException(422, criteria_failure)
5. Run validation_rules (read-only Cypher checks)
   → FAIL: raise HTTPException(422, validation_errors)
6. Execute compiled Cypher template (atomic GRAPH.QUERY write)
   → ERROR: raise HTTPException(500, graph_error)
7. Write audit log entry to Elasticsearch (fire-and-forget async)
8. Update Elasticsearch object document (async, best-effort)
9. Emit side-effects (webhook, notification) — async, non-blocking
10. Return ActionResult
```

### Rules

- MUST call OPA before ANY graph write — no exceptions
- MUST execute the Cypher template atomically (single GRAPH.QUERY call)
- MUST write audit log regardless of side-effect outcome
- MUST NOT partially apply edits — if Cypher fails, the whole action fails
- MUST NOT use FalkorDB UDFs for write operations
- Side-effects MUST be fire-and-forget — their failure must not fail the action

### Key Methods

```python
class ActionService:
    async def invoke(
        self, space_id: UUID, action_type: str,
        object_id: str, params: dict,
        caller: CallerContext
    ) -> ActionResult

    async def get_action_log(
        self, space_id: UUID, action_type: str,
        page: int, page_size: int
    ) -> Page[ActionLogEntry]

    async def revert(
        self, space_id: UUID, action_log_id: str,
        caller: CallerContext
    ) -> ActionResult
```

---

## Agent 4 — Git Service

**File:** `apps/api/services/git_service.py`

### Responsibility

All Git and worktree operations. Manages the lifecycle of bare repos,
worktrees, branches, PRs (as metadata), and merge operations. Uses
`pygit2` for all Git operations.

### Worktree State Machine

```
                ┌─────────┐
                │ PENDING │  (creation requested)
                └────┬────┘
                     │ worktree add + sandbox created
                     ▼
                ┌─────────┐
                │ ACTIVE  │  (author can edit YAML)
                └────┬────┘
                     │ eom pr open
                     ▼
               ┌──────────┐
               │ IN_REVIEW│  (CI running, approvals collecting)
               └────┬─────┘
                    │ all gates passed
                    ▼
               ┌──────────┐
               │ APPROVED │
               └────┬─────┘
                    │ eom merge
                    ▼
               ┌──────────┐
               │  MERGED  │  (worktree cleaned up)
               └──────────┘

                    OR

               ┌──────────┐
               │ REJECTED │  (PR closed without merge)
               └──────────┘
```

### Rules

- MUST use pygit2 for all Git operations — never shell out to `git`
- MUST create a sandbox FalkorDB graph on branch creation (GRAPH.COPY)
- MUST create sandbox ES indices with branch-specific aliases on branch creation
- MUST clean up sandbox resources on branch delete/merge
- MUST store branch and PR metadata in the EOM PostgreSQL database
- MUST run the semantic merge tool on YAML conflicts (never expose raw diff3 to users)
- Direct commits to `main` MUST be blocked

### Key Methods

```python
class GitService:
    async def create_branch(
        self, space_id: UUID, branch_name: str, creator: CallerContext
    ) -> BranchInfo

    async def delete_branch(self, space_id: UUID, branch_name: str) -> None

    async def list_branches(self, space_id: UUID) -> list[BranchInfo]

    async def open_pr(
        self, space_id: UUID, branch_name: str, title: str,
        description: str, caller: CallerContext
    ) -> ProposalInfo

    async def merge_pr(
        self, space_id: UUID, pr_id: UUID, caller: CallerContext
    ) -> MergeResult

    async def rebase_branch(
        self, space_id: UUID, branch_name: str, onto: str
    ) -> RebaseResult

    async def get_diff(
        self, space_id: UUID, base: str, head: str
    ) -> SchemaDiff
```

---

## Agent 5 — OPA Service

**File:** `apps/api/services/opa_service.py`

### Responsibility

Thin client that calls the OPA sidecar REST API (`http://opa:8181/v1/data/...`).
Provides typed Python wrappers for all policy decision points.

### Rules

- MUST call OPA synchronously (await the decision before proceeding)
- MUST pass structured JSON input that exactly matches what Rego expects
- MUST surface `deny_reason` from OPA output in HTTP error details
- MUST NOT cache OPA decisions (policies can change on branch merge)
- Circuit breaker: if OPA is unreachable, DENY all writes (fail-safe)

### Key Methods

```python
class OPAService:
    async def check_schema_change(
        self, diff: SchemaDiff, approvals: ApprovalState
    ) -> SchemaChangeDecision    # {allow: bool, change_class: str, violations: list}

    async def check_action_invoke(
        self, action_type: str, caller: CallerContext,
        object_id: str, object_sensitivity: str,
        submission_criteria_passed: bool
    ) -> ActionInvokeDecision    # {allow: bool, deny_reason: str | None}

    async def check_access(
        self, space_id: UUID, resource: str,
        operation: str, caller: CallerContext
    ) -> AccessDecision          # {allow: bool, masked_fields: list[str]}

    async def check_naming(
        self, api_name: str, name_type: str
    ) -> NamingDecision          # {allow: bool, violation: str | None}
```

---

## Agent 6 — Embedding Service

**File:** `apps/api/services/embedding_service.py`

### Responsibility

Generates vector embeddings for Object Type instances and ontology schema
nodes. Writes embeddings to Elasticsearch `_embedding` field. Runs as
a background task — never blocks request path.

### Rules

- MUST be entirely async and background-only (FastAPI BackgroundTasks or Celery)
- MUST handle missing `EMBEDDING_MODEL_ENDPOINT` gracefully (skip, log warning)
- MUST batch embedding requests (max 100 texts per API call)
- MUST update only the `_embedding` field in ES (partial update, not full reindex)

### Key Methods

```python
class EmbeddingService:
    async def embed_object_type_schema(self, space_id: UUID, object_type: str) -> None
    async def embed_instances_batch(
        self, space_id: UUID, object_type: str, object_ids: list[str]
    ) -> None
    async def run_duplication_radar(self, space_id: UUID) -> list[DuplicatePair]
```

---

## Agent 7 — SDK Generator

**File:** `packages/eom-sdk-generator/`

### Responsibility

Auto-generates typed Python and TypeScript clients from the published
ontology schema on every merge to `main`. Publishes to the configured
package registries.

### Rules

- MUST generate from the compiled ontology in the meta-graph (not from YAML)
- MUST pin the generated SDK to the exact schema version (e.g. `2.4.1`)
- MUST generate type stubs and docstrings from Object Type `description` fields
- MUST publish only after a successful production publish (never on branch merge)

### Key Methods

```python
class SDKGenerator:
    async def generate_python(self, space_id: UUID, version: str, output_dir: str) -> None
    async def generate_typescript(self, space_id: UUID, version: str, output_dir: str) -> None
    async def publish_python(self, package_dir: str, registry_url: str) -> None
    async def publish_typescript(self, package_dir: str, registry_url: str) -> None
```

---

## Agent 8 — Health Agent (Background)

**File:** `apps/api/services/health_agent.py`

### Responsibility

Runs on a nightly schedule. Computes Ontology Health Score (OHS) for every
Space and writes results to Elasticsearch (`eom_metrics` index). Emits
alerts for stewards.

### OHS Dimensions (see DATA_MODELS.md for full scoring logic)

- Completeness (25%)
- DRY Conformance (20%)
- Change Governance (20%)
- Freshness (20%)
- Utilisation (15%)

### Rules

- MUST run as an APScheduler cron job at 02:00 UTC daily
- MUST NOT block the API — runs entirely in a background thread pool
- MUST write OHS metrics to ES regardless of alert outcome
- MUST send steward alerts via the configured notification channel (webhook/email)

---

## Inter-Service Dependency Matrix

| Service | May call | Must NOT call |
|---|---|---|
| SchemaService | FalkorDB (meta write), OPA (naming check) | ActionService, QueryService |
| QueryService | FalkorDB (read), Elasticsearch (read) | ActionService, SchemaService |
| ActionService | OPA, FalkorDB (write), Elasticsearch (async write) | SchemaService, GitService |
| GitService | SchemaService (compile), OPA (naming) | ActionService, QueryService |
| OPAService | OPA REST API | Any other service |
| EmbeddingService | Elasticsearch (write) | FalkorDB, OPA |
| SDKGenerator | meta-graph via QueryService | Any data write |
| HealthAgent | QueryService, Elasticsearch (write) | ActionService |

---

## Shared Infrastructure Clients

All services share singleton clients defined in `apps/api/dependencies.py`:

```python
from falkordb import FalkorDB
from elasticsearch import AsyncElasticsearch
import httpx

# Injected via FastAPI Depends()
async def get_falkordb() -> FalkorDB: ...
async def get_elasticsearch() -> AsyncElasticsearch: ...
async def get_opa_client() -> httpx.AsyncClient: ...
```

**Important:** FalkorDB is not async-native. Use `asyncio.to_thread()` to
wrap FalkorDB calls so they don't block the event loop:

```python
import asyncio
result = await asyncio.to_thread(graph.query, cypher, params)
```
