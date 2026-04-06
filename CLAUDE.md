# Enterprise Ontology Manager — Claude Code Project Guide

> **Read this file first before touching any code.**
> It describes the project layout, conventions, run commands, and the mental model
> every agent must share to work correctly on this codebase.

---

## Project in One Sentence

EOM is a platform that lets enterprises define, version, govern, and search
semantic ontologies — backed by **FalkorDB** (graph), **Elasticsearch** (semantic
search), **Git Worktrees** (version control), and **Open Policy Agent** (policy
enforcement).

---

## Repository Layout

```
eom/
├── CLAUDE.md                  ← you are here
├── AGENTS.md                  ← service & agent contracts
├── skills/
│   ├── FALKORDB_SKILL.md      ← graph layer patterns
│   ├── ELASTICSEARCH_SKILL.md ← search layer patterns
│   ├── GIT_WORKTREE_SKILL.md  ← version control patterns
│   ├── OPA_SKILL.md           ← policy patterns
│   └── SCHEMA_COMPILER_SKILL.md ← YAML → Cypher/ES compilation
├── specs/
│   ├── DATA_MODELS.md         ← all Pydantic + TypeScript models
│   ├── CYPHER_QUERIES.md      ← full Cypher query reference
│   ├── ELASTICSEARCH_QUERIES.md ← full ES query reference
│   ├── BACKEND_SPEC.md        ← FastAPI service implementations
│   ├── FRONTEND_SPEC.md       ← React component architecture
│   ├── API_SPEC.md            ← REST + GraphQL contracts
│   └── ACTION_TYPES_SPEC.md   ← Action Type system end-to-end
├── apps/
│   ├── api/                   ← Python 3.12 FastAPI backend
│   └── studio/                ← React 18 + TypeScript frontend
├── packages/
│   ├── eom-cli/               ← Click CLI
│   └── eom-sdk-generator/     ← auto SDK generation
└── infra/
    ├── docker-compose.yml
    └── k8s/
```

---

## Tech Stack (Pinned)

| Layer | Technology | Version |
|---|---|---|
| Backend language | Python | 3.12 |
| API framework | FastAPI | 0.115.x |
| Data validation | Pydantic | v2.x |
| GraphQL | Strawberry | 0.240.x |
| Graph DB | FalkorDB | 4.x (Redis-based) |
| Search | Elasticsearch | 8.17.x |
| Policy engine | Open Policy Agent | 0.70.x |
| Git library | pygit2 | 1.15.x |
| Frontend framework | React | 18.x |
| Frontend language | TypeScript | 5.x |
| Authoring canvas | React Flow | 12.x |
| Exploration graph | AntV G6 | 5.x |
| Galaxy view (Phase 3) | 3d-force-graph | latest |
| Build tool | Vite | 5.x |
| State (server) | TanStack Query | 5.x |
| State (client) | Zustand | 4.x |
| Styling | Tailwind CSS | 3.x |
| Editor | Monaco Editor | 0.45.x |
| Package manager (py) | uv | 0.4.x |
| Package manager (js) | pnpm | 9.x |

---

## Start All Services Locally

```bash
# 1. Infrastructure (FalkorDB + Elasticsearch + OPA)
docker-compose up -d falkordb elasticsearch opa

# 2. Backend
cd apps/api
uv sync
uv run uvicorn main:app --reload --port 8000

# 3. Frontend
cd apps/studio
pnpm install
pnpm dev    # → http://localhost:5173

# 4. CLI (link for local dev)
cd packages/eom-cli
uv pip install -e .
eom --help
```

---

## Environment Variables

Copy `.env.example` → `.env` in both `apps/api/` and `apps/studio/`.

### Backend (`apps/api/.env`)
```
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_PASSWORD=

ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=

OPA_URL=http://localhost:8181

GIT_REPOS_BASE_PATH=/tmp/eom-repos

JWT_ISSUER=http://localhost:8000
JWT_SECRET=dev-secret-change-in-prod

EMBEDDING_MODEL_ENDPOINT=        # leave empty to skip embeddings in dev
EMBEDDING_VECTOR_DIMS=1536

LOG_LEVEL=DEBUG
```

### Frontend (`apps/studio/.env`)
```
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

---

## Run Tests

```bash
# Backend unit + integration
cd apps/api
uv run pytest tests/ -v

# Backend with coverage
uv run pytest tests/ --cov=. --cov-report=html

# Frontend
cd apps/studio
pnpm test          # vitest
pnpm test:e2e      # playwright

# OPA policy tests
opa test apps/api/opa_policies/ --verbose

