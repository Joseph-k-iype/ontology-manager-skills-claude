# Infrastructure Specification

> Complete infrastructure guide: local Docker Compose stack, Kubernetes
> manifests for production, and the full CI/CD pipeline. Claude Code
> uses this to wire everything together and make it deployable.

---

## Local Development Stack

### docker-compose.yml

```yaml
# docker-compose.yml (repo root)
version: "3.9"

services:

  # ── Data layer ─────────────────────────────────────────────────────────────

  falkordb:
    image: falkordb/falkordb:latest
    container_name: eom-falkordb
    ports:
      - "6379:6379"
      - "3000:3000"          # FalkorDB browser UI
    volumes:
      - falkordb_data:/var/lib/falkordb/data
    environment:
      - FALKORDB_MAX_MEMORY=4gb
    healthcheck:
      test: ["CMD", "redis-cli", "-p", "6379", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
    container_name: eom-elasticsearch
    ports:
      - "9200:9200"
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false      # dev only — enable in production
      - ES_JAVA_OPTS=-Xms2g -Xmx2g
      - cluster.name=eom-dev
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9200/_cluster/health"]
      interval: 15s
      timeout: 10s
      retries: 10
    restart: unless-stopped

  opa:
    image: openpolicyagent/opa:latest
    container_name: eom-opa
    ports:
      - "8181:8181"
    command:
      - run
      - --server
      - --addr=0.0.0.0:8181
      - --log-level=info
    volumes:
      - ./apps/api/opa_policies:/policies:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8181/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: eom-postgres
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=eom
      - POSTGRES_USER=eom
      - POSTGRES_PASSWORD=eom_dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./apps/api/migrations/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U eom"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ── Application layer ──────────────────────────────────────────────────────

  api:
    build:
      context: apps/api
      dockerfile: Dockerfile
    container_name: eom-api
    ports:
      - "8000:8000"
    env_file:
      - apps/api/.env
    environment:
      - FALKORDB_HOST=falkordb
      - FALKORDB_PORT=6379
      - ELASTICSEARCH_URL=http://elasticsearch:9200
      - OPA_URL=http://opa:8181
      - DATABASE_URL=postgresql://eom:eom_dev_password@postgres:5432/eom
      - GIT_REPOS_BASE_PATH=/srv/eom-repos
    volumes:
      - git_repos:/srv/eom-repos
      - ./apps/api:/app:cached        # hot reload in dev
    depends_on:
      falkordb:      { condition: service_healthy }
      elasticsearch: { condition: service_healthy }
      opa:           { condition: service_healthy }
      postgres:      { condition: service_healthy }
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    restart: unless-stopped

  studio:
    build:
      context: apps/studio
      dockerfile: Dockerfile
    container_name: eom-studio
    ports:
      - "5173:5173"
    environment:
      - VITE_API_BASE_URL=http://localhost:8000
      - VITE_WS_BASE_URL=ws://localhost:8000
    volumes:
      - ./apps/studio/src:/app/src:cached
    command: pnpm dev --host
    restart: unless-stopped

volumes:
  falkordb_data:
  elasticsearch_data:
  postgres_data:
  git_repos:
```

---

### API Dockerfile

```dockerfile
# apps/api/Dockerfile
FROM python:3.12-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgit2-dev libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# Copy source
COPY . .
RUN uv sync --frozen

EXPOSE 8000

# Dev: override with --reload
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Production Dockerfile** (multi-stage, no dev deps):

```dockerfile
# apps/api/Dockerfile.prod
FROM python:3.12-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential libgit2-dev libssl-dev pkg-config
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y libgit2-1.7 libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app .
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

---

### Studio Dockerfile

```dockerfile
# apps/studio/Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]
```

**Production build:**

```dockerfile
# apps/studio/Dockerfile.prod
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build           # outputs to /app/dist

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf** (SPA routing):

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy (in production, point to API service)
    location /api/ {
        proxy_pass         http://eom-api:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
    }

    # WebSocket upgrade
    location /ws/ {
        proxy_pass         http://eom-api:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "Upgrade";
    }
}
```

---

## Database Migrations

