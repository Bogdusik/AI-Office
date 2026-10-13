"""A page cannot stall or exhaust the backend: title search is linear, decompression is bounded (audit M3, L4)."""

import gzip
import time
import tracemalloc

import httpx
import pytest

from app.web import FetchError, FetchLimits, PageFetcher
from app.web.fetch import html_to_text, page_title

PUBLIC = "93.184.215.14"
ARTICLE = "<html><head><title>  Async\n SQLAlchemy   guide </title></head><body><article><p>" + "Sessions per request. " * 40 + "</p></article></body></html>"


async def resolve(host: str, port: int) -> list[str]:
    return [PUBLIC]


class Network(httpx.AsyncByteStream):
    """A body that arrives in 64 KiB pieces, like a real connection (httpx reads plain test bodies up front)."""

    def __init__(self, body: bytes) -> None:
        self.body = body

    async def __aiter__(self):  # noqa: ANN204
        for i in range(0, len(self.body), 65_536):
            yield self.body[i : i + 65_536]


def fetcher(body: bytes, encoding: str | None = None, **limits: int) -> PageFetcher:
    headers = {"content-type": "text/html; charset=utf-8"}
    if encoding is not None:
        headers["content-encoding"] = encoding

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers=headers, stream=Network(body))

    return PageFetcher(FetchLimits(**limits), resolve, httpx.MockTransport(handler))


def test_title_of_a_normal_page() -> None:
    assert page_title(ARTICLE) == "Async SQLAlchemy guide"
    assert page_title("<html><TITLE lang=en>Upper</TITLE>") == "Upper"
    assert page_title("<html><body>no title</body>") == ""
    assert html_to_text(ARTICLE)[1] == "Async SQLAlchemy guide"


def test_unclosed_title_tags_take_linear_time() -> None:
    hostile = "<title>" * 20_000  # the old regex needed ~7 s here and ~24 min at the 2 MB page limit
    started = time.perf_counter()
    assert page_title(hostile) == ""
    assert page_title(hostile * 14) == ""
    assert time.perf_counter() - started < 0.5


async def test_a_gzip_page_is_read() -> None:
    page = await fetcher(gzip.compress(ARTICLE.encode()), "gzip").fetch("https://docs.example/guide")
    assert page.title == "Async SQLAlchemy guide" and "Sessions per request" in page.text


async def test_a_gzip_bomb_is_cut_at_the_size_limit_without_inflating_it() -> None:
    bomb = gzip.compress(b"<html><body><article><p>" + b"a" * 40_000_000, compresslevel=9)
    tracemalloc.start()
    try:
        await fetcher(bomb, "gzip", max_bytes=200_000).fetch("https://docs.example/bomb")
    except FetchError:
        pass
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert peak < 8_000_000, f"peak {peak / 1e6:.1f} MB"


@pytest.mark.parametrize("encoding", ["gzip, gzip", "gzip,deflate", "br", "compress", "x-gzip, gzip"])
async def test_stacked_or_unknown_encodings_are_refused(encoding: str) -> None:
    layered = gzip.compress(gzip.compress(b"<p>" + b"a" * 20_000_000))
    with pytest.raises(FetchError, match="unsupported compression"):
        await fetcher(layered, encoding).fetch("https://docs.example/layers")


async def test_a_broken_gzip_body_is_a_fetch_error() -> None:
    with pytest.raises(FetchError, match="could not be decompressed"):
        await fetcher(b"not gzip at all" * 10, "gzip").fetch("https://docs.example/broken")


async def test_an_uncompressed_page_is_cut_at_the_size_limit() -> None:
    long = ("<html><head><title>Long</title></head><body><article><p>" + "word " * 100_000 + "</p></article></body></html>").encode()
    page = await fetcher(long, max_bytes=50_000, page_chars=100_000).fetch("https://docs.example/long")
    assert page.title == "Long" and len(page.text) < 50_000
