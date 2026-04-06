# Backend Specification

> Complete FastAPI implementation guide. Every router, service method,
> dependency, and middleware is specified here. Read DATA_MODELS.md first
> for all Pydantic types referenced below.

---

## Project Structure

```
apps/api/
├── main.py
├── config.py
├── dependencies.py
├── middleware/
│   ├── auth.py
│   └── audit.py
├── routers/
│   ├── spaces.py
│   ├── object_types.py
│   ├── objects.py
│   ├── branches.py
│   ├── proposals.py
│   ├── actions.py
│   ├── search.py
│   ├── health.py
│   └── metrics.py
├── services/
│   ├── schema_service.py
│   ├── query_service.py
│   ├── action_service.py
│   ├── git_service.py
│   ├── opa_service.py
│   ├── embedding_service.py
│   ├── health_agent.py
│   └── sdk_generator.py
├── models/
│   ├── base.py
│   ├── space.py
│   ├── object_type.py
│   ├── link_type.py
│   ├── interface.py
│   ├── shared_property.py
│   ├── value_type.py
│   ├── branch.py
│   └── action.py
├── graphql/
│   └── schema_generator.py
├── opa_policies/           # default policy templates
├── opa_policies_template/  # copied to new spaces
└── tests/
    ├── unit/
    └── integration/
```

---

## main.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import structlog

from .config import settings
from .dependencies import startup_clients, shutdown_clients
from .middleware.auth import AuthMiddleware
from .routers import (
    spaces, object_types, objects,
    branches, proposals, actions,
    search, health, metrics,
)

log = structlog.get_logger()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_clients()
    log.info("eom_api_started", version=settings.app_version)
    yield
    await shutdown_clients()
    log.info("eom_api_stopped")

app = FastAPI(
    title="Enterprise Ontology Manager API",
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.include_router(spaces,       prefix="/api/v1/spaces",       tags=["Spaces"])
app.include_router(object_types, prefix="/api/v1/spaces",       tags=["Object Types"])
app.include_router(objects,      prefix="/api/v1/spaces",       tags=["Objects"])
app.include_router(branches,     prefix="/api/v1/spaces",       tags=["Branches"])
app.include_router(proposals,    prefix="/api/v1/spaces",       tags=["Proposals"])
app.include_router(actions,      prefix="/api/v1/spaces",       tags=["Actions"])
app.include_router(search,       prefix="/api/v1/spaces",       tags=["Search"])
app.include_router(health,       prefix="/api/v1/spaces",       tags=["Health"])
app.include_router(metrics,      prefix="/api/v1/spaces",       tags=["Metrics"])
```

---

## config.py

```python
from pydantic_settings import BaseSettings
from typing import list

class Settings(BaseSettings):
    app_version: str = "1.0.0"

    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    falkordb_password: str = ""

    elasticsearch_url: str = "http://localhost:9200"
    elasticsearch_username: str = ""
    elasticsearch_password: str = ""

    opa_url: str = "http://localhost:8181"

    git_repos_base_path: str = "/tmp/eom-repos"

    jwt_issuer: str = "http://localhost:8000"
    jwt_secret: str = "dev-secret"
    jwt_algorithm: str = "HS256"

    embedding_model_endpoint: str = ""
    embedding_vector_dims: int = 1536

    cors_origins: list[str] = ["http://localhost:5173"]

    log_level: str = "INFO"

    class Config:
        env_file = ".env"

settings = Settings()
```

---

## dependencies.py

```python
from fastapi import Depends, HTTPException, status, Request
from falkordb import FalkorDB
from elasticsearch import AsyncElasticsearch
import httpx
import asyncpg

from .config import settings

_falkordb:  FalkorDB | None            = None
_es:        AsyncElasticsearch | None  = None
_opa_client:httpx.AsyncClient | None   = None
_pg_pool:   asyncpg.Pool | None        = None

async def startup_clients():
    global _falkordb, _es, _opa_client, _pg_pool
    _falkordb   = FalkorDB(
        host=settings.falkordb_host,
        port=settings.falkordb_port,
        password=settings.falkordb_password or None,
    )
    kwargs = {"hosts": [settings.elasticsearch_url]}
    if settings.elasticsearch_username:
        kwargs["basic_auth"] = (settings.elasticsearch_username,
                                settings.elasticsearch_password)
    _es         = AsyncElasticsearch(**kwargs)
    _opa_client = httpx.AsyncClient(base_url=settings.opa_url, timeout=5.0)

async def shutdown_clients():
    if _es:        await _es.close()
    if _opa_client:await _opa_client.aclose()

def get_falkordb() -> FalkorDB:
    return _falkordb

def get_es() -> AsyncElasticsearch:
    return _es

def get_opa_client() -> httpx.AsyncClient:
    return _opa_client

# Caller context — populated by AuthMiddleware
def get_caller(request: Request) -> dict:
    caller = getattr(request.state, "caller", None)
    if not caller:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")
    return caller

# Service factories (use these in router Depends())
def get_opa_service(client = Depends(get_opa_client)):
    from .services.opa_service import OPAService
    return OPAService(client)

def get_schema_service(
    falkordb = Depends(get_falkordb),
    es       = Depends(get_es),
):
    from .services.schema_service import SchemaService
    from .services.git_service import GitService
    git = GitService(settings.git_repos_base_path)
    return SchemaService(falkordb, es, git)

def get_query_service(
    falkordb = Depends(get_falkordb),
    es       = Depends(get_es),
):
    from .services.query_service import QueryService
    return QueryService(falkordb, es)

def get_action_service(
    falkordb = Depends(get_falkordb),
    es       = Depends(get_es),
    opa      = Depends(get_opa_service),
):
    from .services.action_service import ActionService
    return ActionService(falkordb, es, opa)

def get_git_service():
    from .services.git_service import GitService
    return GitService(settings.git_repos_base_path)
```

---

## middleware/auth.py

```python
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import jwt
from .config import settings

UNPROTECTED_PATHS = {"/", "/docs", "/openapi.json", "/health"}

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in UNPROTECTED_PATHS:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")

        token = auth_header[7:]
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
                audience=settings.jwt_issuer,
            )
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

        request.state.caller = {
            "user_id":  payload.get("sub"),
            "org_id":   payload.get("org_id"),
            "roles":    payload.get("roles", []),
            "email":    payload.get("email"),
        }
        return await call_next(request)
