import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeErrorInfo, parseMcpServerUrl } from "../src/runtime-config.js";
import { registerAuthenticatedTool } from "../src/tool-auth.js";

test("diagnostic logs preserve known network codes without arbitrary error data", () => {
  assert.deepEqual(safeErrorInfo({ name: "TypeError", message: "secret", cause: { code: "ECONNREFUSED", message: "secret" } }), { name: "TypeError", code: "ECONNREFUSED" });
  assert.deepEqual(safeErrorInfo({ name: "secret", code: "secret", body: "secret" }), { name: "UnknownError" });
  assert.deepEqual(safeErrorInfo(null), { name: "UnknownError" });
});

test("server URL validation rejects malformed or non-origin configuration", () => {
  assert.equal(parseMcpServerUrl("https://mcp.handwrytten.com/"), "https://mcp.handwrytten.com");
  assert.equal(parseMcpServerUrl("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["invalid", "file:///tmp/test", "https://user:secret@example.com", "https://example.com/chatgpt", "https://example.com?secret=1", "https://example.com/#fragment"]) {
    assert.throws(() => parseMcpServerUrl(value), /MCP_SERVER_URL must be/);
  }
});

test("tool registration preserves an explicit closed-world annotation", () => {
  const server = new McpServer({ name: "test", version: "1" });
  const tool = registerAuthenticatedTool(server, "get_user", "Test", {}, { openWorldHint: false }, async () => ({ content: [] }));
  assert.equal(tool.annotations?.openWorldHint, false);
});
