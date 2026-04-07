from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import structlog

log = structlog.get_logger()


class EOMException(Exception):
    """Base exception for EOM errors."""

    def __init__(self, code: str, message: str, status_code: int = 500) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class NotFoundError(EOMException):
    def __init__(self, resource_type: str, resource_id: str) -> None:
        super().__init__(
            code="NOT_FOUND",
            message=f"{resource_type} '{resource_id}' not found",
            status_code=404,
        )


class OPADenyError(EOMException):
    def __init__(self, reason: str, action_type: str, resource_id: str = "") -> None:
        self.reason = reason
        self.action_type = action_type
        self.resource_id = resource_id
        super().__init__(
            code="OPA_DENY",
            message=f"Access denied: {reason}",
            status_code=403,
        )


class ConflictError(EOMException):
    def __init__(self, message: str) -> None:
        super().__init__(code="CONFLICT", message=message, status_code=409)


class ValidationError(EOMException):
    def __init__(self, message: str) -> None:
        super().__init__(code="VALIDATION_ERROR", message=message, status_code=422)


class FalkorDBError(EOMException):
    def __init__(self, message: str) -> None:
        super().__init__(code="FALKORDB_ERROR", message=message, status_code=500)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(EOMException)
    async def eom_exception_handler(request: Request, exc: EOMException) -> JSONResponse:
        log.error(
            "eom_exception",
            code=exc.code,
            message=exc.message,
            status_code=exc.status_code,
            path=request.url.path,
        )
        body: dict = {"code": exc.code, "detail": exc.message}
        if isinstance(exc, OPADenyError):
            body["action_type"] = exc.action_type
            body["reason"] = exc.reason
            if exc.resource_id:
                body["resource_id"] = exc.resource_id
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled_exception", error=str(exc), path=request.url.path)
        return JSONResponse(
            status_code=500,
            content={"code": "INTERNAL_ERROR", "detail": "An unexpected error occurred"},
        )
