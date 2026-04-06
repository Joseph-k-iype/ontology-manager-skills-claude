# Elasticsearch Skill

> Read this before writing any Elasticsearch code. ES is the semantic search,
> full-text, aggregation, and analytics layer for EOM. Every Object Type gets
> its own index. All semantic search uses BM25 + kNN hybrid with RRF fusion.

---

## Connection

```python
# apps/api/dependencies.py
from elasticsearch import AsyncElasticsearch
import os

_es_client: AsyncElasticsearch | None = None

def get_es_client() -> AsyncElasticsearch:
    global _es_client
    if _es_client is None:
        kwargs = {"hosts": [os.environ["ELASTICSEARCH_URL"]]}
        user = os.environ.get("ELASTICSEARCH_USERNAME")
        pwd  = os.environ.get("ELASTICSEARCH_PASSWORD")
        if user and pwd:
            kwargs["basic_auth"] = (user, pwd)
        _es_client = AsyncElasticsearch(**kwargs)
    return _es_client
```

---

## Index Naming Conventions

```
Per-object-type indices:
  Versioned:  eom_{space_id}_{object_type_api_name}_v{N}
              e.g.  eom_abc123_order_v3
  Read alias: eom_{space_id}_{object_type_api_name}
              e.g.  eom_abc123_order
  Write alias:eom_{space_id}_{object_type_api_name}_write
              e.g.  eom_abc123_order_write

  Sandbox (branch):
              eom_{space_id}_{branch_slug}_{object_type}_v{N}

System indices:
  eom_meta_object_types    ← schema semantic descriptions (for duplication radar)
  eom_audit_log            ← action execution audit trail
  eom_metrics              ← volume + health metrics time series
  eom_{space_id}_{type}_oag ← Ontology Augmented Generation corpus
```

---

## Standard Index Mapping

Every Object Type index is generated from the YAML manifest by the Schema
Service. This is the base mapping template — user-defined fields are appended
by the compiler.

```python
BASE_MAPPING = {
    "mappings": {
        "dynamic": False,
        "_source": {"enabled": True},
        "properties": {
            # ── System fields ────────────────────────────────────────────
            "_eom_id":           {"type": "keyword"},
            "_eom_type":         {"type": "keyword"},
            "_eom_space_id":     {"type": "keyword"},
            "_eom_version":      {"type": "keyword"},
            "_eom_created_at":   {"type": "date", "format": "epoch_millis"},
            "_eom_updated_at":   {"type": "date", "format": "epoch_millis"},
            "_eom_sensitivity":  {"type": "keyword"},
            "_eom_tags":         {"type": "keyword"},
            "_eom_deleted_at":   {"type": "date", "format": "epoch_millis"},

            # ── Semantic search fields ───────────────────────────────────
            "_semantic_text": {
                "type": "text",
                "analyzer": "eom_semantic_analyzer",
                # Concatenation of all text properties — drives BM25 leg
            },
            "_embedding": {
                "type": "dense_vector",
                "dims": 1536,                  # configurable via EMBEDDING_VECTOR_DIMS
                "index": True,
                "similarity": "cosine",
            },

            # ── Graph topology fields ────────────────────────────────────
            "_linked_ids":           {"type": "keyword"},   # IDs of directly linked objects
            "_link_types_present":   {"type": "keyword"},   # link type api_names present

            # ── Action metadata ──────────────────────────────────────────
            "_last_action":     {"type": "keyword"},
            "_last_actor":      {"type": "keyword"},
            "_last_action_at":  {"type": "date", "format": "epoch_millis"},
        },
    },
    "settings": {
        "number_of_shards":   1,
        "number_of_replicas": 1,
        "analysis": {
            "analyzer": {
                "eom_semantic_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "stop", "snowball"],
                }
            }
        },
    },
}
```

### Adding User-Defined Fields (Schema Compiler Output)