```sql
-- apps/api/migrations/init.sql
-- Run automatically by the postgres container on first start.
-- For subsequent migrations, use a migration tool (e.g. Alembic or raw scripts).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organisations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    org_id       UUID        NOT NULL REFERENCES organisations(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spaces (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    visibility      TEXT        NOT NULL DEFAULT 'PRIVATE',
    owning_org_id   UUID        NOT NULL REFERENCES organisations(id),
    tier            TEXT        NOT NULL DEFAULT 'DOMAIN',
    git_repo_path   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS space_members (
    space_id   UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    org_id     UUID NOT NULL REFERENCES organisations(id),
    PRIMARY KEY (space_id, org_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id    UUID NOT NULL REFERENCES users(id),
    space_id   UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('VIEWER','EDITOR','STEWARD','PUBLISHER','ADMIN','ORG_ADMIN')),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, space_id, role)
);

CREATE TABLE IF NOT EXISTS branches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    branch_name     TEXT        NOT NULL,
    branch_slug     TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'ACTIVE',
    creator_id      UUID        REFERENCES users(id),
    last_commit_sha TEXT,
    worktree_path   TEXT,
    sandbox_graph   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (space_id, branch_name)
);

CREATE TABLE IF NOT EXISTS proposals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    branch_name     TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    status          TEXT        NOT NULL DEFAULT 'IN_REVIEW',
    author_id       UUID        REFERENCES users(id),
    change_class    TEXT,
    impact_score    FLOAT,
    ci_status       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proposal_approvals (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    approver_id UUID        NOT NULL REFERENCES users(id),
    role        TEXT        NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    comment     TEXT
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_branches_space    ON branches(space_id);
CREATE INDEX IF NOT EXISTS idx_branches_status   ON branches(status);
CREATE INDEX IF NOT EXISTS idx_proposals_space   ON proposals(space_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_user_roles_user   ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_space  ON user_roles(space_id);
```

---

## Kubernetes Production Manifests

### Namespace

```yaml
# infra/k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: eom
  labels:
    app.kubernetes.io/name: enterprise-ontology-manager
```

---

### ConfigMap & Secrets

```yaml
# infra/k8s/config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: eom-config
  namespace: eom
data:
  FALKORDB_HOST:      "eom-falkordb"
  FALKORDB_PORT:      "6379"
  ELASTICSEARCH_URL:  "http://eom-elasticsearch:9200"
  OPA_URL:            "http://localhost:8181"     # OPA sidecar in same pod
  GIT_REPOS_BASE_PATH:"/srv/eom-repos"
  LOG_LEVEL:          "INFO"
  EMBEDDING_VECTOR_DIMS: "1536"
---
# Secrets managed via External Secrets Operator or Vault — never committed
# Apply manually:
# kubectl create secret generic eom-secrets \
#   --from-literal=FALKORDB_PASSWORD=... \
#   --from-literal=JWT_SECRET=... \
#   --from-literal=DATABASE_URL=... \
#   -n eom
```

---

### API Deployment (with OPA sidecar)

```yaml
# infra/k8s/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eom-api
  namespace: eom
  labels:
    app: eom-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: eom-api
  template:
    metadata:
      labels:
        app: eom-api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port:   "8000"
        prometheus.io/path:   "/metrics"
    spec:
      volumes:
        - name: git-repos
          persistentVolumeClaim: { claimName: eom-git-repos }
        - name: opa-policies
          configMap: { name: eom-opa-policies }

      initContainers:
        - name: db-migrate
          image: your-registry/eom-api:latest
          command: ["uv", "run", "python", "-m", "scripts.migrate"]
          envFrom:
            - configMapRef: { name: eom-config }
            - secretRef:    { name: eom-secrets }

      containers:
        # ── Main API ──────────────────────────────────────────────────────────
        - name: api
          image: your-registry/eom-api:latest
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef: { name: eom-config }
            - secretRef:    { name: eom-secrets }
          volumeMounts:
            - name: git-repos
              mountPath: /srv/eom-repos
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { cpu: "2",    memory: "2Gi"   }
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds:       10
          livenessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 30
            periodSeconds:       30

        # ── OPA sidecar ───────────────────────────────────────────────────────
        - name: opa
          image: openpolicyagent/opa:latest
          args:
            - run
            - --server
            - --addr=0.0.0.0:8181
            - /policies
          ports:
            - containerPort: 8181
          volumeMounts:
            - name: opa-policies
              mountPath: /policies
              readOnly: true
          resources:
            requests: { cpu: "100m", memory: "64Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
          readinessProbe:
            httpGet: { path: /health, port: 8181 }
            initialDelaySeconds: 5
            periodSeconds:       10
---
apiVersion: v1
kind: Service
metadata:
  name: eom-api
  namespace: eom
spec:
  selector:
    app: eom-api
  ports:
    - name: http
      port: 80
      targetPort: 8000
```

