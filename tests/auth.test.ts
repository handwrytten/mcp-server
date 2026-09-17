import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { setupAuthRoutes, extractApiKey, extractBearerToken } from "../src/auth.js";
import { toolError } from "../src/tool-auth.js";

let backend: Server;
let proxy: Server;
let proxyUrl: string;
let lastRequest: { authorization?: string; body: Record<string, unknown>; path: string };
const credentials = new Map([["claude", "claude-secret"], ["chatgpt", "chatgpt-secret"], ["hubspot", "hubspot-secret"]]);

async function listen(app: ReturnType<typeof express>) {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

before(async () => {
  const api = express();
  api.use(express.json());
  api.post(["/api/v1/oauth/token", "/api/v1/oauth/revoke"], (req, res) => {
    lastRequest = { authorization: req.headers.authorization, body: req.body, path: req.path };
    let { client_id: id, client_secret: secret } = req.body;
    if (req.headers.authorization?.startsWith("Basic ")) {
      [id, secret] = Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":");
    }
    if (!credentials.has(id) || credentials.get(id) !== secret) {
      res.set("WWW-Authenticate", 'Basic realm="oauth"').status(401).json({ error: "invalid_client" });
      return;
    }
    res.json(req.path.endsWith("revoke") ? {} : { access_token: `${id}-access`, refresh_token: `${id}-refresh`, expires_in: 3600 });
  });
  const upstream = await listen(api);
  backend = upstream.server;
  const app = express();
  app.use(express.json(), express.urlencoded({ extended: false }));
  setupAuthRoutes(app, { mcpServerUrl: "https://mcp.handwrytten.com", handwryttenApiUrl: upstream.url });
  setupAuthRoutes(app, { mcpServerUrl: "https://mcp.handwrytten.com", handwryttenApiUrl: upstream.url,
    routePrefix: "/chatgpt", oauthClientId: "chatgpt", oauthClientSecret: "chatgpt-secret" });
  const endpoint = await listen(app);
  proxy = endpoint.server;
  proxyUrl = endpoint.url;
});