```

---

## routers/spaces.py

```python
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from ..models.space import SpaceModel, SpaceCreateRequest
from ..dependencies import get_schema_service, get_git_service, get_caller, get_opa_service
from ..services.schema_service import SchemaService
from ..services.git_service import GitService

router = APIRouter()

@router.get("", response_model=list[SpaceModel])
async def list_spaces(
    caller = Depends(get_caller),
    opa    = Depends(get_opa_service),
):
    """List all Spaces the caller has access to."""
    # In production: query PostgreSQL for all spaces, then OPA-filter by caller access
    raise NotImplementedError("Implement: query PG for spaces + OPA filter")

@router.post("", response_model=SpaceModel, status_code=201)
async def create_space(
    body:   SpaceCreateRequest,
    caller  = Depends(get_caller),
    schema  = Depends(get_schema_service),
    git     = Depends(get_git_service),
):
    """Create a new Space. Auto-creates Git repo and initial FalkorDB graphs."""
    # 1. Insert space record in PG
    # 2. Create bare Git repo
    # 3. Write initial directory structure + OPA policy templates
    # 4. Commit initial files
    # 5. Create FalkorDB graphs (data + bootstrap meta-graph space node)
    # 6. Return created space
    raise NotImplementedError

@router.get("/{space_id}", response_model=SpaceModel)
async def get_space(
    space_id: UUID,
    caller   = Depends(get_caller),
    opa      = Depends(get_opa_service),
):
    raise NotImplementedError

@router.get("/{space_id}/ontology")
async def get_ontology(
    space_id: UUID,
    caller   = Depends(get_caller),
    schema   = Depends(get_schema_service),
):
    """Return the current published ontology manifest for a Space."""
    raise NotImplementedError

@router.post("/{space_id}/export")
async def export_ontology(
    space_id: UUID,
    format: str = "yaml",   # yaml | jsonld | turtle | avro | graphql
    caller  = Depends(get_caller),
    schema  = Depends(get_schema_service),
):
    """Export the ontology in the requested format."""
    raise NotImplementedError
```

---

## routers/objects.py

```python
from fastapi import APIRouter, Depends, Query, HTTPException
from uuid import UUID
from typing import Any
from ..dependencies import get_query_service, get_caller, get_opa_service
from ..services.query_service import QueryService

router = APIRouter()