---

### Studio Deployment

```yaml
# infra/k8s/studio-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eom-studio
  namespace: eom
spec:
  replicas: 2
  selector:
    matchLabels: { app: eom-studio }
  template:
    metadata:
      labels: { app: eom-studio }
    spec:
      containers:
        - name: studio
          image: your-registry/eom-studio:latest
          ports:
            - containerPort: 80
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "512Mi"  }
---
apiVersion: v1
kind: Service
metadata:
  name: eom-studio
  namespace: eom
spec:
  selector: { app: eom-studio }
  ports:
    - port: 80
      targetPort: 80
```

---

### FalkorDB StatefulSet

```yaml
# infra/k8s/falkordb-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: eom-falkordb
  namespace: eom
spec:
  serviceName: eom-falkordb
  replicas: 1          # scale via Redis Cluster for multi-AZ
  selector:
    matchLabels: { app: eom-falkordb }
  template:
    metadata:
      labels: { app: eom-falkordb }
    spec:
      containers:
        - name: falkordb
          image: falkordb/falkordb:latest
          ports:
            - containerPort: 6379
          env:
            - name: FALKORDB_MAX_MEMORY
              value: "8gb"
          volumeMounts:
            - name: data
              mountPath: /var/lib/falkordb/data
          resources:
            requests: { cpu: "1",  memory: "4Gi" }
            limits:   { cpu: "4",  memory: "16Gi" }
          readinessProbe:
            exec:
              command: ["redis-cli", "-p", "6379", "ping"]
            initialDelaySeconds: 10
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd    # set to your cloud's fast storage class
        resources:
          requests:
            storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: eom-falkordb
  namespace: eom
spec:
  clusterIP: None     # headless — pods connect directly
  selector: { app: eom-falkordb }
  ports:
    - port: 6379
```

---

### Elasticsearch StatefulSet

```yaml
# infra/k8s/elasticsearch-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: eom-elasticsearch
  namespace: eom
spec:
  serviceName: eom-elasticsearch
  replicas: 3
  selector:
    matchLabels: { app: eom-elasticsearch }
  template:
    metadata:
      labels: { app: eom-elasticsearch }
    spec:
      initContainers:
        - name: sysctl
          image: busybox
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.17.0
          ports:
            - containerPort: 9200
            - containerPort: 9300
          env:
            - name: cluster.name
              value: eom-production
            - name: discovery.seed_hosts
              value: "eom-elasticsearch-0.eom-elasticsearch,eom-elasticsearch-1.eom-elasticsearch,eom-elasticsearch-2.eom-elasticsearch"
            - name: cluster.initial_master_nodes
              value: "eom-elasticsearch-0,eom-elasticsearch-1,eom-elasticsearch-2"
            - name: ES_JAVA_OPTS
              value: "-Xms4g -Xmx4g"
            - name: xpack.security.enabled
              value: "true"
          volumeMounts:
            - name: data
              mountPath: /usr/share/elasticsearch/data
          resources:
            requests: { cpu: "1",  memory: "8Gi" }
            limits:   { cpu: "4",  memory: "16Gi" }
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 500Gi
---
apiVersion: v1
kind: Service
metadata:
  name: eom-elasticsearch
  namespace: eom
spec:
  clusterIP: None
  selector: { app: eom-elasticsearch }
  ports:
    - name: http
      port: 9200
    - name: transport
      port: 9300
```

---

### Ingress

```yaml
# infra/k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: eom-ingress
  namespace: eom
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout:  "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout:  "3600"
    nginx.ingress.kubernetes.io/proxy-body-size:     "50m"
    nginx.ingress.kubernetes.io/enable-websockets:   "true"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - eom.your-company.com
        - eom-api.your-company.com
      secretName: eom-tls
  rules:
    - host: eom.your-company.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: eom-studio
                port: { number: 80 }
    - host: eom-api.your-company.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: eom-api
                port: { number: 80 }
```

---

## CI/CD Pipeline — GitHub Actions

