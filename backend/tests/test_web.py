from collections.abc import AsyncIterator, Callable

import httpx
import pytest

from app.web import FetchError, FetchLimits, PageFetcher, SearchUnavailable, SearxClient
from app.web.fetch import cut, html_to_text
from app.web.guard import BlockedUrl, is_public_ip, parse_target, resolve_public

PUBLIC = "93.184.215.14"
ARTICLE = """<html><head><title>FastAPI and PostgreSQL</title></head><body>
<nav>Home | About | Login</nav>
<article><h1>Connecting FastAPI to PostgreSQL</h1>
<p>FastAPI works well with PostgreSQL through SQLAlchemy and asyncpg, which gives an async driver for the database.</p>
<p>Use a connection pool and keep sessions short so that requests do not hold connections longer than needed.</p>
<p>Alembic manages schema migrations; run them before the application starts serving traffic.</p>
</article><footer>Cookie settings · Privacy</footer></body></html>"""


def resolver(table: dict[str, list[str]]) -> Callable[[str, int], object]:
    async def resolve(host: str, port: int) -> list[str]:
        return table.get(host, [])

    return resolve


def site(routes: dict[str, httpx.Response]) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        key = f"{request.headers['host']}{request.url.raw_path.decode()}"
        return routes.get(key, httpx.Response(404))

    return httpx.MockTransport(handler), seen


def html(body: str = ARTICLE, **headers: str) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8", **headers}, text=body)


# ---------- guard ----------


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "224.0.0.1"],
)
def test_local_and_private_ips_are_not_public(address: str) -> None:
    assert not is_public_ip(address)


@pytest.mark.parametrize("address", [PUBLIC, "8.8.8.8", "2606:4700:4700::1111"])
def test_public_ips(address: str) -> None:
    assert is_public_ip(address)


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("file:///etc/passwd", "only http and https"),
        ("ftp://example.com/a", "only http and https"),
        ("http://user:pass@example.com/", "login"),
        ("http://localhost:8000/api", "local address"),
        ("http://printer.local/", "local address"),
        ("http://example.com:22/", "port 22"),
        ("https:///nohost", "no host"),
    ],
)
def test_parse_target_rejects(url: str, reason: str) -> None:
    with pytest.raises(BlockedUrl, match=reason):
        parse_target(url)


def test_parse_target_keeps_path_and_query() -> None:
    t = parse_target("https://Example.com/a/b?q=1")
    assert (t.scheme, t.host, t.port, t.path) == ("https", "example.com", 443, "/a/b?q=1")


async def test_name_resolving_to_a_local_ip_is_blocked() -> None:
    with pytest.raises(BlockedUrl, match="local or private"):
        await resolve_public(parse_target("http://evil.example/"), resolver({"evil.example": [PUBLIC, "127.0.0.1"]}))
    with pytest.raises(BlockedUrl, match="local or private"):
        await resolve_public(parse_target("http://10.0.0.1/"))


# ---------- fetch ----------


async def test_fetch_reads_main_text_and_pins_the_checked_ip() -> None:
    transport, seen = site({"docs.example/guide": html()})
    fetcher = PageFetcher(resolver=resolver({"docs.example": [PUBLIC]}), transport=transport)
    page = await fetcher.fetch("https://docs.example/guide")

    assert page.title == "FastAPI and PostgreSQL"
    assert "SQLAlchemy and asyncpg" in page.text and "Alembic" in page.text
    assert "Cookie settings" not in page.text and "Login" not in page.text
    [request] = seen
    assert request.url.host == PUBLIC
    assert request.headers["host"] == "docs.example"
    assert request.extensions["sni_hostname"] == "docs.example"
    assert "cookie" not in request.headers and "authorization" not in request.headers
    assert request.method == "GET"


async def test_redirect_to_a_local_address_is_blocked() -> None:
    transport, seen = site({"short.example/x": httpx.Response(302, headers={"location": "http://192.168.0.1/admin"})})
    fetcher = PageFetcher(resolver=resolver({"short.example": [PUBLIC]}), transport=transport)
    with pytest.raises(FetchError, match="local or private"):
        await fetcher.fetch("http://short.example/x")
    assert len(seen) == 1


async def test_redirect_to_a_name_that_resolves_locally_is_blocked() -> None:
    transport, _ = site({"short.example/x": httpx.Response(301, headers={"location": "https://intranet.example/"})})
    names = {"short.example": [PUBLIC], "intranet.example": ["10.0.0.7"]}
    with pytest.raises(FetchError, match="local or private"):
        await PageFetcher(resolver=resolver(names), transport=transport).fetch("http://short.example/x")


