"""RFC 7807 problem responses."""

from fastapi.responses import JSONResponse

from sentinel.core.logging import request_id_var


def problem_response(
    path: str,
    *,
    status: int,
    title: str,
    detail: str,
    code: str,
) -> JSONResponse:
    """Return ``application/problem+json`` for ``path``."""
    body: dict[str, object] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code,
        "instance": path,
    }
    request_id = request_id_var.get()
    if request_id is not None:
        body["request_id"] = request_id
    return JSONResponse(
        status_code=status,
        content=body,
        media_type="application/problem+json",
    )


def validation_detail(errors: list[object]) -> str:
    """Flatten FastAPI validation errors without echoing submitted values."""
    parts: list[str] = []
    for item in errors:
        if not isinstance(item, dict):
            continue
        loc = item.get("loc")
        location = ""
        if isinstance(loc, tuple):
            location = ".".join(str(part) for part in loc if part != "body")
        message = item.get("msg")
        text = message if isinstance(message, str) and message != "" else "Invalid request"
        parts.append(f"{location}: {text}" if location else text)
    return "; ".join(parts) if parts else "Invalid request"
