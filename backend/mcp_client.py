"""
Minimal adapter that speaks the Model Context Protocol (MCP) to a real
Droid-MCP server running on a physical Android phone.

Droid-MCP (github.com/stixez/droid-mcp) exposes the phone over "streamable HTTP"
at a single /mcp endpoint using JSON-RPC 2.0 with Bearer-token auth. This module
does the initialize handshake, the `notifications/initialized` notification, then
`tools/list` / `tools/call`, and parses both plain-JSON and text/event-stream
responses. It talks to the ACTUAL device — nothing here is mocked.
"""
import json
import itertools
from typing import Any, Dict, Optional

import httpx

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "OpenGroxCommandDroid", "version": "1.0.0"}


class McpError(Exception):
    """A protocol-level or tool-level error reported by the phone."""


class McpUnreachable(Exception):
    """The phone's MCP server could not be reached at all."""


def _parse(resp: httpx.Response) -> Dict[str, Any]:
    ct = resp.headers.get("content-type", "")
    if "text/event-stream" in ct:
        messages = []
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    messages.append(json.loads(data))
                except json.JSONDecodeError:
                    pass
        for m in messages:
            if "result" in m or "error" in m:
                return m
        return messages[-1] if messages else {}
    try:
        return resp.json()
    except Exception:
        return {}


def _tool_result_data(result: Dict[str, Any]) -> Dict[str, Any]:
    """Turn an MCP tool result into a plain dict, raising on tool errors."""
    if result.get("isError"):
        text = ""
        for c in result.get("content", []) or []:
            if c.get("type") == "text":
                text += c.get("text", "")
        raise McpError(text or "tool reported an error")
    structured = result.get("structuredContent")
    if structured:
        return structured
    for c in result.get("content", []) or []:
        if c.get("type") == "text":
            t = c.get("text", "")
            try:
                parsed = json.loads(t)
                return parsed if isinstance(parsed, dict) else {"value": parsed}
            except json.JSONDecodeError:
                return {"text": t}
    return {}


class McpSession:
    """One MCP conversation with the phone. Use as an async context manager."""

    def __init__(self, base_url: str, token: str):
        self.url = base_url.strip()
        self.token = (token or "").strip()
        self.session_id: Optional[str] = None
        self._ids = itertools.count(1)
        self.client: Optional[httpx.AsyncClient] = None
        self.server_info: Dict[str, Any] = {}

    def _headers(self) -> Dict[str, str]:
        h = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    async def __aenter__(self):
        self.client = httpx.AsyncClient(
            verify=False,  # Droid-MCP TLS uses a pinned self-signed cert
            follow_redirects=True,
            timeout=httpx.Timeout(connect=8.0, read=25.0, write=10.0, pool=10.0),
        )
        await self._initialize()
        return self

    async def __aexit__(self, *exc):
        if self.client:
            await self.client.aclose()

    async def _post(self, payload: Dict[str, Any]):
        assert self.client is not None
        try:
            resp = await self.client.post(self.url, json=payload, headers=self._headers())
        except httpx.HTTPError as e:
            raise McpUnreachable(str(e)) from e
        sid = resp.headers.get("mcp-session-id")
        if sid:
            self.session_id = sid
        return resp

    async def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {"jsonrpc": "2.0", "id": next(self._ids), "method": method}
        if params is not None:
            payload["params"] = params
        resp = await self._post(payload)
        if resp.status_code >= 400:
            raise McpError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        msg = _parse(resp)
        if "error" in msg and msg["error"]:
            err = msg["error"]
            raise McpError(err.get("message", "MCP error") if isinstance(err, dict) else str(err))
        return msg.get("result", {}) or {}

    async def _notify(self, method: str):
        await self._post({"jsonrpc": "2.0", "method": method})

    async def _initialize(self):
        self.server_info = await self._rpc(
            "initialize",
            {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO},
        )
        try:
            await self._notify("notifications/initialized")
        except Exception:
            pass

    async def list_tools(self) -> list:
        result = await self._rpc("tools/list", {})
        return result.get("tools", []) or []

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        result = await self._rpc("tools/call", {"name": name, "arguments": arguments or {}})
        return _tool_result_data(result)


# ---------------------------------------------------------------------------
# Small recursive extractors — Droid-MCP field names vary slightly by version.
# ---------------------------------------------------------------------------
def _walk(data: Any):
    if isinstance(data, dict):
        for k, v in data.items():
            yield k, v
            yield from _walk(v)
    elif isinstance(data, list):
        for item in data:
            yield from _walk(item)


def find_number(data: Any, key_substrings) -> Optional[float]:
    for k, v in _walk(data):
        kl = k.lower()
        if any(s in kl for s in key_substrings):
            if isinstance(v, bool):
                continue
            if isinstance(v, (int, float)):
                return float(v)
            if isinstance(v, str):
                try:
                    return float(v.strip().rstrip("%"))
                except ValueError:
                    continue
    return None


def find_string(data: Any, key_substrings) -> Optional[str]:
    for k, v in _walk(data):
        kl = k.lower()
        if any(s in kl for s in key_substrings) and isinstance(v, str) and v.strip():
            return v.strip()
    return None


def find_bool(data: Any, key_substrings) -> Optional[bool]:
    for k, v in _walk(data):
        kl = k.lower()
        if any(s in kl for s in key_substrings):
            if isinstance(v, bool):
                return v
            if isinstance(v, str):
                if v.lower() in ("true", "charging", "yes"):
                    return True
                if v.lower() in ("false", "discharging", "not_charging", "no", "full"):
                    return False
    return None