```python
# Schema compiler appends user fields to BASE_MAPPING["mappings"]["properties"]
FIELD_TYPE_MAP = {
    "String":       {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}},
    "Keyword":      {"type": "keyword"},
    "Integer":      {"type": "integer"},
    "Long":         {"type": "long"},
    "Double":       {"type": "double"},
    "Boolean":      {"type": "boolean"},
    "Timestamp":    {"type": "date", "format": "epoch_millis||strict_date_time"},
    "Date":         {"type": "date", "format": "strict_date"},
    "GeoPoint":     {"type": "geo_point"},
    "GeoShape":     {"type": "geo_shape"},
    "Struct":       {"type": "object", "dynamic": False},
    "TimeseriesRef":{"type": "keyword"},
    "MediaRef":     {"type": "keyword"},
    "AttachmentRef":{"type": "keyword"},
}
```

---

## Index Lifecycle — Create / Migrate / Delete

```python
from elasticsearch import AsyncElasticsearch

async def create_index_for_object_type(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    version: int,
    mapping: dict,
) -> None:
    index_name = f"eom_{space_id}_{object_type}_v{version}"
    alias_name = f"eom_{space_id}_{object_type}"
    write_alias = f"{alias_name}_write"

    # Create the versioned index
    await es.indices.create(index=index_name, body=mapping)

    # Create read alias pointing to new index
    await es.indices.put_alias(index=index_name, name=alias_name)
    await es.indices.put_alias(index=index_name, name=write_alias)


async def zero_downtime_schema_migration(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    old_version: int,
    new_version: int,
    new_mapping: dict,
) -> None:
    old_idx   = f"eom_{space_id}_{object_type}_v{old_version}"
    new_idx   = f"eom_{space_id}_{object_type}_v{new_version}"
    alias     = f"eom_{space_id}_{object_type}"
    write_al  = f"{alias}_write"

    # 1. Create new index
    await es.indices.create(index=new_idx, body=new_mapping)

    # 2. Reindex from old to new
    await es.reindex(body={
        "source": {"index": old_idx},
        "dest":   {"index": new_idx},
    }, wait_for_completion=True)

    # 3. Atomic alias swap (old → new)
    await es.indices.update_aliases(body={
        "actions": [
            {"remove": {"index": old_idx, "alias": alias}},
            {"remove": {"index": old_idx, "alias": write_al}},
            {"add":    {"index": new_idx, "alias": alias}},
            {"add":    {"index": new_idx, "alias": write_al}},
        ]
    })

    # 4. Schedule old index deletion (after grace period — do not delete immediately)
    # Use APScheduler or Celery to delete old_idx after 7 days
```

---

## Document Upsert

```python
async def upsert_object_document(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    object_id: str,
    doc: dict,
) -> None:
    alias = f"eom_{space_id}_{object_type}_write"
    await es.update(
        index=alias,
        id=object_id,
        body={"doc": doc, "doc_as_upsert": True},
    )

async def delete_object_document(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    object_id: str,
) -> None:
    alias = f"eom_{space_id}_{object_type}_write"
    await es.delete(index=alias, id=object_id, ignore=[404])
```

---

## Hybrid Search — BM25 + kNN with RRF

This is the standard search pattern. Always use RRF — never combine scores manually.

```python
async def hybrid_search(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    query_text: str,
    query_vector: list[float] | None,
    filters: list[dict],
    size: int = 20,
    sensitivity_filter: list[str] = None,
) -> list[dict]:
    alias = f"eom_{space_id}_{object_type}"

    # Base filter — always include space_id and sensitivity
    must_filters = [
        {"term": {"_eom_space_id": space_id}},
        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
    ]
    if sensitivity_filter:
        must_filters.append({"terms": {"_eom_sensitivity": sensitivity_filter}})
    must_filters.extend(filters)  # caller-supplied filters

    body = {
        "size": size,
        "rank": {
            "rrf": {
                "window_size": 100,
                "rank_constant": 60,   # k in 1/(k + rank), tune if needed
            }
        },
        # BM25 leg
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": query_text,
                            "fields": ["_semantic_text^2", "_eom_tags"],
                            "type": "best_fields",
                        }
                    }
                ],
                "filter": must_filters,
            }
        },
    }

    # kNN leg (only if embedding is provided)
    if query_vector:
        body["knn"] = {
            "field": "_embedding",
            "query_vector": query_vector,
            "k": 50,
            "num_candidates": 200,
            "filter": must_filters,
        }

    response = await es.search(index=alias, body=body)
    return [
        {"id": hit["_id"], "score": hit["_score"], "source": hit["_source"]}
        for hit in response["hits"]["hits"]
    ]
```

