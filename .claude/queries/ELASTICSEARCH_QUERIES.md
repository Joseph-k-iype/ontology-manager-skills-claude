# Elasticsearch Query Reference

> All Elasticsearch query patterns used by EOM. Use the async Python client
> (`elasticsearch-py`). All searches filter by `_eom_space_id` to enforce
> tenant isolation. Sensitive field masking is applied after retrieval.

---

## Search Patterns

### Hybrid Search (BM25 + kNN + RRF) — Standard

The default search for all object type queries. Always use this pattern
when a user submits a search query. Never combine scores manually.

```python
async def hybrid_search(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    query_text: str,
    query_vector: list[float] | None,
    extra_filters: list[dict] = None,
    sensitivity_levels: list[str] = None,
    size: int = 20,
    knn_k: int = 50,
    knn_num_candidates: int = 200,
    rrf_window_size: int = 100,
    rrf_rank_constant: int = 60,
) -> dict:
    alias    = f"eom_{space_id}_{object_type}"
    base_filter = [
        {"term": {"_eom_space_id": space_id}},
        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
    ]
    if sensitivity_levels:
        base_filter.append({"terms": {"_eom_sensitivity": sensitivity_levels}})
    if extra_filters:
        base_filter.extend(extra_filters)

    body = {
        "size": size,
        "rank": {
            "rrf": {
                "window_size": rrf_window_size,
                "rank_constant": rrf_rank_constant,
            }
        },
        "query": {
            "bool": {
                "must": [{
                    "multi_match": {
                        "query":  query_text,
                        "fields": ["_semantic_text^2", "_eom_tags"],
                        "type":   "best_fields",
                        "minimum_should_match": "1",
                    }
                }],
                "filter": base_filter,
            }
        },
    }

    if query_vector:
        body["knn"] = {
            "field":         "_embedding",
            "query_vector":  query_vector,
            "k":             knn_k,
            "num_candidates":knn_num_candidates,
            "filter":        base_filter,
        }

    return await es.search(index=alias, body=body)
```

### Pure BM25 Keyword Search

```python
async def keyword_search(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    query_text: str,
    fields: list[str] = None,
    size: int = 20,
    from_: int = 0,
) -> dict:
    alias   = f"eom_{space_id}_{object_type}"
    search_fields = fields or ["_semantic_text^2", "_eom_tags^1.5"]

    return await es.search(
        index=alias,
        body={
            "from":  from_,
            "size":  size,
            "query": {
                "bool": {
                    "must": [{
                        "multi_match": {
                            "query":  query_text,
                            "fields": search_fields,
                            "type":   "best_fields",
                        }
                    }],
                    "filter": [
                        {"term": {"_eom_space_id": space_id}},
                        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
                    ],
                }
            },
            "highlight": {
                "fields": {"_semantic_text": {}},
                "pre_tags":  ["<mark>"],
                "post_tags": ["</mark>"],
            },
        },
    )
```

### Pure kNN Vector Search

```python
async def vector_search(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    query_vector: list[float],
    k: int = 20,
    num_candidates: int = 100,
    extra_filters: list[dict] = None,
) -> dict:
    alias   = f"eom_{space_id}_{object_type}"
    filters = [
        {"term": {"_eom_space_id": space_id}},
        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
    ]
    if extra_filters:
        filters.extend(extra_filters)

    return await es.search(
        index=alias,
        body={
            "size": k,
            "knn": {
                "field":          "_embedding",
                "query_vector":   query_vector,
                "k":              k,
                "num_candidates": num_candidates,
                "filter":         filters,
            },
        },
    )
```

---

## Filter / List Patterns

### List with Filters, Sort, and Pagination

```python
async def list_objects(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    filters: list[dict],         # [{term: {status: "ACTIVE"}}]
    sort: list[dict] | None,     # [{"_eom_created_at": {"order": "desc"}}]
    page: int = 1,
    page_size: int = 20,
) -> dict:
    alias  = f"eom_{space_id}_{object_type}"
    from_  = (page - 1) * page_size

    return await es.search(
        index=alias,
        body={
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
            "sort": sort or [{"_eom_created_at": {"order": "desc"}}],
        },
    )
```

