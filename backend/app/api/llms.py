"""`GET /llms.txt`: the whole API as Markdown for language models, built from the live OpenAPI schema."""

from typing import Any

from fastapi import APIRouter, Request, status
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["docs"])

INTRO = """# AI Office API

Local 3D office where AI employees work on the director's tasks. JSON over HTTP, no authentication (local only).
Live updates: `GET /api/v1/events` (Server-Sent Events: `agent`, `task`, `artifact`, `run`, `progress`).
Agents: arrive when given work, stay in the office when done (status `idle`), go home only when released
(`POST /api/v1/agents/{agent_id}/release`, `POST /api/v1/agents/release-all`). Errors: `{"detail": "..."}` with
404 (not found), 409 (not allowed in the current state), 422 (invalid input).
"""


def _ref(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if schema.get("type") == "array":
        return f"list[{_ref(schema.get('items', {}))}]"
    if "anyOf" in schema:
        return " | ".join(_ref(s) for s in schema["anyOf"])
    if "enum" in schema:
        return " | ".join(f"`{v}`" for v in schema["enum"])
    return str(schema.get("type", "object"))


def _operation(method: str, path: str, op: dict[str, Any]) -> list[str]:
    lines = [f"### {method.upper()} {path}", ""]
    text = (op.get("description") or op.get("summary") or "").strip()
    if text:
        lines += [text, ""]
    for p in op.get("parameters", []):
        need = "required" if p.get("required") else "optional"
        lines.append(f"- {p['in']} `{p['name']}`: {_ref(p.get('schema', {}))} ({need})")
    body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
    if body:
        lines.append(f"- body: {_ref(body)}")
    for code, resp in op.get("responses", {}).items():
        schema = resp.get("content", {}).get("application/json", {}).get("schema")
        lines.append(f"- {code}: {_ref(schema) if schema else resp.get('description', '')}")
    return [*lines, ""]


def _schema(name: str, schema: dict[str, Any]) -> list[str]:
    lines = [f"### {name}", ""]
    if schema.get("description"):
        lines += [schema["description"].strip(), ""]
    if "enum" in schema:
        return [*lines, "One of: " + ", ".join(f"`{v}`" for v in schema["enum"]), ""]
    required = set(schema.get("required", []))
    for field, prop in schema.get("properties", {}).items():
        note = f" — {prop['description'].strip()}" if prop.get("description") else ""
        lines.append(f"- `{field}`: {_ref(prop)}{'' if field in required else ' (optional)'}{note}")
    return [*lines, ""]


def render(openapi: dict[str, Any]) -> str:
    lines = [INTRO, "## Endpoints", ""]
    for path, ops in openapi.get("paths", {}).items():
        for method, op in ops.items():
            lines += _operation(method, path, op)
    lines += ["## Schemas", ""]
    for name, schema in openapi.get("components", {}).get("schemas", {}).items():
        lines += _schema(name, schema)
    return "\n".join(lines).rstrip() + "\n"


@router.get("/llms.txt", response_class=PlainTextResponse, status_code=status.HTTP_200_OK, include_in_schema=False)
async def llms_txt(request: Request) -> str:
    return render(request.app.openapi())