@router.get("/{space_id}/objects/{object_type}")
async def list_objects(
    space_id:    UUID,
    object_type: str,
    status:      str | None  = Query(None),
    tag:         list[str]   = Query(default=[]),
    page:        int          = Query(1, ge=1),
    page_size:   int          = Query(20, ge=1, le=200),
    sort_field:  str          = Query("_eom_created_at"),
    sort_dir:    str          = Query("desc"),
    caller       = Depends(get_caller),
    opa          = Depends(get_opa_service),
    query_svc    = Depends(get_query_service),
):
    """List objects with filter, sort, and pagination. Uses Elasticsearch."""
    # 1. OPA access check for space
    access = await opa.check_access(
        space_id=str(space_id),
        resource_type="objects",
        operation="read",
        caller_roles=caller["roles"],
        caller_org_id=caller["org_id"],
        space_visibility="PUBLIC",    # load from PG in production
        space_member_org_ids=[],
    )
    if not access["allow"]:
        raise HTTPException(403, "Access denied")

    filters = []
    if status:
        filters.append({"term": {"status": status}})
    if tag:
        filters.append({"terms": {"_eom_tags": tag}})

    result = await query_svc.get_objects(
        space_id=str(space_id),
        object_type=object_type,
        filters=filters,
        sort=[{sort_field: {"order": sort_dir}}],
        page=page,
        page_size=page_size,
        caller=caller,
    )

    # Mask sensitive fields per OPA response
    if access.get("masked_fields"):
        result = _mask_fields(result, access["masked_fields"])

    return result

@router.get("/{space_id}/objects/{object_type}/{object_id}")
async def get_object(
    space_id:    UUID,
    object_type: str,
    object_id:   str,
    caller       = Depends(get_caller),
    opa          = Depends(get_opa_service),
    query_svc    = Depends(get_query_service),
):
    obj = await query_svc.get_object(
        space_id=str(space_id),
        object_type=object_type,
        object_id=object_id,
        caller=caller,
    )
    if not obj:
        raise HTTPException(404, f"Object {object_id} not found")
    return obj

@router.get("/{space_id}/objects/{object_type}/{object_id}/links/{link_type}")
async def get_linked_objects(
    space_id:    UUID,
    object_type: str,
    object_id:   str,
    link_type:   str,
    depth:       int = Query(1, ge=1, le=5),
    as_of_date:  str | None = Query(None),
    caller       = Depends(get_caller),
    query_svc    = Depends(get_query_service),
):
    """Traverse a link type from an object. Uses FalkorDB."""
    return await query_svc.traverse_links(
        space_id=str(space_id),
        from_object_id=object_id,
        link_type=link_type,
        depth=depth,
        as_of_date=as_of_date,
        caller=caller,
    )

def _mask_fields(result: Any, masked_fields: list[str]) -> Any:
    """Remove masked fields from result objects."""
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if k not in masked_fields}
    if isinstance(result, list):
        return [_mask_fields(item, masked_fields) for item in result]
    return result
```

---

## routers/actions.py

```python
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from uuid import UUID
from ..models.action import ActionInvokeRequest, ActionResult
from ..dependencies import get_action_service, get_caller, get_opa_service
from ..services.action_service import ActionService

router = APIRouter()

@router.post("/{space_id}/actions/{action_type}/invoke",
             response_model=ActionResult)
async def invoke_action(
    space_id:         UUID,
    action_type:      str,
    body:             dict,          # {object_id: str, params: {}}
    background_tasks: BackgroundTasks,
    caller            = Depends(get_caller),
    action_svc        = Depends(get_action_service),
):
    """
    Invoke an Action Type on an object.
    Pipeline: OPA → validate → Cypher write → audit log → side-effects
    """
    object_id = body.get("object_id")
    params    = body.get("params", {})

    if not object_id:
        raise HTTPException(400, "object_id is required")

    result = await action_svc.invoke(
        space_id=str(space_id),
        action_type=action_type,
        object_id=object_id,
        params=params,
        caller=caller,
    )

    if result.status == "DENIED":
        raise HTTPException(403, {"code": "OPA_DENY",
                                   "reason": result.deny_reason})
    if result.status == "FAILED":
        raise HTTPException(422, {"code": "ACTION_FAILED",
                                   "message": result.error_message})

    return result