### Filter Builders (helper functions)

```python
def term_filter(field: str, value) -> dict:
    return {"term": {field: value}}

def terms_filter(field: str, values: list) -> dict:
    return {"terms": {field: values}}

def range_filter(field: str, gte=None, lte=None, gt=None, lt=None) -> dict:
    rng = {}
    if gte is not None: rng["gte"] = gte
    if lte is not None: rng["lte"] = lte
    if gt  is not None: rng["gt"]  = gt
    if lt  is not None: rng["lt"]  = lt
    return {"range": {field: rng}}

def exists_filter(field: str) -> dict:
    return {"exists": {"field": field}}

def prefix_filter(field: str, prefix: str) -> dict:
    return {"prefix": {field: prefix}}

def wildcard_filter(field: str, pattern: str) -> dict:
    return {"wildcard": {field: {"value": pattern}}}
```

### Get Object by ID (ES — for read with sensitivity masking)

```python
async def get_object_by_id(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    object_id: str,
    source_includes: list[str] | None = None,
    source_excludes: list[str] | None = None,
) -> dict | None:
    alias = f"eom_{space_id}_{object_type}"
    try:
        response = await es.get(
            index=alias,
            id=object_id,
            source_includes=source_includes,
            source_excludes=source_excludes,
        )
        return response["_source"]
    except NotFoundError:
        return None
```

---

## Aggregation Patterns

### Count by Field (for dashboards)

```python
async def count_by_field(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    field: str,
    size: int = 50,
) -> dict[str, int]:
    alias    = f"eom_{space_id}_{object_type}"
    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"_eom_space_id": space_id}},
                        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
                    ]
                }
            },
            "aggs": {
                "by_field": {
                    "terms": {"field": field, "size": size}
                }
            },
        },
    )
    return {
        b["key"]: b["doc_count"]
        for b in response["aggregations"]["by_field"]["buckets"]
    }
```

### Date Histogram (trend charts)

```python
async def date_histogram(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    date_field: str = "_eom_created_at",
    interval: str = "1d",     # e.g. "1d", "1w", "1M"
    from_epoch: int | None = None,
    to_epoch: int | None = None,
) -> list[dict]:
    alias   = f"eom_{space_id}_{object_type}"
    filters = [{"term": {"_eom_space_id": space_id}}]
    if from_epoch or to_epoch:
        rng = {}
        if from_epoch: rng["gte"] = from_epoch
        if to_epoch:   rng["lte"] = to_epoch
        filters.append({"range": {date_field: rng}})

    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {"bool": {"filter": filters}},
            "aggs": {
                "over_time": {
                    "date_histogram": {
                        "field":            date_field,
                        "fixed_interval":   interval,
                        "min_doc_count":    0,
                    }
                }
            },
        },
    )
    return [
        {"date": b["key_as_string"], "count": b["doc_count"]}
        for b in response["aggregations"]["over_time"]["buckets"]
    ]
```

### Sum / Avg of Numeric Field

```python
async def numeric_stats(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    field: str,
    filters: list[dict] = None,
) -> dict:
    alias    = f"eom_{space_id}_{object_type}"
    all_filters = [
        {"term": {"_eom_space_id": space_id}},
        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
    ]
    if filters:
        all_filters.extend(filters)

    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {"bool": {"filter": all_filters}},
            "aggs": {
                "stats": {
                    "extended_stats": {"field": field}
                }
            },
        },
    )
    return response["aggregations"]["stats"]
```

### Multi-Metric Dashboard Aggregation