---

## Graph-Topology Boost (post-RRF re-ranking)

```python
async def graph_topology_boost(
    results: list[dict],
    top_n_ids: list[str],  # IDs of top-10 RRF results
    boost_factor: float = 0.2,
) -> list[dict]:
    """
    Re-rank results by boosting objects linked to the top-N results.
    linked_count = number of top_n_ids in result["source"]["_linked_ids"]
    final_score  = rrf_score * (1 + boost_factor * linked_count)
    """
    top_id_set = set(top_n_ids)
    for result in results:
        linked = set(result["source"].get("_linked_ids") or [])
        linked_hits = len(linked & top_id_set)
        result["final_score"] = result["score"] * (1 + boost_factor * linked_hits)
    return sorted(results, key=lambda r: r["final_score"], reverse=True)
```

---

## Keyword / Filter-Only Search

```python
async def filter_objects(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    filters: list[dict],
    sort: list[dict],
    page: int,
    page_size: int,
) -> dict:
    alias = f"eom_{space_id}_{object_type}"
    from_   = (page - 1) * page_size

    body = {
        "from": from_,
        "size": page_size,
        "query": {
            "bool": {
                "filter": [
                    {"term": {"_eom_space_id": space_id}},
                    {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
                    *filters,
                ]
            }
        },
        "sort": sort or [{"_eom_created_at": "desc"}],
    }

    response = await es.search(index=alias, body=body)
    return {
        "total": response["hits"]["total"]["value"],
        "items": [h["_source"] for h in response["hits"]["hits"]],
    }
```

---

## Aggregations

```python
# Count by field value (e.g. objects by status)
async def count_by_field(
    es: AsyncElasticsearch, space_id: str, object_type: str, field: str
) -> dict:
    alias = f"eom_{space_id}_{object_type}"
    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {"term": {"_eom_space_id": space_id}},
            "aggs": {
                "by_field": {
                    "terms": {"field": field, "size": 50}
                }
            },
        },
    )
    return {
        b["key"]: b["doc_count"]
        for b in response["aggregations"]["by_field"]["buckets"]
    }

# Date histogram (e.g. objects created per day)
async def date_histogram(
    es: AsyncElasticsearch, space_id: str, object_type: str,
    date_field: str, calendar_interval: str = "day"
) -> list[dict]:
    alias = f"eom_{space_id}_{object_type}"
    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {"term": {"_eom_space_id": space_id}},
            "aggs": {
                "over_time": {
                    "date_histogram": {
                        "field": date_field,
                        "calendar_interval": calendar_interval,
                    }
                }
            },
        },
    )
    return response["aggregations"]["over_time"]["buckets"]
```

---

## Audit Log

```python
AUDIT_LOG_MAPPING = {
    "mappings": {
        "dynamic": False,
        "properties": {
            "event_id":       {"type": "keyword"},
            "space_id":       {"type": "keyword"},
            "action_type":    {"type": "keyword"},
            "object_id":      {"type": "keyword"},
            "object_type":    {"type": "keyword"},
            "actor_id":       {"type": "keyword"},
            "actor_org_id":   {"type": "keyword"},
            "timestamp":      {"type": "date", "format": "epoch_millis"},
            "status":         {"type": "keyword"},      # SUCCESS | FAILED | DENIED
            "deny_reason":    {"type": "keyword"},
            "params":         {"type": "object",  "dynamic": True},
            "before_state":   {"type": "object",  "dynamic": True},
            "after_state":    {"type": "object",  "dynamic": True},
            "source_ip":      {"type": "ip"},
            "duration_ms":    {"type": "integer"},
        },
    },
    "settings": {
        "number_of_shards": 2,
        "number_of_replicas": 1,
    },
}

async def write_audit_log(es: AsyncElasticsearch, entry: dict) -> None:
    await es.index(
        index="eom_audit_log",
        id=entry["event_id"],
        body=entry,
    )
```

---

## Metrics Index

