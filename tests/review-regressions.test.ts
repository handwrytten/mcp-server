import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHandwryttenClient } from "../src/handwrytten-client.js";
import { registerTools } from "../src/tools.js";
import { registerAppTools } from "../src/app-tools.js";
import { escapeHtml, formatPrice } from "../src/ui/formatting.js";

async function connect(fetch: typeof globalThis.fetch) {
  const api = createHandwryttenClient({ accessToken: "synthetic", maxRetries: 1, fetch });
  const server = new McpServer({ name: "review-test", version: "1" });
  registerTools(server, api);
  registerAppTools(server, api);
  const client = new Client({ name: "review-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test("ambiguous writes are never retried, even when a caller requests retries", async () => {
  for (const failure of ["500", "429", "connection", "timeout"]) {
    for (const action of ["send", "draft"]) {
      let attempts = 0;
      const api = createHandwryttenClient({ accessToken: "synthetic", maxRetries: 3, fetch: async () => {
        attempts++;
        if (failure === "connection") throw new TypeError("Connection lost after submission");
        if (failure === "timeout") throw new DOMException("Timed out", "AbortError");
        return Response.json({ error: "Ambiguous failure" }, { status: Number(failure) });
      } });
      await assert.rejects(action === "send" ? api.basket.send() : api.basket.addOrder({ cardId: "1", addressIds: [8] }));
      assert.equal(attempts, 1, `${action}: ${failure}`);
    }
  }
});

test("unknown arguments are rejected by API and app tools before any backend call", async () => {
  let calls = 0;
  const session = await connect(async () => { calls++; return Response.json({}); });
  try {
    for (const [name, args] of [
      ["send_order", { cardId: "1", font: "1", recipient: 8, confirmSend: true, testMode: true }],
      ["basket_send", { confirmSend: true, dryRun: true }],
      ["preview_writing", { message: "Hello", unknownOption: true }],
      ["render_writing_preview", { message: "Hello", fontId: "1", unknownOption: true }],
      ["view_basket", { unknownOption: true }],
    ] as const) {
      const result = await session.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, name);
      assert.match((result.content as any[])[0].text, /unrecognized/i);
    }
    assert.equal(calls, 0);
    const { tools } = await session.client.listTools();
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  } finally { await session.close(); }
});