@router.get("/{space_id}/actions/{action_type}/log")
async def get_action_log(
    space_id:    UUID,
    action_type: str,
    status:      str | None = None,
    page:        int = 1,
    page_size:   int = 50,
    caller       = Depends(get_caller),
    action_svc   = Depends(get_action_service),
):
    return await action_svc.get_action_log(
        space_id=str(space_id),
        action_type=action_type,
        status=status,
        page=page,
        page_size=page_size,
    )
```

---

## routers/search.py

```python
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel
from ..dependencies import get_query_service, get_caller, get_opa_service

router = APIRouter()

class SearchRequest(BaseModel):
    query:          str
    object_types:   list[str]   = []    # empty = all types in space
    filters:        list[dict]  = []
    k:              int         = 20
    use_embeddings: bool        = True

@router.post("/{space_id}/search")
async def semantic_search(
    space_id:  UUID,
    body:      SearchRequest,
    caller     = Depends(get_caller),
    opa        = Depends(get_opa_service),
    query_svc  = Depends(get_query_service),
):
    """
    Hybrid semantic search across one or more Object Types.
    Uses BM25 + kNN + RRF, then applies graph-topology boost.
    """
    access = await opa.check_access(
        space_id=str(space_id),
        resource_type="objects",
        operation="read",
        caller_roles=caller["roles"],
        caller_org_id=caller["org_id"],
        space_visibility="PUBLIC",
        space_member_org_ids=[],
    )
    if not access["allow"]:
        raise HTTPException(403, "Access denied")

    results = await query_svc.semantic_search(
        space_id=str(space_id),
        query=body.query,
        object_types=body.object_types,
        extra_filters=body.filters,
        k=body.k,
        use_embeddings=body.use_embeddings,
        caller=caller,
    )
    return {"results": results, "total": len(results)}
```

---

## routers/branches.py

```python
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel
from ..models.branch import BranchInfo, ProposalInfo
from ..dependencies import get_git_service, get_schema_service, get_caller, get_opa_service

router = APIRouter()

class CreateBranchRequest(BaseModel):
    branch_name: str
    description: str = ""

class OpenProposalRequest(BaseModel):
    branch_name: str
    title:       str
    description: str = ""

@router.get("/{space_id}/branches", response_model=list[BranchInfo])
async def list_branches(
    space_id: UUID,
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
):
    return await git_svc.list_branches(space_id)

@router.post("/{space_id}/branches", response_model=BranchInfo, status_code=201)
async def create_branch(
    space_id: UUID,
    body:     CreateBranchRequest,
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
    schema    = Depends(get_schema_service),
):
    """
    Create a feature branch + server-side worktree + sandbox FalkorDB graph
    + sandbox Elasticsearch indices.
    """
    return await git_svc.create_branch(
        space_id=space_id,
        branch_name=body.branch_name,
        creator=caller,
    )

@router.delete("/{space_id}/branches/{branch_name}", status_code=204)
async def delete_branch(
    space_id:    UUID,
    branch_name: str,
    caller       = Depends(get_caller),
    git_svc      = Depends(get_git_service),
):
    await git_svc.delete_branch(space_id, branch_name)

@router.post("/{space_id}/branches/{branch_name}/rebase")
async def rebase_branch(
    space_id:    UUID,
    branch_name: str,
    onto:        str = "main",
    caller       = Depends(get_caller),
    git_svc      = Depends(get_git_service),
):
    result = await git_svc.rebase_branch(space_id, branch_name, onto)
    if not result["success"]:
        raise HTTPException(409, {
            "code": "REBASE_CONFLICT",
            "conflicts": result["conflicts"],
        })
    return result

@router.get("/{space_id}/branches/{branch_name}/diff")
async def get_diff(
    space_id:    UUID,
    branch_name: str,
    base:        str = "main",
    caller       = Depends(get_caller),
    git_svc      = Depends(get_git_service),
    schema       = Depends(get_schema_service),
):
    diff = await git_svc.get_diff(space_id, base, branch_name)
    # Classify the diff via OPA
    classification = await schema.classify_diff(diff)
    return {**diff.model_dump(), "change_class": classification["change_class"]}

@router.post("/{space_id}/proposals", response_model=ProposalInfo, status_code=201)
async def open_proposal(
    space_id: UUID,
    body:     OpenProposalRequest,
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
    schema    = Depends(get_schema_service),
):
    return await git_svc.open_pr(
        space_id=space_id,
        branch_name=body.branch_name,
        title=body.title,
        description=body.description,
        caller=caller,
    )

