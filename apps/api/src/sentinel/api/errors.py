"""HTTP errors that use the sentinel problem-details handler."""

from typing import ClassVar

from sentinel.core.errors import SentinelError


class BadRequestError(SentinelError):
    """The request is well formed JSON and still not acceptable."""

    code: ClassVar[str] = "bad_request"
    status_code: ClassVar[int] = 400
    title: ClassVar[str] = "Bad Request"


class NotFoundError(SentinelError):
    """The path names a case that is not stored."""

    code: ClassVar[str] = "not_found"
    status_code: ClassVar[int] = 404
    title: ClassVar[str] = "Not Found"


class ConflictError(SentinelError):
    """The case is in a state that rejects this action."""

    code: ClassVar[str] = "conflict"
    status_code: ClassVar[int] = 409
    title: ClassVar[str] = "Conflict"


class NotImplementedRouteError(SentinelError):
    """The path is registered and the action is not available yet."""

    code: ClassVar[str] = "not_implemented"
    status_code: ClassVar[int] = 501
    title: ClassVar[str] = "Not Implemented"
