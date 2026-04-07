from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # FalkorDB
    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    falkordb_password: str = ""

    # Elasticsearch
    elasticsearch_url: str = "http://localhost:9200"
    elasticsearch_username: str = ""
    elasticsearch_password: str = ""

    # OPA
    opa_url: str = "http://localhost:8181"

    # Git
    git_repos_base_path: str = "/tmp/eom-repos"

    # JWT
    jwt_secret: str = "dev-secret-change-in-prod"
    jwt_issuer: str = "http://localhost:8000"

    # Embeddings
    embedding_model_endpoint: str = ""
    embedding_vector_dims: int = 1536

    # Logging
    log_level: str = "DEBUG"


settings = Settings()