# CLI tests
cd packages/eom-cli
uv run pytest tests/ -v
```

---

## Core Mental Models

### 1. Everything starts from YAML

The YAML manifest in the Git worktree is the **source of truth**.
FalkorDB schemas, Elasticsearch mappings, compiled Cypher templates,
and auto-generated SDKs are all **derived** from YAML. Never edit them
directly — change the YAML, re-compile, republish.

### 2. Two FalkorDB graphs

| Graph | Contains |
|---|---|
| `eom_{spaceId}_data` | All object and link instances for a Space |
| `eom_meta` | The ontology schema itself as a property graph (meta-graph) |

The meta-graph powers impact analysis. Query it with Cypher to traverse
dependencies — never hardcode dependency logic in Python.

### 3. FalkorDB UDFs are read-only

FalkorDB JavaScript UDFs **cannot modify the graph**. Use them only for
computed read values (derived properties, custom aggregations, traversal
scoring). Write operations always go through parameterised Cypher
transactions in the Action Service.

### 4. OPA is the only gatekeeper

No service may make its own access or schema-change decisions. Every
write call (schema change, action invocation, branch merge) must call
OPA first and fail fast on `DENY`. See `skills/OPA_SKILL.md`.

### 5. Elasticsearch is for reading; FalkorDB is for graph traversal

For object population queries (filter, sort, aggregate, full-text search,
vector similarity) — use Elasticsearch. For graph traversal (follow links,
multi-hop relationships, blast-radius analysis) — use FalkorDB.

### 6. Hybrid search = BM25 + kNN + RRF

All semantic search uses Elasticsearch's native `rank.rrf` to fuse BM25
and kNN results. Never write manual score-combination logic.
See `skills/ELASTICSEARCH_SKILL.md`.

### 7. Two graph renderers — strict separation

**React Flow** (authoring) and **AntV G6** (exploration) serve different workflows and
must never be mixed on the same canvas. They use different coordinate systems, event
models, and data structures.

| Renderer | Route | Engine | Use for |
|---|---|---|---|
| React Flow | `/spaces/:id` | SVG+HTML | Create/edit types, draw links, open editors |
| AntV G6 | `/spaces/:id/explore` | Canvas | Read-only traversal, layouts, blast radius |
| `3d-force-graph` | `/spaces/:id/galaxy` | WebGL | Phase 3 — > 300 types, lazy-load only |

G6 and 3d-force-graph are **lazy-loaded** — never import them in files that load with
the initial bundle. Use `React.lazy()` + `Suspense` on their route components.

---

## Naming Conventions

### Python
- Files and modules: `snake_case`
- Classes: `PascalCase`
- Functions and variables: `snake_case`
- Constants: `UPPER_SNAKE_CASE`
- Pydantic models: `PascalCase`, suffix with `Model` only when ambiguous

### TypeScript
- Files: `kebab-case.tsx` / `kebab-case.ts`
- Components: `PascalCase`
- Hooks: `camelCase` prefixed with `use`
- Types and interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

### Ontology YAML (apiName)
- Object Types: `lower_snake_case` (e.g. `trade_confirmation`)
- Properties: `camelCase` (e.g. `settlementDate`)
- Link Types: `lower_snake_case` verb phrase (e.g. `placed_by`)
- Shared Properties: `lower_snake_case` (e.g. `legal_entity_id`)
- Action Types: `lower_snake_case` verb phrase (e.g. `submit_order`)

### FalkorDB
- Node labels: `:ObjType_{snake_case_apiName}` (e.g. `:ObjType_order`)
- Relationship types: `:LINK_{UPPER_SNAKE_CASE_apiName}` (e.g. `:LINK_PLACED_BY`)
- Meta-graph labels: `:OntMeta_{PascalCase}` (e.g. `:OntMeta_ObjectType`)

### Elasticsearch
- Indices: `eom_{spaceId}_{objectTypeApiName}_v{N}` (e.g. `eom_abc_order_v3`)
- Aliases: `eom_{spaceId}_{objectTypeApiName}` (e.g. `eom_abc_order`)

---

## Error Handling Conventions

### Backend
```python
# Always use HTTPException with structured detail
from fastapi import HTTPException

raise HTTPException(
    status_code=403,
    detail={
        "code": "OPA_DENY",
        "reason": deny_reason,       # from OPA response
        "action_type": action_type,
        "object_id": object_id,
    }
)

# Never swallow exceptions silently — log then re-raise
import structlog
log = structlog.get_logger()

try:
    result = await falkordb_client.query(...)
except Exception as e:
    log.error("falkordb_query_failed", query=query, error=str(e))
    raise
```

### Frontend
```typescript
// All API calls go through the typed client in src/api/client.ts
// Errors are surfaced via TanStack Query's error state
// Never use try/catch inside components — use onError in query options

const { data, error, isLoading } = useQuery({
  queryKey: ['object-types', spaceId],
  queryFn: () => api.objectTypes.list(spaceId),
});

if (error) return <ErrorBoundary error={error} />;
```

---

## Git Workflow for This Repository

```bash
# Feature work
git checkout -b feat/your-feature
# ... implement ...
git commit -m "feat(component): description"
git push origin feat/your-feature
# → open PR → CI runs → merge

# Commit message format:
# type(scope): description
# Types: feat, fix, refactor, test, docs, chore
# Scopes: api, studio, cli, falkordb, elasticsearch, opa, compiler
```

---

## What Each Skill File Covers

| File | When to read it |
|---|---|
| `skills/FALKORDB_SKILL.md` | Writing Cypher queries, schema DDL, UDFs, meta-graph ops |
| `skills/ELASTICSEARCH_SKILL.md` | Index mappings, hybrid search, BM25+kNN+RRF, aggregations |
| `skills/GIT_WORKTREE_SKILL.md` | Branch creation, PR lifecycle, rebase, semantic merge |
| `skills/OPA_SKILL.md` | Writing Rego policies, calling OPA from Python, CI integration |
| `skills/SCHEMA_COMPILER_SKILL.md` | YAML parsing → Cypher DDL + ES mappings + Cypher templates |

## What Each Spec File Covers

| File | When to read it |
|---|---|
| `specs/DATA_MODELS.md` | All Pydantic v2 models + TypeScript interfaces + DB schemas |
| `specs/CYPHER_QUERIES.md` | All Cypher patterns: CRUD, traversal, meta-graph, aggregations |
| `specs/ELASTICSEARCH_QUERIES.md` | All ES patterns: mappings, search, aggregations, pipeline |
| `specs/BACKEND_SPEC.md` | FastAPI routers, service layer, dependency injection |
| `specs/FRONTEND_SPEC.md` | React component tree, state management, canvas, editors |
| `specs/API_SPEC.md` | REST endpoints + GraphQL schema + WebSocket events |
| `specs/ACTION_TYPES_SPEC.md` | Action Type YAML → Cypher → OPA → execute → audit |