async def test_redirects_are_followed_and_rechecked() -> None:
    transport, seen = site({"a.example/": httpx.Response(302, headers={"location": "/final"}), "a.example/final": html()})
    page = await PageFetcher(resolver=resolver({"a.example": [PUBLIC]}), transport=transport).fetch("http://a.example/")
    assert page.url == "http://a.example/final"
    assert len(seen) == 2


async def test_too_many_redirects() -> None:
    transport, _ = site({"loop.example/": httpx.Response(302, headers={"location": "/"})})
    fetcher = PageFetcher(FetchLimits(max_redirects=2), resolver({"loop.example": [PUBLIC]}), transport)
    with pytest.raises(FetchError, match="more than 2 redirects"):
        await fetcher.fetch("http://loop.example/")


async def test_only_text_content_types() -> None:
    pdf = httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF-1.7")
    transport, _ = site({"files.example/doc": pdf})
    with pytest.raises(FetchError, match="not a text page"):
        await PageFetcher(resolver=resolver({"files.example": [PUBLIC]}), transport=transport).fetch("http://files.example/doc")


async def test_reading_stops_at_the_byte_limit() -> None:
    sent = 0

    async def endless() -> AsyncIterator[bytes]:
        nonlocal sent
        yield b"<html><body><article>"
        for i in range(10_000):
            sent += 1
            yield f"<p>Paragraph {i} about PostgreSQL connection pools.</p>".encode() * 20

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, content=endless())

    fetcher = PageFetcher(FetchLimits(max_bytes=50_000), resolver({"big.example": [PUBLIC]}), httpx.MockTransport(handler))
    page = await fetcher.fetch("http://big.example/")
    assert sent < 60, "the body was read far past the limit"
    assert "PostgreSQL" in page.text


async def test_streamed_body_is_cut_at_the_byte_limit_and_text_truncated() -> None:
    body = "<html><body><article>" + "".join(f"<p>Paragraph {i} about databases and APIs.</p>" for i in range(3000)) + "</article></body></html>"
    transport, _ = site({"long.example/": html(body)})
    fetcher = PageFetcher(FetchLimits(max_bytes=40_000, page_chars=1000), resolver({"long.example": [PUBLIC]}), transport)
    page = await fetcher.fetch("http://long.example/")
    assert page.truncated
    assert len(page.text) < 1100 and "[... page truncated" in page.text


async def test_http_errors_and_timeouts_are_reported() -> None:
    transport, _ = site({"gone.example/": httpx.Response(404)})
    with pytest.raises(FetchError, match="HTTP 404"):
        await PageFetcher(resolver=resolver({"gone.example": [PUBLIC]}), transport=transport).fetch("http://gone.example/")

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    fetcher = PageFetcher(resolver=resolver({"slow.example": [PUBLIC]}), transport=httpx.MockTransport(slow))
    with pytest.raises(FetchError, match="did not answer in time"):
        await fetcher.fetch("http://slow.example/")


def test_cut_and_html_to_text() -> None:
    assert cut("abc", 5) == ("abc", False)
    text, truncated = cut("x" * 20, 10)
    assert truncated and text.startswith("x" * 10) and "10 more chars" in text
    body, title = html_to_text(ARTICLE)
    assert title == "FastAPI and PostgreSQL" and "Connecting FastAPI" in body


# ---------- search ----------


async def test_search_parses_and_deduplicates_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search" and request.url.params["format"] == "json"
        results = [
            {"title": "FastAPI docs", "url": "https://fastapi.tiangolo.com/", "content": "FastAPI   framework"},
            {"title": "dup", "url": "https://fastapi.tiangolo.com/", "content": ""},
            {"title": "bad", "url": "javascript:alert(1)"},
            {"title": "Pg", "url": "https://www.postgresql.org/", "content": "x" * 500},
        ]
        return httpx.Response(200, json={"results": results})

    results = await SearxClient("http://searx.test", transport=httpx.MockTransport(handler)).search("fastapi")
    assert [r.url for r in results] == ["https://fastapi.tiangolo.com/", "https://www.postgresql.org/"]
    assert results[0].snippet == "FastAPI framework"
    assert len(results[1].snippet) == 300


async def test_search_unavailable() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client = SearxClient("http://searx.test", transport=httpx.MockTransport(refuse))
    with pytest.raises(SearchUnavailable):
        await client.search("anything")
    assert not await client.healthy()