### Build and Push Images

```yaml
# .github/workflows/build.yml
name: Build & Push

on:
  push:
    branches: [main]
    tags: ["v*"]

env:
  REGISTRY:  ghcr.io
  API_IMAGE: ghcr.io/${{ github.repository }}/eom-api
  WEB_IMAGE: ghcr.io/${{ github.repository }}/eom-studio

jobs:
  build-api:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.API_IMAGE }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=,format=short
      - uses: docker/build-push-action@v5
        with:
          context:    apps/api
          file:       apps/api/Dockerfile.prod
          push:       true
          tags:       ${{ steps.meta.outputs.tags }}
          labels:     ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to:   type=gha,mode=max

  build-studio:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.WEB_IMAGE }}
      - uses: docker/build-push-action@v5
        with:
          context: apps/studio
          file:    apps/studio/Dockerfile.prod
          push:    true
          tags:    ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to:   type=gha,mode=max
```

---

### PR Validation Pipeline

```yaml
# .github/workflows/pr-validation.yml
name: PR Validation

on: pull_request

jobs:
  schema-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - run: |
          eom lint --strict --worktree .
        env:
          EOM_SPACE_ID: ${{ vars.PR_TEST_SPACE_ID }}

  opa-classification:
    runs-on: ubuntu-latest
    needs: schema-lint
    steps:
      - uses: actions/checkout@v4
      - uses: open-policy-agent/setup-opa@v2
        with: { version: latest }
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - run: |
          # Generate semantic diff JSON
          eom diff --json main..${{ github.head_ref }} > diff.json
          # OPA classify
          opa eval \
            --bundle apps/api/opa_policies/ \
            --input diff.json \
            'data.eom.schema' \
            --format pretty > classification.json
          cat classification.json
          # Post as PR comment
          eom pr comment --classification classification.json \
            --pr ${{ github.event.number }}
        env:
          EOM_API_URL:   ${{ vars.EOM_API_URL }}
          EOM_API_TOKEN: ${{ secrets.EOM_API_TOKEN }}
          EOM_SPACE_ID:  ${{ vars.PR_TEST_SPACE_ID }}

  duplication-radar:
    runs-on: ubuntu-latest
    needs: schema-lint
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - run: |
          eom measure --branch ${{ github.head_ref }} --output sizing.json
          # Fail if any new type exceeds size threshold
          python -c "
          import json, sys
          data = json.load(open('sizing.json'))
          oversized = [r for r in data.get('estimates',[]) if r.get('es_delta_bytes',0) > 5e9]
          if oversized:
              print(f'ERROR: {len(oversized)} type(s) exceed 5 GB ES size budget:')
              for r in oversized: print(f'  {r[\"object_type\"]}: {r[\"es_delta_bytes\"]/1e9:.1f} GB')
              sys.exit(1)
          print('Size check passed.')
          "
        env:
          EOM_API_URL:   ${{ vars.EOM_API_URL }}
          EOM_API_TOKEN: ${{ secrets.EOM_API_TOKEN }}
          EOM_SPACE_ID:  ${{ vars.PR_TEST_SPACE_ID }}

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd apps/api && uv sync
      - run: cd apps/api && uv run pytest tests/unit/ -v --tb=short
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: cd apps/studio && pnpm install && pnpm test --run

  opa-unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: open-policy-agent/setup-opa@v2
        with: { version: latest }
      - run: opa test apps/api/opa_policies/ -v --exit-zero-on-skipped

  check-approval-gates:
    runs-on: ubuntu-latest
    needs: [opa-classification, unit-tests, opa-unit-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - run: |
          eom pr check-approvals \
            --pr ${{ github.event.number }} \
            --classification classification.json
        env:
          EOM_API_URL:   ${{ vars.EOM_API_URL }}
          EOM_API_TOKEN: ${{ secrets.EOM_API_TOKEN }}
          EOM_SPACE_ID:  ${{ vars.PR_TEST_SPACE_ID }}
```

---

### SDK Publish on Merge to Main