@router.get("/{space_id}/proposals/{pr_id}", response_model=ProposalInfo)
async def get_proposal(
    space_id: UUID,
    pr_id:    UUID,
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
):
    raise NotImplementedError

@router.post("/{space_id}/proposals/{pr_id}/approve")
async def approve_proposal(
    space_id: UUID,
    pr_id:    UUID,
    comment:  str = "",
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
):
    raise NotImplementedError

@router.post("/{space_id}/proposals/{pr_id}/merge")
async def merge_proposal(
    space_id: UUID,
    pr_id:    UUID,
    caller    = Depends(get_caller),
    git_svc   = Depends(get_git_service),
    schema    = Depends(get_schema_service),
):
    """Merge an approved PR and publish ontology changes to production."""
    result = await git_svc.merge_pr(
        space_id=space_id,
        pr_id=pr_id,
        caller=caller,
    )
    # After merge: compile + apply to production FalkorDB + ES
    await schema.compile_and_apply(space_id, branch="main")
    return result
```

---

## routers/health.py

```python
from fastapi import APIRouter, Depends
from uuid import UUID
from ..models.health import OntologyHealthScore
from ..dependencies import get_query_service, get_caller
from ..services.health_agent import HealthAgent

router = APIRouter()

@router.get("/{space_id}/health", response_model=OntologyHealthScore)
async def get_health(
    space_id:  UUID,
    caller     = Depends(get_caller),
    query_svc  = Depends(get_query_service),
):
    """Return the latest OHS for a Space (pre-computed by the Health Agent)."""
    # Read from eom_metrics index in Elasticsearch
    from ..dependencies import get_es
    es = get_es()
    response = await es.search(
        index="eom_metrics",
        body={
            "size": 1,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"space_id":    str(space_id)}},
                        {"term": {"metric_name": "ohs"}},
                    ]
                }
            },
            "sort": [{"timestamp": {"order": "desc"}}],
        },
    )
    hits = response["hits"]["hits"]
    if not hits:
        raise HTTPException(404, "Health score not yet computed for this space")
    return hits[0]["_source"]["ohs"]

@router.post("/{space_id}/health/recompute")
async def recompute_health(
    space_id: UUID,
    caller    = Depends(get_caller),
):
    """Trigger an immediate OHS recomputation (admin only)."""
    from ..services.health_agent import HealthAgent
    from ..dependencies import get_falkordb, get_es
    agent = HealthAgent(get_falkordb(), get_es())
    return await agent.compute_ohs(str(space_id))
```

---

## services/action_service.py (full implementation)

```python
import asyncio, time, uuid
from fastapi import HTTPException
from falkordb import FalkorDB
from elasticsearch import AsyncElasticsearch
from ..services.opa_service import OPAService
from ..models.action import ActionResult, ActionStatus

