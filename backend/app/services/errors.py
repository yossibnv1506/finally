"""Service-layer exceptions (mapped to HTTP status codes by the API layer)."""


class ServiceError(ValueError):
    """A user-facing validation error (HTTP 400)."""


class NotFoundError(ServiceError):
    """The requested resource does not exist (HTTP 404)."""
