from httpx import AsyncClient


async def test_llms_txt_documents_every_endpoint_from_the_live_schema(client: AsyncClient) -> None:
    res = await client.get("/llms.txt")

    assert res.status_code == 200 and res.headers["content-type"].startswith("text/plain")
    text = res.text
    assert text.startswith("# AI Office API")
    paths = (await client.get("/openapi.json")).json()["paths"]
    for path, ops in paths.items():
        for method in ops:
            assert f"### {method.upper()} {path}" in text
    assert "### POST /api/v1/agents/{agent_id}/release" in text
    assert "### ReleaseAllResult" in text and "- `kept`:" in text