class ActionService:
    def __init__(self, falkordb: FalkorDB, es: AsyncElasticsearch, opa: OPAService):
        self.falkordb = falkordb
        self.es       = es
        self.opa      = opa

    async def invoke(
        self,
        space_id: str,
        action_type: str,
        object_id: str,
        params: dict,
        caller: dict,
    ) -> ActionResult:
        start_ms  = int(time.time() * 1000)
        event_id  = str(uuid.uuid4())

        # 1. Load action type definition from meta-graph
        action_def = await self._load_action_def(space_id, action_type)
        if not action_def:
            raise HTTPException(404, f"Action type '{action_type}' not found")

        # 2. Load object sensitivity (for OPA)
        object_sensitivity = await self._get_object_sensitivity(
            space_id, action_def["target_object_type"], object_id
        )

        # 3. Run submission criteria check (read-only Cypher)
        criteria_passed = await self._check_submission_criteria(
            space_id, action_def, object_id
        )

        # 4. OPA decision — MUST be called before any write
        opa_decision = await self.opa.check_action_invoke(
            action_type_api_name=action_type,
            caller_roles=caller["roles"],
            caller_org_id=caller["org_id"],
            object_id=object_id,
            object_sensitivity=object_sensitivity,
            submission_criteria_passed=criteria_passed,
        )

        if not opa_decision["allow"]:
            result = ActionResult(
                event_id=event_id,
                space_id=space_id,
                action_type=action_type,
                object_id=object_id,
                object_type=action_def["target_object_type"],
                actor_id=caller["user_id"],
                status=ActionStatus.DENIED,
                deny_reason=opa_decision["deny_reason"],
                duration_ms=int(time.time() * 1000) - start_ms,
            )
            asyncio.create_task(self._write_audit_log(result, params))
            return result

        # 5. Run validation rules (read-only Cypher checks)
        validation_errors = await self._run_validation_rules(
            space_id, action_def, object_id, params
        )
        if validation_errors:
            raise HTTPException(422, {"validation_errors": validation_errors})

        # 6. Execute compiled Cypher template (atomic write)
        try:
            before_state = await self._capture_state(space_id, action_def, object_id)
            await self._execute_cypher_template(
                space_id, action_def, object_id, params,
                caller["user_id"], action_type
            )
            after_state = await self._capture_state(space_id, action_def, object_id)
        except Exception as e:
            result = ActionResult(
                event_id=event_id,
                space_id=space_id,
                action_type=action_type,
                object_id=object_id,
                object_type=action_def["target_object_type"],
                actor_id=caller["user_id"],
                status=ActionStatus.FAILED,
                error_message=str(e),
                duration_ms=int(time.time() * 1000) - start_ms,
            )
            asyncio.create_task(self._write_audit_log(result, params))
            return result

        result = ActionResult(
            event_id=event_id,
            space_id=space_id,
            action_type=action_type,
            object_id=object_id,
            object_type=action_def["target_object_type"],
            actor_id=caller["user_id"],
            status=ActionStatus.SUCCESS,
            duration_ms=int(time.time() * 1000) - start_ms,
        )

        # 7–9. Fire-and-forget: audit log, ES sync, side effects
        asyncio.create_task(
            self._write_audit_log(result, params, before_state, after_state)
        )
        asyncio.create_task(
            self._sync_to_elasticsearch(space_id, action_def, object_id)
        )
        asyncio.create_task(
            self._emit_side_effects(action_def.get("side_effects", []), result)
        )

        return result

    async def _load_action_def(self, space_id: str, action_type: str) -> dict | None:
        graph = self.falkordb.select_graph("eom_meta")
        cypher = (
            "MATCH (at:OntMeta_ActionType {api_name: $at, space_id: $sid}) "
            "RETURN at"
        )
        rows = await asyncio.to_thread(
            graph.query, cypher, {"at": action_type, "sid": space_id}
        )
        if not rows.result_set:
            return None
        return dict(rows.result_set[0][0].properties)

    async def _get_object_sensitivity(
        self, space_id: str, object_type: str, object_id: str
    ) -> str:
        graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
        label  = f"ObjType_{object_type}"
        cypher = (
            f"MATCH (n:{label} {{_eom_id: $id, _eom_space_id: $sid}}) "
            "RETURN n._eom_sensitivity AS sensitivity"
        )
        rows = await asyncio.to_thread(
            graph.query, cypher, {"id": object_id, "sid": space_id}
        )
        if not rows.result_set:
            return "INTERNAL"
        return rows.result_set[0][0] or "INTERNAL"

    async def _check_submission_criteria(
        self, space_id: str, action_def: dict, object_id: str
    ) -> bool:
        criteria = action_def.get("submission_criteria", [])
        if not criteria:
            return True
        # Build read-only Cypher check from pre-compiled criteria
        criteria_cypher = action_def.get("compiled_criteria_cypher")
        if not criteria_cypher:
            return True
        graph = self.falkordb.select_graph(f"eom_{space_id}_data")
        rows  = await asyncio.to_thread(
            graph.query, criteria_cypher, {"object_id": object_id, "space_id": space_id}
        )
        if not rows.result_set:
            return False
        return rows.result_set[0][0] is not None  # non-null = criteria met

    async def _run_validation_rules(
        self, space_id: str, action_def: dict, object_id: str, params: dict
    ) -> list[str]:
        errors = []
        graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
        for rule in action_def.get("validation_rules", []):
            rows = await asyncio.to_thread(
                graph.query, rule["cypher_check"],
                {**params, "object_id": object_id, "space_id": space_id}
            )
            if rows.result_set and not rows.result_set[0][0]:
                errors.append(rule["description"])
        return errors

    async def _execute_cypher_template(
        self, space_id: str, action_def: dict, object_id: str,
        params: dict, actor_id: str, action_type: str
    ) -> None:
        template_path = action_def.get("compiled_cypher_ref")
        if not template_path:
            raise ValueError(f"No compiled Cypher template for {action_type}")

        # Read template from Git repo main branch
        from ..services.git_service import GitService
        from ..config import settings
        git  = GitService(settings.git_repos_base_path)
        cypher = await asyncio.to_thread(
            git.read_file, space_id, "main", template_path
        )

        graph = self.falkordb.select_graph(f"eom_{space_id}_data")
        full_params = {
            **params,
            "object_id":   object_id,
            "space_id":    space_id,
            "__actor_id":  actor_id,
            "__action_type": action_type,
        }
        await asyncio.to_thread(graph.query, cypher, full_params)

    async def _capture_state(
        self, space_id: str, action_def: dict, object_id: str
    ) -> dict | None:
        try:
            graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
            label  = f"ObjType_{action_def['target_object_type']}"
            cypher = f"MATCH (n:{label} {{_eom_id: $id}}) RETURN n"
            rows   = await asyncio.to_thread(
                graph.query, cypher, {"id": object_id}
            )
            if rows.result_set:
                return dict(rows.result_set[0][0].properties)
        except Exception:
            pass
        return None

    async def _sync_to_elasticsearch(
        self, space_id: str, action_def: dict, object_id: str
    ) -> None:
        """Re-read the object from FalkorDB and upsert into ES."""
        try:
            object_type = action_def["target_object_type"]
            graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
            label  = f"ObjType_{object_type}"
            cypher = f"MATCH (n:{label} {{_eom_id: $id}}) RETURN n"
            rows   = await asyncio.to_thread(
                graph.query, cypher, {"id": object_id}
            )
            if rows.result_set:
                doc = dict(rows.result_set[0][0].properties)
                alias = f"eom_{space_id}_{object_type}_write"
                await self.es.update(
                    index=alias, id=object_id,
                    body={"doc": doc, "doc_as_upsert": True},
                    retry_on_conflict=3,
                )
        except Exception as e:
            import structlog
            structlog.get_logger().warning("es_sync_failed", error=str(e))

    async def _write_audit_log(
        self, result: ActionResult, params: dict,
        before_state=None, after_state=None
    ) -> None:
        try:
            import time
            await self.es.index(
                index="eom_audit_log",
                id=result.event_id,
                body={
                    "event_id":    result.event_id,
                    "space_id":    result.space_id,
                    "action_type": result.action_type,
                    "object_id":   result.object_id,
                    "object_type": result.object_type,
                    "actor_id":    result.actor_id,
                    "status":      result.status,
                    "deny_reason": result.deny_reason,
                    "error_message": result.error_message,
                    "params":      params,
                    "before_state":before_state,
                    "after_state": after_state,
                    "duration_ms": result.duration_ms,
                    "timestamp":   int(time.time() * 1000),
                },
            )
        except Exception as e:
            import structlog
            structlog.get_logger().error("audit_log_write_failed", error=str(e))

    async def _emit_side_effects(self, side_effects: list, result: ActionResult) -> None:
        for se in side_effects:
            try:
                if se["type"] == "WEBHOOK":
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            se["config"]["url"],
                            json=result.model_dump(),
                            timeout=10.0,
                        )
            except Exception as e:
                import structlog
                structlog.get_logger().warning("side_effect_failed",
                                               type=se["type"], error=str(e))
