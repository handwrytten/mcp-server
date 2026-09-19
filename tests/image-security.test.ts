import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Handwrytten } from "handwrytten";
import { registerAppTools } from "../src/app-tools.js";

test("image tool rejects untrusted origins and redirects; emits structured results for raster images", async t => {
  let calls = 0;
  let redirect = true;
  t.mock.method(globalThis, "fetch", async (_input: unknown, options: RequestInit) => {
    calls++;
    assert.equal(options.redirect, "error");
    if (redirect) throw new TypeError("fetch failed");
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  });
  const server = new McpServer({ name: "test", version: "1" });
  registerAppTools(server, new Handwrytten({ apiKey: "synthetic" }));
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const bad = await client.callTool({ name: "get_card_image", arguments: { url: "https://cdn.handwrytten.com.evil.test/a" } });
    assert.equal(bad.isError, true);
    assert.equal(calls, 0);
    const redirected = await client.callTool({ name: "get_card_image", arguments: { url: "https://cdn.handwrytten.com/a" } });
    assert.equal(redirected.isError, true);
    assert.equal(calls, 1);
    redirect = false;
    const good = await client.callTool({ name: "get_card_image", arguments: { url: "https://cdn.handwrytten.com/a" } });
    assert.ok(!good.isError, JSON.stringify(good));
    assert.deepEqual(good.structuredContent, { result: { imageAvailable: true, mimeType: "image/png" } });
  } finally { await client.close(); await server.close(); }
});