```python
async def dashboard_stats(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
) -> dict:
    alias    = f"eom_{space_id}_{object_type}"
    response = await es.search(
        index=alias,
        body={
            "size": 0,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"_eom_space_id": space_id}},
                        {"bool": {"must_not": {"exists": {"field": "_eom_deleted_at"}}}},
                    ]
                }
            },
            "aggs": {
                "total_count":       {"value_count": {"field": "_eom_id"}},
                "by_status":         {"terms": {"field": "status", "size": 20}},
                "by_sensitivity":    {"terms": {"field": "_eom_sensitivity", "size": 10}},
                "created_last_30d":  {
                    "filter": {"range": {"_eom_created_at": {"gte": "now-30d"}}},
                },
                "updated_last_7d":   {
                    "filter": {"range": {"_eom_updated_at": {"gte": "now-7d"}}},
                },
            },
        },
    )
    aggs = response["aggregations"]
    return {
        "total":           aggs["total_count"]["value"],
        "by_status":       {b["key"]: b["doc_count"] for b in aggs["by_status"]["buckets"]},
        "by_sensitivity":  {b["key"]: b["doc_count"] for b in aggs["by_sensitivity"]["buckets"]},
        "created_last_30d":aggs["created_last_30d"]["doc_count"],
        "updated_last_7d": aggs["updated_last_7d"]["doc_count"],
    }
```

---

## Document Write Patterns

### Upsert Object Document

```python
async def upsert_object(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    object_id: str,
    doc: dict,
) -> None:
    write_alias = f"eom_{space_id}_{object_type}_write"
    await es.update(
        index=write_alias,
        id=object_id,
        body={"doc": doc, "doc_as_upsert": True},
        retry_on_conflict=3,
    )

async def partial_update(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    object_id: str,
    fields: dict,
) -> None:
    """Update only specific fields — use after action execution."""
    write_alias = f"eom_{space_id}_{object_type}_write"
    await es.update(
        index=write_alias,
        id=object_id,
        body={"doc": fields},
        retry_on_conflict=3,
    )
```

### Bulk Upsert

```python
async def bulk_upsert(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    documents: list[dict],  # each must have _eom_id
) -> dict:
    from elasticsearch.helpers import async_bulk
    write_alias = f"eom_{space_id}_{object_type}_write"

    actions = [
        {
            "_op_type": "update",
            "_index":   write_alias,
            "_id":      doc["_eom_id"],
            "doc":      doc,
            "doc_as_upsert": True,
        }
        for doc in documents
    ]

    success, errors = await async_bulk(es, actions, raise_on_error=False)
    return {"success": success, "errors": errors}
```

---

## Audit Log Queries

### Write Audit Entry

```python
import time, uuid

async def write_audit_entry(
    es: AsyncElasticsearch,
    entry: dict,
) -> None:
    await es.index(
        index="eom_audit_log",
        id=entry.get("event_id") or str(uuid.uuid4()),
        body={**entry, "timestamp": int(time.time() * 1000)},
    )
```

### Query Audit Log for an Object

```python
async def get_object_audit_log(
    es: AsyncElasticsearch,
    space_id: str,
    object_id: str,
    from_: int = 0,
    size: int = 50,
) -> dict:
    return await es.search(
        index="eom_audit_log",
        body={
            "from": from_,
            "size": size,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"space_id":  space_id}},
                        {"term": {"object_id": object_id}},
                    ]
                }
            },
            "sort": [{"timestamp": {"order": "desc"}}],
        },
    )
```

### Query Audit Log for an Action Type

```python
async def get_action_type_log(
    es: AsyncElasticsearch,
    space_id: str,
    action_type: str,
    status: str | None = None,
    from_epoch: int | None = None,
    size: int = 50,
) -> dict:
    filters = [
        {"term": {"space_id":   space_id}},
        {"term": {"action_type":action_type}},
    ]
    if status:
        filters.append({"term": {"status": status}})
    if from_epoch:
        filters.append({"range": {"timestamp": {"gte": from_epoch}}})

    return await es.search(
        index="eom_audit_log",
        body={
            "size": size,
            "query": {"bool": {"filter": filters}},
            "sort": [{"timestamp": {"order": "desc"}}],
            "aggs": {
                "by_status": {"terms": {"field": "status", "size": 5}},
                "avg_duration": {"avg": {"field": "duration_ms"}},
            },
        },
    )
```

