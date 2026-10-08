"""Read-only page fetching for agents: GET only, no cookies or auth, guarded redirects, size and type limits.

Each hop connects to the IP that `resolve_public` checked (the Host header and TLS SNI keep the real name,
so certificates are verified as usual); a fresh client per hop means no cookies are ever carried over.
"""

import re
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx
import trafilatura

from app.web.guard import BlockedUrl, Resolver, Target, parse_target, resolve_public, system_resolver

TEXT_TYPES = frozenset({"text/html", "application/xhtml+xml", "text/plain"})
USER_AGENT = "AI-Office-research/1.0 (local, read-only)"
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


class FetchError(Exception):
    """The page could not be read; the message is short and safe to show."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        """The HTTP status when the site answered with an error."""


@dataclass(frozen=True)
class FetchLimits:
    timeout: float = 15.0
    max_bytes: int = 2_000_000
    max_redirects: int = 5
    page_chars: int = 4000


@dataclass(frozen=True)
class Page:
    url: str
    title: str
    text: str
    truncated: bool


def cut(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return f"{text[:limit].rstrip()}\n[... page truncated, {len(text) - limit} more chars ...]", True


def html_to_text(html: str) -> tuple[str, str]:
    """Main text of a page (navigation, footers and ads dropped) and its title."""
    match = TITLE_RE.search(html)
    title = re.sub(r"\s+", " ", match.group(1)).strip() if match else ""
    text = trafilatura.extract(html, include_comments=False, include_tables=True, include_links=False) or ""
    return text.strip(), title


def _request_url(target: Target, ip: str) -> str:
    host = f"[{ip}]" if ":" in ip else ip
    default = 443 if target.scheme == "https" else 80
    port = "" if target.port == default else f":{target.port}"
    return f"{target.scheme}://{host}{port}{target.path}"


class PageFetcher:
    def __init__(
        self,
        limits: FetchLimits = FetchLimits(),
        resolver: Resolver = system_resolver,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.limits = limits
        self._resolver = resolver
        self._transport = transport

    async def fetch(self, url: str) -> Page:
        current = url
        for _ in range(self.limits.max_redirects + 1):
            try:
                target = parse_target(current)
                ip = await resolve_public(target, self._resolver)
            except BlockedUrl as err:
                raise FetchError(f"blocked: {err}") from err
            async with httpx.AsyncClient(
                timeout=self.limits.timeout, follow_redirects=False, trust_env=False, transport=self._transport
            ) as client:
                request = client.build_request(
                    "GET",
                    _request_url(target, ip),
                    headers={"Host": target.host, "User-Agent": USER_AGENT, "Accept": "text/html, text/plain;q=0.9"},
                    extensions={"sni_hostname": target.host} if target.scheme == "https" else {},
                )
                try:
                    response = await client.send(request, stream=True)
                except httpx.TimeoutException as err:
                    raise FetchError("the site did not answer in time") from err
                except httpx.HTTPError as err:
                    raise FetchError(f"connection failed ({type(err).__name__})") from err
                try:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError(f"redirect without a location (HTTP {response.status_code})")
                        current = urljoin(target.url, location)
                        continue
                    if response.status_code >= 400:
                        raise FetchError(f"HTTP {response.status_code}", status=response.status_code)
                    return await self._read(target.url, response)
                finally:
                    await response.aclose()
        raise FetchError(f"more than {self.limits.max_redirects} redirects")

    async def _read(self, url: str, response: httpx.Response) -> Page:
        kind = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if kind not in TEXT_TYPES:
            raise FetchError(f"not a text page ({kind or 'unknown type'})")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body += chunk
            if len(body) > self.limits.max_bytes:
                break
        raw = bytes(body[: self.limits.max_bytes]).decode(response.encoding or "utf-8", errors="replace")
        if kind == "text/plain":
            text, title = raw.strip(), ""
        else:
            text, title = html_to_text(raw)
        if not text:
            raise FetchError("no readable text on the page")
        text, truncated = cut(text, self.limits.page_chars)
        return Page(url=url, title=title or url, text=text, truncated=truncated)
