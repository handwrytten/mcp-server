import assert from "node:assert/strict";
import { test } from "node:test";
import opentype from "opentype.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHandwryttenClient } from "../src/handwrytten-client.js";
import { writingDimensions } from "../src/writing-dimensions.js";
import { registerAppTools } from "../src/app-tools.js";
import { parseCard } from "handwrytten";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const raw = { id: 100, closed_width: 5.5, closed_height: 4.25,
  preview_margin_top: 0, preview_margin_right: "0.300", preview_margin_bottom: "0.300", preview_margin_left: "0.300" };

test("card dimensions preserve zero margins and reject unusable sizes", () => {
  assert.deepEqual(writingDimensions(parseCard(raw)), { width: 528, height: 408, padding: [0, 28.799999999999997, 28.799999999999997, 28.799999999999997] });
  assert.equal(writingDimensions(null).width, 672);
  for (const value of [0, -1, "bad", null, ""]) {
    assert.throws(() => writingDimensions(parseCard({ ...raw, closed_width: value })), /invalid width/);
  }
  assert.throws(() => writingDimensions(parseCard({ ...raw, preview_margin_left: 6 })), /no writing area/);
});

test("both preview tools render the selected card through the real SDK HTTP layer", async (t) => {
  const font = new opentype.Font({ familyName: "Test", styleName: "Regular", unitsPerEm: 1000,
    ascender: 800, descender: -200, glyphs: [new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() })] });
  t.mock.method(globalThis, "fetch", async () => new Response(font.toArrayBuffer()));
  const requests: string[] = [];
  const api = createHandwryttenClient({ accessToken: "test-token", maxRetries: 1, fetch: async (input, options) => {
    const url = new URL(String(input));
    assert.equal((options!.headers as Record<string, string>).Authorization, "Bearer test-token");
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith("/fonts/list")) return Response.json({ fonts: [{ id: "test", label: "Test", path: "https://fonts.example/test.ttf" }] });
    assert.equal(url.pathname, "/v2/cards/view");
    assert.equal(url.searchParams.get("card_id"), "100");
    return Response.json({ status: "ok", card: raw });
  } });
  const server = new McpServer({ name: "test", version: "1" });
  registerAppTools(server, api);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    for (const name of ["Preview-Writing", "preview_writing"]) {
      const result = await client.callTool({ name, arguments: { cardId: "100", fontId: "test", message: "Hello" } });
      assert.ok(!result.isError, JSON.stringify(result));
      const data = JSON.parse((result.content as any[])[0].text);
      assert.equal(data.renderError, "");
      assert.equal(data.cardId, "100");
      const png = Buffer.from(result._meta!["handwrytten/previewPng"] as string, "base64");
      assert.equal(png.readUInt32BE(16), 800);
      assert.ok(Math.abs(png.readUInt32BE(20) - 800 * 4.25 / 5.5) <= 1);
    }
    assert.equal(requests.filter(p => p.startsWith("/v2/cards/view")).length, 2);
  } finally { await client.close(); await server.close(); }
});

test("font changes keep the initial cardId in the UI request", async () => {
  let app: any;
  let change: () => Promise<void>;
  let args: any;
  const element = { innerHTML: "", value: "second", appendChild() {}, addEventListener(_name: string, fn: any) { change = fn; } };
  class FakeApp {
    constructor() { app = this; }
    connect() {}
    async callServerTool(request: any) { args = request.arguments; return { content: [{ type: "text", text: '{"selectedFont":{"id":"second","label":"Second"}}' }] }; }
  }
  const source = readFileSync(new URL("../src/ui/writing-preview.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText,
    { App: FakeApp, document: { getElementById: () => element, createElement: () => ({}), documentElement: { style: { setProperty() {} } } } });
  await app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ cardId: "100", message: "Hello", selectedFont: { id: "first", label: "First" } }) }] });
  await change!(); await change!();
  assert.equal(args.cardId, "100");
  assert.equal(args.message, "Hello");
});