```yaml
# .github/workflows/publish-sdk.yml
name: Publish SDK

on:
  push:
    branches: [main]

jobs:
  publish-sdk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd packages/eom-cli && uv sync
      - name: Generate and publish SDKs for all spaces
        run: |
          eom sdk generate --all-spaces
          eom sdk publish --python-registry ${{ vars.PYPI_REGISTRY_URL }} \
                          --npm-registry    ${{ vars.NPM_REGISTRY_URL }}
        env:
          EOM_API_URL:   ${{ vars.EOM_API_URL }}
          EOM_API_TOKEN: ${{ secrets.EOM_API_TOKEN }}
          PYPI_TOKEN:    ${{ secrets.PYPI_TOKEN }}
          NPM_TOKEN:     ${{ secrets.NPM_TOKEN }}
```

---

### Release Pipeline

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Set image tag
        run: echo "IMAGE_TAG=${GITHUB_REF_NAME}" >> $GITHUB_ENV

      - name: Deploy API
        uses: azure/k8s-set-context@v4
        with:
          method: kubeconfig
          kubeconfig: ${{ secrets.KUBECONFIG }}
      - run: |
          kubectl set image deployment/eom-api \
            api=ghcr.io/${{ github.repository }}/eom-api:${{ env.IMAGE_TAG }} \
            -n eom
          kubectl rollout status deployment/eom-api -n eom --timeout=5m

      - name: Deploy Studio
        run: |
          kubectl set image deployment/eom-studio \
            studio=ghcr.io/${{ github.repository }}/eom-studio:${{ env.IMAGE_TAG }} \
            -n eom
          kubectl rollout status deployment/eom-studio -n eom --timeout=5m

      - name: Run smoke tests
        run: |
          API_URL="${{ vars.PRODUCTION_API_URL }}"
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
          if [ "$STATUS" != "200" ]; then
            echo "Smoke test failed: GET /health returned $STATUS"
            exit 1
          fi
          echo "Smoke test passed"
```

---

## Environment Variables Reference

### Backend (apps/api/.env)

```bash
# Infrastructure
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_PASSWORD=

ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=

OPA_URL=http://localhost:8181

DATABASE_URL=postgresql://eom:eom_dev_password@localhost:5432/eom

# Git
GIT_REPOS_BASE_PATH=/tmp/eom-repos

# Auth
JWT_ISSUER=http://localhost:8000
JWT_AUDIENCE=http://localhost:8000
JWT_SECRET=dev-secret-change-in-prod
JWT_ALGORITHM=HS256

# Embeddings (leave empty to disable in dev)
EMBEDDING_MODEL_ENDPOINT=
EMBEDDING_VECTOR_DIMS=1536

# SDK publishing (leave empty in dev)
SDK_PYPI_REGISTRY=
SDK_NPM_REGISTRY=

# Observability
LOG_LEVEL=DEBUG
OTEL_EXPORTER_OTLP_ENDPOINT=

# OAG (Ontology Augmented Generation)
OAG_ENABLED=false
```

### Frontend (apps/studio/.env)

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

### CI/CD (GitHub Actions variables / secrets)

```bash
# vars (non-secret)
EOM_API_URL=https://eom-api.your-company.com
PR_TEST_SPACE_ID=ci-test-space
PRODUCTION_API_URL=https://eom-api.your-company.com
PYPI_REGISTRY_URL=https://pypi.your-company.com/simple
NPM_REGISTRY_URL=https://npm.your-company.com

# secrets
EOM_API_TOKEN=<service account JWT>
KUBECONFIG=<base64 encoded kubeconfig>
PYPI_TOKEN=<pypi publish token>
NPM_TOKEN=<npm publish token>
```

---

## Observability Setup

### Prometheus scrape config

```yaml
# infra/observability/prometheus.yml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: eom-api
    static_configs:
      - targets: ["eom-api:8000"]
    metrics_path: /metrics

  - job_name: elasticsearch
    static_configs:
      - targets: ["eom-elasticsearch-exporter:9114"]

  - job_name: falkordb
    static_configs:
      - targets: ["eom-falkordb:6379"]
    metrics_path: /metrics
```

### FastAPI metrics endpoint

```python
# apps/api/routers/metrics_endpoint.py
# Add Prometheus metrics to FastAPI via prometheus-fastapi-instrumentator
from prometheus_fastapi_instrumentator import Instrumentator

def setup_metrics(app):
    Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        excluded_handlers=["/metrics", "/health"],
    ).instrument(app).expose(app, endpoint="/metrics")
```

Add to `main.py`:

```python
from .routers.metrics_endpoint import setup_metrics
setup_metrics(app)
```