```python
METRICS_MAPPING = {
    "mappings": {
        "dynamic": False,
        "properties": {
            "metric_id":      {"type": "keyword"},
            "space_id":       {"type": "keyword"},
            "object_type":    {"type": "keyword"},
            "metric_name":    {"type": "keyword"},
            "value":          {"type": "double"},
            "timestamp":      {"type": "date", "format": "epoch_millis"},
            "tags":           {"type": "object", "dynamic": True},
        },
    },
}

async def write_metric(
    es: AsyncElasticsearch, space_id: str, object_type: str,
    metric_name: str, value: float, tags: dict | None = None,
) -> None:
    import time, uuid
    await es.index(
        index="eom_metrics",
        id=str(uuid.uuid4()),
        body={
            "metric_id":   str(uuid.uuid4()),
            "space_id":    space_id,
            "object_type": object_type,
            "metric_name": metric_name,
            "value":       value,
            "timestamp":   int(time.time() * 1000),
            "tags":        tags or {},
        },
    )
```

---

## Duplication Radar (Meta Index)

```python
# Nightly job: scan all Object Types for semantic similarity
async def run_duplication_radar(
    es: AsyncElasticsearch,
    space_id: str,
    threshold: float = 0.85,
) -> list[dict]:
    """
    For each Object Type, find others with cosine similarity >= threshold.
    Uses the _embedding field on the eom_meta_object_types index.
    """
    # 1. Get all object types for this space
    response = await es.search(
        index="eom_meta_object_types",
        body={
            "size": 1000,
            "query": {"term": {"space_id": space_id}},
            "_source": ["api_name", "_embedding"],
        },
    )
    types = response["hits"]["hits"]

    duplicates = []
    for t in types:
        if not t["_source"].get("_embedding"):
            continue
        # kNN search for similar types
        knn_response = await es.search(
            index="eom_meta_object_types",
            body={
                "size": 10,
                "knn": {
                    "field": "_embedding",
                    "query_vector": t["_source"]["_embedding"],
                    "k": 10,
                    "num_candidates": 50,
                    "filter": [
                        {"term": {"space_id": space_id}},
                        {"bool": {"must_not": {"term": {"api_name": t["_source"]["api_name"]}}}},
                    ],
                },
                "_source": ["api_name"],
            },
        )
        for hit in knn_response["hits"]["hits"]:
            if hit["_score"] >= threshold:
                duplicates.append({
                    "type_a": t["_source"]["api_name"],
                    "type_b": hit["_source"]["api_name"],
                    "similarity": hit["_score"],
                })
    return duplicates
```

---

## OAG Corpus Index

```python
OAG_MAPPING = {
    "mappings": {
        "dynamic": False,
        "properties": {
            "chunk_id":       {"type": "keyword"},
            "object_type":    {"type": "keyword"},
            "space_id":       {"type": "keyword"},
            "source_doc_id":  {"type": "keyword"},
            "source_doc_name":{"type": "keyword"},
            "chunk_text":     {"type": "text", "analyzer": "standard"},
            "chunk_index":    {"type": "integer"},
            "_embedding":     {"type": "dense_vector", "dims": 1536,
                               "index": True, "similarity": "cosine"},
            "indexed_at":     {"type": "date", "format": "epoch_millis"},
        },
    },
}

async def oag_query(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    question_vector: list[float],
    k: int = 5,
) -> list[dict]:
    index = f"eom_{space_id}_{object_type}_oag"
    response = await es.search(
        index=index,
        body={
            "size": k,
            "knn": {
                "field": "_embedding",
                "query_vector": question_vector,
                "k": k,
                "num_candidates": k * 4,
            },
            "_source": ["chunk_text", "source_doc_name", "chunk_index"],
        },
    )
    return [h["_source"] for h in response["hits"]["hits"]]
```

---

## Index Template for Shared Properties

```python
# Applied to all indices that include a shared property
# Ensures consistent mapping across all Object Types that use it

async def create_shared_property_template(
    es: AsyncElasticsearch,
    shared_prop_api_name: str,
    field_mapping: dict,
) -> None:
    template_name = f"eom_shared_prop_{shared_prop_api_name}"
    await es.indices.put_index_template(
        name=template_name,
        body={
            "index_patterns": ["eom_*"],   # applies to all EOM indices
            "priority": 100,
            "template": {
                "mappings": {
                    "properties": {
                        shared_prop_api_name: field_mapping
                    }
                }
            },
        },
    )
```
