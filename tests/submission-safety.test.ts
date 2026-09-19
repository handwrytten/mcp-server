import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateBasket, sendSingleOrder, sendConfirmedBasket } from "../src/basket-safety.js";
import { validateImageUrl, previewMetadata } from "../src/preview-security.js";
import { structuredResult } from "../src/tool-results.js";
import { createHandwryttenClient } from "../src/handwrytten-client.js";

test("image allowlist checks parsed origins, credentials and ports", () => {
  for (const url of ["https://cdn.handwrytten.com.evil.test/a", "https://cdn.handwrytten.com@evil.test/a", "https://user@cdn.handwrytten.com/a", "http://cdn.handwrytten.com/a", "https://cdn.handwrytten.com:444/a"]) assert.throws(() => validateImageUrl(url));
  assert.equal(validateImageUrl("https://cdn.handwrytten.com/a").hostname, "cdn.handwrytten.com");
  assert.deepEqual(previewMetadata().resourceMeta.ui.csp.connectDomains, []);
});

test("basket estimates avoid fabricated totals and incomplete subtotals", () => {
  const estimate = estimateBasket([{ sub_total: "3.38" }, { price_structure: { sub_total: "4.20" } }], 2);
  assert.equal(estimate.estimated_subtotal, 7.58);
  assert.equal("tax" in estimate, false);
  assert.equal("total" in estimate, false);
  assert.equal(estimateBasket([{ sub_total: 3 }], 2).estimated_subtotal, null);
  assert.equal(estimateBasket([{}], 1).estimated_subtotal, null);
});

function mockBasket(counts: number[], testMode = false) {
  const calls: any[] = [];
  return { calls, client: {
    _http: { get: async (path: string) => path.endsWith("count") ? { count: counts.shift() } : { test_mode: testMode } },
    basket: { addOrder: async (p: any) => { calls.push(["add", p]); return {}; },
      send: async (p: any) => { calls.push(["send", p]); return { status: "ok" }; } },
  } as any };
}
test("single-order sends require confirmation and an empty basket", async () => {
  const { client, calls } = mockBasket([2]);
  await assert.rejects(sendSingleOrder(client, { confirmSend: false }), /Confirm/);
  await assert.rejects(sendSingleOrder(client, { confirmSend: true, recipient: 1 }), /empty basket/);
  await assert.rejects(sendSingleOrder(client, { confirmSend: true, recipient: [] }), /valid saved recipient/);
  assert.deepEqual(calls, []);
});
test("single-order sends preserve message and sender, detect basket changes", async () => {
  const first = mockBasket([0, 1]);
  await sendSingleOrder(first.client, { confirmSend: true, recipient: 8, sender: 9, message: "Synthetic", cardId: "1", font: "2" });
  assert.deepEqual(first.calls[0], ["add", { addressIds: [8], returnAddressId: 9, message: "Synthetic", cardId: "1", font: "2" }]);
  assert.equal(first.calls[1][0], "send");
  const second = mockBasket([0, 2]);
  await assert.rejects(sendSingleOrder(second.client, { confirmSend: true, recipient: 8 }), /remains unsent/);
  assert.equal(second.calls.length, 1);
});
test("basket test submissions refuse live accounts and require confirmation", async () => {
  const live = mockBasket([]);
  await assert.rejects(sendConfirmedBasket(live.client, { confirmSend: false }), /confirm ALL/);
  await assert.rejects(sendConfirmedBasket(live.client, { confirmSend: true, testMode: true }), /test-mode account/);
  assert.deepEqual(live.calls, []);
  const safe = mockBasket([], true);
  await sendConfirmedBasket(safe.client, { confirmSend: true, testMode: true });
  assert.deepEqual(safe.calls, [["send", { testMode: true }]]);
});
test("structured results redact credentials in both representations without changing legacy shape", () => {
  const value = { id: "1", raw: { uid: "secret", access_token: "secret", email: "synthetic@example.test", nested: { password: "secret" } } };
  const result = structuredResult("get_user", { content: [{ type: "text", text: JSON.stringify(value) }] });
  const expected = { id: "1", raw: { email: "synthetic@example.test", nested: {} } };
  assert.deepEqual(result.structuredContent, { result: expected });
  assert.deepEqual(JSON.parse((result.content[0] as any).text), expected);
  assert.throws(() => structuredResult("get_user", { content: [{ type: "text", text: "{}" }] }));
});
test("SDK compatibility reads country envelopes and embedded state abbreviations", async () => {
  const client = createHandwryttenClient({ accessToken: "synthetic", fetch: async input => {
    assert.ok(String(input).includes("countries/list"));
    return Response.json({ countries: [{ id: 1, ups_code: "US", name: "United States", states: [{ short_name: "AZ", name: "Arizona" }] }] });
  } });
  assert.equal((await client.addressBook.countries())[0].id, 1);
  assert.equal((await client.addressBook.states("US"))[0].code, "AZ");
});

test("profile UID fallback cannot expose a credential as the normalized id", () => {
  const result = structuredResult("get_user", { content: [{ type: "text", text: JSON.stringify({ id: "legacy-secret", raw: { uid: "legacy-secret" } }) }] });
  assert.deepEqual(result.structuredContent, { result: { id: "", raw: {} } });
});

test("real SDK basket payload preserves message, wishes and saved addresses", async () => {
  const requests: any[] = [];
  const client = createHandwryttenClient({ accessToken: "synthetic", fetch: async (input, init) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return Response.json({ status: "ok" });
  } });
  await client.basket.addOrder({ cardId: "1", font: "2", message: "Synthetic message", wishes: "Thanks", addressIds: [8], returnAddressId: 9 });
  assert.equal(requests[0].path, "/v2/orders/placeBasket");
  assert.equal(requests[0].body.message, "Synthetic message");
  assert.equal(requests[0].body.wishes, "Thanks");
  assert.deepEqual(requests[0].body.address_ids, [8]);
  assert.equal(requests[0].body.return_address_id, 9);
});
