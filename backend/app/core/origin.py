"""Refuses state-changing requests that come from another site.

CORS only hides responses: a POST without a body (approve, cancel, release…) is a "simple" request, so the browser
sends it from any page without asking, and it takes effect. Browsers mark every such request with `Origin` and
`Sec-Fetch-Site`; tools like curl and the run scripts send neither and are let through.
"""

from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class OriginGuard:
    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str]) -> None:
        self.app = app
        self.allowed = frozenset(o.rstrip("/") for o in allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            headers = Headers(scope=scope)
            origin = headers.get("origin")
            if (origin is not None and origin.rstrip("/") not in self.allowed) or headers.get("sec-fetch-site") == "cross-site":
                response = JSONResponse({"detail": "Request from another site refused"}, status_code=403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