after(async () => {
  await Promise.all([proxy, backend].filter(Boolean).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

for (const [id, secret] of credentials) {
  for (const method of ["basic", "post"]) {
    test(`${id}: ${method} credentials survive code exchange, refresh and revocation`, async () => {
      for (const operation of ["code", "refresh", "revoke"]) {
        const body = new URLSearchParams(operation === "code"
          ? { grant_type: "authorization_code", code: "test-code", code_verifier: "test-verifier", redirect_uri: "https://callback.example/", resource: "https://mcp.handwrytten.com/mcp" }
          : operation === "refresh" ? { grant_type: "refresh_token", refresh_token: "test-refresh" }
          : { token: "test-token" });
        const headers: Record<string, string> = {};
        if (method === "basic") headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
        else { body.set("client_id", id); body.set("client_secret", secret); }
        const response = await fetch(`${proxyUrl}/${operation === "revoke" ? "revoke" : "token"}`, { method: "POST", headers, body });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(lastRequest.body, Object.fromEntries(body));
        assert.equal(lastRequest.authorization, headers.Authorization);
        const result = await response.json();
        if (operation !== "revoke") assert.equal(result.access_token, `${id}-access`);
      }
    });
  }
}

test("missing and incorrect credentials are not replaced with server credentials", async () => {
  for (const path of ["token", "revoke"]) {
    for (const body of [{}, { client_id: "chatgpt", client_secret: "incorrect" }]) {
      const response = await fetch(`${proxyUrl}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), 'Basic realm="oauth"');
      assert.deepEqual(await response.json(), { error: "invalid_client" });
      assert.equal(lastRequest.authorization, undefined);
    }
  }
});

test("without configured registration credentials, discovery omits registration and register fails", async () => {
  const metadata = await (await fetch(`${proxyUrl}/.well-known/oauth-authorization-server`)).json();
  assert.equal(metadata.registration_endpoint, undefined);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.scopes_supported, ["read:profile", "send:cards", "read:orders", "read:contacts", "write:contacts", "read:balance"]);
  const response = await fetch(`${proxyUrl}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/oauth/callback"] }) });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.error, "temporarily_unavailable");
  assert.equal(result.client_id, undefined);
  assert.equal(result.client_secret, undefined);
});

test("authorization preserves client, callback, state, PKCE and resource on GET and POST", async () => {
  const params = new URLSearchParams({ client_id: "chatgpt", redirect_uri: "https://callback.example/", response_type: "code", scope: "read:profile", state: "test-state", code_challenge: "test-challenge", code_challenge_method: "S256", resource: "https://mcp.handwrytten.com/mcp" });
  for (const method of ["GET", "POST"]) {
    const response = await fetch(`${proxyUrl}/authorize${method === "GET" ? `?${params}` : ""}`, { method, ...(method === "POST" ? { body: params } : {}), redirect: "manual" });
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, "/api/v1/oauth/authorize");
    assert.deepEqual(Object.fromEntries(target.searchParams), Object.fromEntries(params));
  }
});

test("API-key extraction remains distinct from OAuth", () => {
  assert.equal(extractApiKey("api-key", undefined), "api-key");
  assert.equal(extractApiKey(undefined, "api-key"), "api-key");
  assert.equal(extractApiKey(undefined, "Bearer access-token"), null);
  assert.equal(extractBearerToken("Bearer access-token"), "access-token");
});

test("only OAuth credential failures trigger reconnect, not API-key or general 403 failures", () => {
  const expired = { message: "Expired", statusCode: 401 };
  assert.ok(toolError(expired, "https://mcp.handwrytten.com")._meta?.["mcp/www_authenticate"]);
  assert.equal(toolError(expired)._meta, undefined);
  assert.equal(toolError({ message: "Billing denied", statusCode: 403 }, "https://mcp.handwrytten.com")._meta, undefined);
  assert.equal(toolError({ message: "Network failed", statusCode: 502 }, "https://mcp.handwrytten.com")._meta, undefined);
  assert.ok(toolError({ statusCode: 403, responseBody: { error: "insufficient_scope" } }, "https://mcp.handwrytten.com")._meta);
});


test("ChatGPT discovery, registration, authorization and refresh stay on its configuration", async () => {
  const metadata = await (await fetch(`${proxyUrl}/.well-known/oauth-authorization-server/chatgpt`)).json();
  assert.equal(metadata.issuer, "https://mcp.handwrytten.com/chatgpt");
  assert.equal(metadata.registration_endpoint, `${metadata.issuer}/register`);
  assert.equal(metadata.token_endpoint, `${metadata.issuer}/token`);
  const resource = await (await fetch(`${proxyUrl}/.well-known/oauth-protected-resource/chatgpt/mcp`)).json();
  assert.equal(resource.resource, `${metadata.issuer}/mcp`);
  assert.deepEqual(resource.authorization_servers, [metadata.issuer]);
  const registration = await fetch(`${proxyUrl}/chatgpt/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://chatgpt.com/callback"] }) });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get("cache-control"), "no-store");
  const client = await registration.json();
  assert.equal(client.client_id, "chatgpt"); // URL selects configuration, never caller-supplied name.
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0],
    state: "state", code_challenge: "challenge", code_challenge_method: "S256", resource: resource.resource });
  const authorize = await fetch(`${proxyUrl}/chatgpt/authorize?${params}`, { redirect: "manual" });
  assert.deepEqual(Object.fromEntries(new URL(authorize.headers.get("location")!).searchParams), Object.fromEntries(params));
  for (const path of ["token", "revoke"]) {
    const response = await fetch(`${proxyUrl}/chatgpt/${path}`, { method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "test-refresh" }) });
    assert.equal(response.status, 200);
    if (path === "token") assert.equal((await response.json()).access_token, "chatgpt-access");
    else await response.text();
  }
  const challenge = toolError({ statusCode: 401 }, metadata.issuer)._meta!["mcp/www_authenticate"];
  assert.match(JSON.stringify(challenge), /chatgpt\/\.well-known\/oauth-protected-resource/);
});
