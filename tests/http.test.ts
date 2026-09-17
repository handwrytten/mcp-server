import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";

async function freePort() {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

for (const fallback of [false, true]) {
  test(`HTTP: caller API keys work; anonymous environment-key fallback is ${fallback ? "enabled" : "disabled"}`, { timeout: 20_000 }, async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      env: { ...process.env, PORT: String(port), MCP_TRANSPORT: "http", MCP_SERVER_URL: url,
        HANDWRYTTEN_API_KEY: "fake-private-key", MCP_ALLOW_API_KEY_FALLBACK: String(fallback),
        HANDWRYTTEN_OAUTH_CLIENT_ID: "claude", HANDWRYTTEN_OAUTH_CLIENT_SECRET: "claude-secret",
        HANDWRYTTEN_CHATGPT_OAUTH_CLIENT_ID: "chatgpt", HANDWRYTTEN_CHATGPT_OAUTH_CLIENT_SECRET: "chatgpt-secret" },
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    let stderr = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Startup timeout: ${stderr}`)), 10_000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
        child.stderr.on("data", chunk => {
          stderr += chunk.toString();
          if (stderr.includes("MCP endpoint:")) { clearTimeout(timer); resolve(); }
        });
      });
      // tools/list does not call Handwrytten: fake credentials never leave the local server.
      const request = (headers: Record<string, string> = {}) => fetch(`${url}/mcp`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const anonymous = await request();
      assert.equal(anonymous.status, fallback ? 200 : 401);
      if (!fallback) assert.match(anonymous.headers.get("www-authenticate")!, /resource_metadata/);
      await anonymous.text();
      for (const headers of [{ "X-API-Key": "caller-key" }, { Authorization: "caller-key" }, { Authorization: "Bearer caller-token" }]) {
        const response = await request(headers);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /"get_user"/);
      }
      const metadata = await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json();
      assert.equal(metadata.registration_endpoint, `${url}/register`);
      for (const [prefix, id] of [["", "claude"], ["/chatgpt", "chatgpt"]]) {
        const registration = await (await fetch(`${url}${prefix}/register`, { method: "POST" })).json();
        assert.equal(registration.client_id, id);
        assert.equal(registration.client_secret, `${id}-secret`);
        const response = await fetch(`${url}${prefix}/mcp`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        });
        assert.equal(response.status, fallback ? 200 : 401);
        if (!fallback) assert.equal(response.headers.get("www-authenticate"), `Bearer resource_metadata="${url}${prefix}/.well-known/oauth-protected-resource"`);
        await response.text();
        const keyed = await fetch(`${url}${prefix}/mcp`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-API-Key": "caller-key" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        });
        assert.equal(keyed.status, 200);
        assert.match(await keyed.text(), /"get_user"/);
      }
      const preflight = await fetch(`${url}/mcp`, { method: "OPTIONS" });
      assert.match(preflight.headers.get("access-control-allow-headers")!, /MCP-Protocol-Version/);
    } finally {
      if (child.exitCode === null) {
        await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });
      }
    }
  });
}