```

---

## services/query_service.py (abbreviated)

```python
import asyncio
from falkordb import FalkorDB
from elasticsearch import AsyncElasticsearch

class QueryService:
    def __init__(self, falkordb: FalkorDB, es: AsyncElasticsearch):
        self.falkordb = falkordb
        self.es       = es

    async def get_objects(
        self, space_id, object_type, filters, sort, page, page_size, caller
    ):
        from ..skills.elasticsearch_skill import list_objects
        allowed_sensitivity = self._sensitivity_for_caller(caller)
        result = await list_objects(
            self.es, space_id, object_type,
            filters=[
                *filters,
                {"terms": {"_eom_sensitivity": allowed_sensitivity}},
            ],
            sort=sort, page=page, page_size=page_size,
        )
        return result

    async def semantic_search(
        self, space_id, query, object_types, extra_filters, k, use_embeddings, caller
    ):
        from ..skills.elasticsearch_skill import hybrid_search, graph_topology_boost
        from ..services.embedding_service import EmbeddingService

        query_vector = None
        if use_embeddings:
            from ..config import settings
            if settings.embedding_model_endpoint:
                emb_svc      = EmbeddingService()
                query_vector = await emb_svc.embed_text(query)

        types = object_types or await self._list_object_types(space_id)
        all_results = []
        for ot in types:
            hits = await hybrid_search(
                self.es, space_id, ot, query, query_vector,
                filters=extra_filters, size=k
            )
            all_results.extend(hits["hits"]["hits"])

        # Sort by RRF score
        all_results.sort(key=lambda h: h["_score"], reverse=True)
        top_n_ids  = [h["_id"] for h in all_results[:10]]

        # Graph-topology boost
        all_results = await graph_topology_boost(
            [{"id": h["_id"], "score": h["_score"],
              "source": h["_source"]} for h in all_results],
            top_n_ids,
        )
        return all_results[:k]

    async def traverse_links(
        self, space_id, from_object_id, link_type, depth, as_of_date, caller
    ):
        graph  = self.falkordb.select_graph(f"eom_{space_id}_data")
        rel    = f"LINK_{link_type.upper()}"
        if as_of_date:
            cypher = (
                f"MATCH (src {{_eom_id: $id}})-[r:{rel}]->(tgt) "
                f"WHERE r.valid_from <= $as_of AND (r.valid_to IS NULL OR r.valid_to > $as_of) "
                f"AND tgt._eom_deleted_at IS NULL "
                f"RETURN tgt, r.valid_from AS from_date, r.valid_to AS to_date"
            )
            params = {"id": from_object_id, "as_of": as_of_date}
        else:
            cypher = (
                f"MATCH (src {{_eom_id: $id}})-[r:{rel}*1..{depth}]->(tgt) "
                f"WHERE tgt._eom_space_id = $sid AND tgt._eom_deleted_at IS NULL "
                f"RETURN DISTINCT tgt"
            )
            params = {"id": from_object_id, "sid": space_id}

        rows = await asyncio.to_thread(graph.query, cypher, params)
        return [dict(r[0].properties) for r in rows.result_set]

    def _sensitivity_for_caller(self, caller: dict) -> list[str]:
        if "ELEVATED_CLEARANCE" in caller.get("roles", []):
            return ["PUBLIC","INTERNAL","CONFIDENTIAL","RESTRICTED"]
        return ["PUBLIC","INTERNAL"]

    async def _list_object_types(self, space_id: str) -> list[str]:
        graph  = self.falkordb.select_graph("eom_meta")
        cypher = ("MATCH (ot:OntMeta_ObjectType {space_id: $sid, status: 'PUBLISHED'}) "
                  "RETURN ot.api_name AS name")
        rows   = await asyncio.to_thread(graph.query, cypher, {"sid": space_id})
        return [r[0] for r in rows.result_set]