test("widget values cannot break out of quoted HTML attributes", () => {
  const hostile = `Card\" onerror=\"alert(1)' <img src=x> &`;
  const escaped = escapeHtml(hostile);
  assert.doesNotMatch(escaped, /[<>"']/);
  assert.match(escaped, /&quot;/);
  assert.match(escaped, /&#39;/);
  assert.match(escaped, /&lt;img/);
  assert.equal(escapeHtml("Thanks & hello"), "Thanks &amp; hello");
});

test("missing or invalid prices remain distinct from genuine zero-dollar prices", () => {
  for (const value of [undefined, null, "", "  ", NaN, Infinity, "bad", -1, false, {}, []]) {
    assert.equal(formatPrice(value), "Unavailable");
  }
  for (const value of [0, "0", "0.00"]) assert.equal(formatPrice(value), "$0.00");
  assert.equal(formatPrice("3.5"), "$3.50");
});

test("tool names remain unique after client normalization; UI helpers are app-only", async () => {
  const session = await connect(async () => { throw new Error("Unexpected API call"); });
  try {
    const { tools } = await session.client.listTools();
    const normalized = tools.map(t => t.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
    assert.equal(new Set(normalized).size, tools.length);
    const helpers = new Set(["render_writing_preview", "get_cards_detailed", "get_card_image", "get_basket_summary", "basket_remove_item", "basket_clear_all"]);
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
      assert.ok(tool.description && tool.description.length > 30, tool.name);
      assert.doesNotMatch(tool.description!, /\b(best|prefer our|prefer this|better than|pick me)\b/i);
      if (helpers.has(tool.name)) {
        assert.deepEqual((tool._meta?.ui as any)?.visibility, ["app"], tool.name);
        assert.equal(tool._meta?.["openai/visibility"], "private");
      }
    }
    for (const name of ["preview_cards", "preview_writing", "view_basket"]) {
      const tool = tools.find(t => t.name === name)!;
      assert.equal(tool._meta?.["openai/outputTemplate"], (tool._meta?.ui as any).resourceUri);
    }
  } finally { await session.close(); }
});

test("card filters handle missing categories, multiple matches and numeric-string IDs", async () => {
  const session = await connect(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("categories/list")) return Response.json({ categories: [
      { id: 1, name: "Thank You" }, { id: 2, name: "Business Thank You" }, { id: 3, name: "Birthday" },
    ] });
    assert.equal(url.pathname, "/v2/cards/list");
    return Response.json({ cards: [{ id: 10, name: "Thanks", category_id: "1" }, { id: 20, name: "Business Thanks", category_id: 2 }, { id: 30, name: "Birthday", category_id: 3 }] });
  });
  try {
    for (const [args, ids] of [[{ category: "missing" }, []], [{ category: "thank you" }, ["10", "20"]], [{ categoryId: 1 }, ["10"]]] as const) {
      const result = await session.client.callTool({ name: "list_cards", arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.deepEqual((result.structuredContent as any).result.cards.map((c: any) => c.id), ids);
    }
  } finally { await session.close(); }
});

test("card browser preserves filters and does not reshuffle pagination", async () => {
  const session = await connect(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("categories/list")) return Response.json({ categories: [] });
    assert.equal(url.searchParams.has("randomise"), false);
    assert.equal(url.searchParams.get("where[category_id]"), "3");
    return Response.json({ cards: [] });
  });
  try {
    const initial = await session.client.callTool({ name: "preview_cards", arguments: { categoryId: 3, query: "birthday" } });
    assert.ok(!initial.isError);
    assert.equal((initial.structuredContent as any).result.categoryId, 3);
    assert.equal((initial.structuredContent as any).result.query, "birthday");
    const more = await session.client.callTool({ name: "get_cards_detailed", arguments: { categoryId: 3, page: 2 } });
    assert.ok(!more.isError);
    assert.equal((more.structuredContent as any).result.perPage, 10);
  } finally { await session.close(); }
});

test("order history and details use backend routes, envelope and limit", async () => {
  const order = { id: 99, message: "Thank you", status: "test", card: { id: 10 }, fontInfo: { id: 2 }, date_created: "2026-10-01" };
  const session = await connect(async input => {
    const url = new URL(String(input));
    if (url.pathname === "/v2/orders/list") {
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(url.searchParams.get("limit"), "5");
      return Response.json({ status: "ok", orders: [order] });
    }
    assert.equal(url.pathname, "/v2/orders/details");
    assert.equal(url.searchParams.get("id"), "99");
    return Response.json({ status: "ok", order });
  });
  try {
    const history = await session.client.callTool({ name: "list_orders", arguments: { page: 2, perPage: 5 } });
    assert.ok(!history.isError, JSON.stringify(history));
    const result = await session.client.callTool({ name: "get_order", arguments: { orderId: (history.structuredContent as any).result[0].id } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal((result.structuredContent as any).result.id, "99");
    assert.equal((result.structuredContent as any).result.cardId, "10");
    assert.equal((result.structuredContent as any).result.fontId, "2");
    assert.equal((result.structuredContent as any).result.message, "Thank you");
  } finally { await session.close(); }
});

test("writing failures are errors, never successful blank previews or substituted fonts", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  for (const fonts of [[], [{ id: "1", label: "One" }], [{ id: "1", label: "One", path: "https://cdn.handwrytten.com/font.ttf" }]]) {
    const session = await connect(async () => Response.json({ fonts }));
    try {
      for (const name of ["preview_writing", "render_writing_preview"]) {
        for (const fontId of ["1", "unknown"]) {
          const result = await session.client.callTool({ name, arguments: { message: "Hello", fontId } });
          assert.equal(result.isError, true, `${name}: ${JSON.stringify(fonts)}`);
          assert.equal(result._meta?.["handwrytten/previewPng"], undefined);
          const text = (result.content as any[])[0].text;
          assert.match(text, /font|Font/);
        }
      }
    } finally { await session.close(); }
  }
});

test("custom card details unwrap the backend card envelope; missing records are errors", async () => {
  const session = await connect(async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/design/getCustomCard");
    return Response.json({ card: url.searchParams.get("id") === "12" ? { id: 12, name: "Reviewer design", info: { header_text: "Thank you" } } : null });
  });
  try {
    const result = await session.client.callTool({ name: "get_custom_card", arguments: { cardId: 12 } });
    assert.ok(!result.isError);
    assert.equal((result.structuredContent as any).result.cardId, 12);
    assert.equal((result.structuredContent as any).result.raw.info.header_text, "Thank you");
    assert.equal((await session.client.callTool({ name: "get_custom_card", arguments: { cardId: 13 } })).isError, true);
  } finally { await session.close(); }
});

test("invalid pagination and empty draft recipients fail before reaching the backend", async () => {
  const session = await connect(async () => { assert.fail("Invalid input reached API"); });
  try {
    for (const [name, args] of [["get_cards_detailed", { page: 1.5 }], ["list_orders", { page: 0 }], ["basket_add_order", { cardId: "10", addressIds: [] }]] as const) {
      const result = await session.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
    }
  } finally { await session.close(); }
});

test("reviewer workflow saves a recipient, prepares an unsent draft, reviews and test-submits it", async () => {
  let recipient: any;
  let items: any[] = [];
  let sends = 0;
  const session = await connect(async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    switch (url.pathname) {
      case "/v2/profile/addRecipient":
        recipient = { id: 8, ...body };
        return Response.json({ address: recipient });
      case "/v2/profile/recipientsList": return Response.json({ addresses: [recipient] });
      case "/v2/orders/placeBasket":
        assert.deepEqual(body.address_ids, [8]);
        assert.equal(body.return_address_id, 9);
        assert.equal(body.message, "Thank you!");
        assert.equal(body.font, "2");
        items = [{ id: 100, message: body.message, address_to: recipient, address_from: { id: 9 }, card: { id: 10, name: "Thanks" }, sub_total: "3.50" }];
        return Response.json({ status: "ok", order_id: 100 });
      case "/v2/basket/allGrouped": return Response.json({ items, test_mode: 1 });
      case "/v2/basket/count": return Response.json({ count: String(items.length) });
      case "/v2/basket/send":
        assert.equal(body.test_mode, 1);
        sends++;
        items = [];
        return Response.json({ status: "ok", test_mode: 1 });
      default: assert.fail(`Unexpected endpoint ${url.pathname}`);
    }
  });
  const call = async (name: string, args = {}) => {
    const result = await session.client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return (result.structuredContent as any).result;
  };
  try {
    const saved = await call("add_recipient", { firstName: "Jane", lastName: "Example", street1: "123 Example Street", city: "Phoenix", state: "AZ", zip: "85001" });
    assert.equal(saved.addressId, 8);
    assert.equal((await call("list_recipients"))[0].id, 8);
    await call("basket_add_order", { cardId: "10", font: "2", message: "Thank you!", addressIds: [saved.addressId], returnAddressId: 9 });
    assert.equal(sends, 0);
    const basket = await call("view_basket");
    assert.equal(basket.count, 1);
    assert.equal(basket.items[0].message, "Thank you!");
    assert.equal(basket.checkout.estimated_subtotal, 3.5);
    assert.equal(basket.checkout.is_estimate, true);
    await call("basket_send", { confirmSend: true, testMode: true });
    assert.equal(sends, 1);
    assert.equal((await call("view_basket")).count, 0);
  } finally { await session.close(); }
});
