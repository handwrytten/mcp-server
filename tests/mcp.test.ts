import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Handwrytten } from "handwrytten";
import { registerTools } from "../src/tools.js";
import { registerAppTools } from "../src/app-tools.js";

test("tool annotations and preview CSP survive serialization, and backend 401 triggers OAuth", async () => {
  const server = new McpServer({ name: "handwrytten-test", version: "1" });
  // Every Handwrytten request is intercepted; no production API calls.
  const api = new Handwrytten({ accessToken: "fake", maxRetries: 1,
    fetch: async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }),
  });
  registerTools(server, api, "https://mcp.handwrytten.com");
  registerAppTools(server, api, "https://mcp.handwrytten.com", "https://mcp.handwrytten.com");
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 40);
    const submission = JSON.parse(readFileSync(new URL("../chatgpt-app-submission.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(submission.tools).sort(), tools.map(t => t.name).sort());
    const external = new Set(["send_order", "basket_send", "create_qr_code", "delete_qr_code", "upload_custom_image"]);
    const destructive = new Set(["delete_qr_code", "update_recipient", "delete_recipient", "add_sender", "delete_sender", "send_order", "basket_send", "basket_remove", "basket_clear", "delete_custom_image", "delete_custom_card", "basket_remove_item", "basket_clear_all"]);
    for (const tool of tools) {
      assert.equal(tool.outputSchema?.type, "object", tool.name);
      assert.ok(tool.outputSchema?.properties?.result, tool.name);
      for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint"] as const) {
        assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name}.${hint}`);
        assert.equal(submission.tools[tool.name].annotations[hint], tool.annotations?.[hint], `${tool.name}.${hint} submission`);
      }
      assert.equal(tool.annotations?.openWorldHint, external.has(tool.name), tool.name);
      assert.equal(tool.annotations?.destructiveHint, destructive.has(tool.name), tool.name);
    }
    assert.equal(submission.test_cases.length, 5);
    assert.equal(submission.negative_test_cases.length, 3);
    assert.ok(submission.app_info.subtitle.length <= 30);
    for (const testCase of submission.test_cases) {
      for (const name of testCase.tools_triggered.split(", ")) assert.ok(submission.tools[name], name);
    }
    for (const name of ["Preview-Cards", "Preview-Writing", "View-Basket"]) {
      const tool = tools.find(tool => tool.name === name)!;
      assert.equal(tool.annotations?.readOnlyHint, true);
      const uri = (tool._meta?.ui as { resourceUri: string }).resourceUri;
      const { contents } = await client.readResource({ uri });
      const csp = (contents[0]._meta?.ui as { csp: { resourceDomains: string[]; connectDomains: string[] } }).csp;
      assert.ok(csp.resourceDomains.includes("https://cdn.handwrytten.com"));
      assert.deepEqual(csp.connectDomains, []);
      assert.equal((contents[0]._meta?.ui as any).domain, "https://mcp.handwrytten.com");
      assert.ok(csp.resourceDomains.includes("data:"), name);
      assert.ok(!csp.resourceDomains.includes("blob:"), name);
      assert.ok(!csp.resourceDomains.some(d => d.includes("*")), name);
      const legacyCsp = (tool._meta?.ui as { csp: { "img-src": string[] } }).csp;
      assert.ok(legacyCsp["img-src"].includes("data:"), name);
      assert.ok(!csp.resourceDomains.includes("https:"));
    }
    const result = await client.callTool({ name: "get_user", arguments: {} });
    assert.equal(result.isError, true);
    assert.ok(result._meta?.["mcp/www_authenticate"], JSON.stringify(result));
    const previewResult = await client.callTool({ name: "Preview-Cards", arguments: {} });
    assert.equal(previewResult.isError, true);
    assert.ok(previewResult._meta?.["mcp/www_authenticate"]);
  } finally {
    await client.close();
    await server.close();
  }
});