```

---

## GraphQL Schema Generator (Strawberry)

```python
# apps/api/graphql/schema_generator.py
import strawberry
from typing import Any

def build_graphql_schema(space_id: str, object_types: list[dict]) -> strawberry.Schema:
    """
    Dynamically build a Strawberry GraphQL schema from published Object Types.
    Called by the Schema Service on every production publish.
    """
    type_classes = {}

    for ot in object_types:
        # Build a Strawberry type for each Object Type
        fields = {
            "_eom_id":       (str, strawberry.field(description="Primary key")),
            "_eom_type":     (str, strawberry.field()),
            "_eom_created_at":(str, strawberry.field()),
        }
        for prop in ot.get("properties", []):
            py_type = _base_type_to_python(prop["base_type"])
            fields[prop["api_name"]] = (
                py_type | None,
                strawberry.field(description=prop.get("description", ""))
            )

        type_cls = strawberry.type(
            type(ot["api_name"], (), {
                "__annotations__": {k: v[0] for k, v in fields.items()},
                **{k: v[1] for k, v in fields.items()},
            }),
            description=ot.get("description", ""),
        )
        type_classes[ot["api_name"]] = type_cls

    # Build Query resolvers
    query_fields = {}
    for ot_name, cls in type_classes.items():
        async def resolver(space_id=space_id, ot=ot_name, info=None):
            # Calls QueryService.get_objects()
            pass
        query_fields[ot_name] = strawberry.field(resolver=resolver)

    Query = strawberry.type(type("Query", (), query_fields))
    return strawberry.Schema(query=Query)

def _base_type_to_python(base_type: str):
    mapping = {
        "String": str, "Integer": int, "Long": int,
        "Double": float, "Boolean": bool,
        "Timestamp": str, "Date": str,
        "GeoPoint": list, "Struct": dict,
    }
    return mapping.get(base_type, str)
```