---

## Metrics Queries

### Write Metric Data Point

```python
async def write_metric(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    metric_name: str,
    value: float,
    tags: dict = None,
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

### Read Metric Time Series

```python
async def get_metric_series(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    metric_name: str,
    from_epoch: int,
    to_epoch: int,
    interval: str = "1h",
) -> list[dict]:
    response = await es.search(
        index="eom_metrics",
        body={
            "size": 0,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"space_id":    space_id}},
                        {"term": {"object_type": object_type}},
                        {"term": {"metric_name": metric_name}},
                        {"range": {"timestamp":  {"gte": from_epoch, "lte": to_epoch}}},
                    ]
                }
            },
            "aggs": {
                "over_time": {
                    "date_histogram": {
                        "field":          "timestamp",
                        "fixed_interval": interval,
                    },
                    "aggs": {
                        "avg_val": {"avg": {"field": "value"}},
                        "max_val": {"max": {"field": "value"}},
                    },
                }
            },
        },
    )
    return [
        {
            "ts":      b["key"],
            "date":    b["key_as_string"],
            "avg":     b["avg_val"]["value"],
            "max":     b["max_val"]["value"],
            "count":   b["doc_count"],
        }
        for b in response["aggregations"]["over_time"]["buckets"]
    ]
```

---

## Index Management

### Check Index Exists

```python
async def index_exists(es: AsyncElasticsearch, index_name: str) -> bool:
    return await es.indices.exists(index=index_name)
```

### Get Index Stats (for volume metrics)

```python
async def get_index_stats(es: AsyncElasticsearch, alias: str) -> dict:
    stats = await es.indices.stats(index=alias, metric=["docs", "store"])
    idx   = stats["_all"]["total"]
    return {
        "doc_count":    idx["docs"]["count"],
        "deleted_docs": idx["docs"]["deleted"],
        "size_bytes":   idx["store"]["size_in_bytes"],
    }
```

### Refresh Index (after bulk load)

```python
async def refresh_index(es: AsyncElasticsearch, alias: str) -> None:
    await es.indices.refresh(index=alias)
```

### Delete Documents Matching Filter

```python
async def delete_by_query(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    filter_query: dict,
) -> int:
    write_alias = f"eom_{space_id}_{object_type}_write"
    response    = await es.delete_by_query(
        index=write_alias,
        body={"query": filter_query},
        refresh=True,
    )
    return response["deleted"]
```

---

## OAG (Ontology Augmented Generation) Queries

### Index a Document Chunk

```python
async def index_oag_chunk(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    chunk_id: str,
    chunk_text: str,
    embedding: list[float],
    source_doc_id: str,
    source_doc_name: str,
    chunk_index: int,
) -> None:
    import time
    index = f"eom_{space_id}_{object_type}_oag"
    await es.index(
        index=index,
        id=chunk_id,
        body={
            "chunk_id":       chunk_id,
            "object_type":    object_type,
            "space_id":       space_id,
            "source_doc_id":  source_doc_id,
            "source_doc_name":source_doc_name,
            "chunk_text":     chunk_text,
            "chunk_index":    chunk_index,
            "_embedding":     embedding,
            "indexed_at":     int(time.time() * 1000),
        },
    )
```

### OAG Search (RAG retrieval)

```python
async def oag_search(
    es: AsyncElasticsearch,
    space_id: str,
    object_type: str,
    question_vector: list[float],
    k: int = 5,
) -> list[dict]:
    index    = f"eom_{space_id}_{object_type}_oag"
    response = await es.search(
        index=index,
        body={
            "size": k,
            "knn": {
                "field":          "_embedding",
                "query_vector":   question_vector,
                "k":              k,
                "num_candidates": k * 4,
                "filter":         [{"term": {"space_id": space_id}}],
            },
            "_source": ["chunk_text", "source_doc_name", "chunk_index", "source_doc_id"],
        },
    )
    return [
        {**h["_source"], "score": h["_score"]}
        for h in response["hits"]["hits"]
    ]
```
