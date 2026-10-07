"""Web search through the local SearXNG instance (JSON API)."""

from dataclasses import dataclass

import httpx


class SearchUnavailable(Exception):
    """SearXNG did not answer or answered with an error."""


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


class SearxClient:
    def __init__(self, base_url: str, timeout: float = 15.0, max_results: int = 8, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_results = max_results
        self._transport = transport

    async def search(self, query: str) -> list[SearchResult]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, trust_env=False, transport=self._transport) as client:
                response = await client.get(f"{self.base_url}/search", params={"q": query, "format": "json"})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as err:
            raise SearchUnavailable(f"search service is unavailable ({type(err).__name__})") from err
        seen: set[str] = set()
        results: list[SearchResult] = []
        for item in payload.get("results", []):
            url = str(item.get("url") or "")
            if not url.startswith(("http://", "https://")) or url in seen:
                continue
            seen.add(url)
            results.append(
                SearchResult(
                    title=str(item.get("title") or url).strip(),
                    url=url,
                    snippet=" ".join(str(item.get("content") or "").split())[:300],
                )
            )
            if len(results) >= self.max_results:
                break
        return results

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0, trust_env=False, transport=self._transport) as client:
                return (await client.get(f"{self.base_url}/healthz")).status_code == 200
        except httpx.HTTPError:
            return False
