/**
 * Handwrytten MCP Server
 *
 * Exposes the full Handwrytten API as MCP tools so AI assistants
 * like Claude can send real handwritten notes, manage addresses,
 * browse cards/fonts, and more.
 *
 * Supports two transport modes:
 *   - **stdio** (legacy): Uses HANDWRYTTEN_API_KEY for local Claude Desktop / CLI.
 *   - **http**  (new):    Uses OAuth2 Bearer tokens for remote deployment
 *                          and Claude Marketplace integration.
 *
 * HTTP mode is **sessionless** — each request creates its own MCP server
 * and transport, with no server-side session tracking. This makes the
 * server fully stateless and horizontally scalable.
 */

import fs from "node:fs";
import path from "node:path";
import { urlencoded } from "express";
import type { Request, Response } from "express";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Handwrytten } from "handwrytten";

import { registerTools } from "./tools.js";
import { registerAppTools, previewCache } from "./app-tools.js";
import { setupAuthRoutes, extractBearerToken, type OAuthConfig } from "./auth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "handwrytten";
const SERVER_VERSION = "1.3.0";
const MCP_INSTRUCTIONS =
  "Handwrytten MCP server — send real handwritten notes at scale using robots with real pens. " +
  "Use list_cards and list_fonts first to discover available options, then send_order to mail a note.";

// ---------------------------------------------------------------------------
// Helper: create a McpServer with tools registered for a given client
// ---------------------------------------------------------------------------

function createMcpServer(client: Handwrytten, serverUrl?: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: MCP_INSTRUCTIONS,
    }
  );
  registerTools(server, client);
  registerAppTools(server, client, serverUrl);
  return server;
}

// ═══════════════════════════════════════════════════════════════════════════
// STDIO MODE (legacy — API key auth)
// ═══════════════════════════════════════════════════════════════════════════

async function runStdio(): Promise<void> {
  const API_KEY = process.env.HANDWRYTTEN_API_KEY;
  if (!API_KEY) {
    console.error(
      "Error: HANDWRYTTEN_API_KEY environment variable is required for stdio mode.\n" +
        "Get your API key at https://www.handwrytten.com/api/"
    );
    process.exit(1);
  }

  const client = new Handwrytten(API_KEY);
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Handwrytten MCP server running on stdio");
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP MODE (sessionless, OAuth2 Bearer token auth)
// ═══════════════════════════════════════════════════════════════════════════

async function runHttp(): Promise<void> {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
  const HANDWRYTTEN_API_URL = (process.env.HANDWRYTTEN_API_URL || "https://api2.handwrytten.com").replace(/\/+$/, "");
  const OAUTH_CLIENT_ID = process.env.HANDWRYTTEN_OAUTH_CLIENT_ID;
  const OAUTH_CLIENT_SECRET = process.env.HANDWRYTTEN_OAUTH_CLIENT_SECRET;
  const DEV_API_KEY = process.env.HANDWRYTTEN_API_KEY; // Dev mode: skip OAuth

  if (!MCP_SERVER_URL) {
    console.error("Error: MCP_SERVER_URL environment variable is required for HTTP mode.");
    process.exit(1);
  }
  if (!DEV_API_KEY && (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET)) {
    console.error(
      "Error: Set HANDWRYTTEN_API_KEY for dev mode, or HANDWRYTTEN_OAUTH_CLIENT_ID and HANDWRYTTEN_OAUTH_CLIENT_SECRET for production."
    );
    process.exit(1);
  }

  const oauthConfig: OAuthConfig = {
    mcpServerUrl: MCP_SERVER_URL.replace(/\/+$/, ""),
    handwryttenApiUrl: HANDWRYTTEN_API_URL,
    oauthClientId: OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: OAUTH_CLIENT_SECRET ?? "",
  };

  // -----------------------------------------------------------------------
  // Express app
  // -----------------------------------------------------------------------

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Parse URL-encoded bodies (OAuth token requests use application/x-www-form-urlencoded)
  app.use(urlencoded({ extended: true }));

  // CORS — needed for browser-based MCP clients (e.g. MCP Inspector)
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // OAuth proxy routes (skip in dev mode — no client ID/secret)
  if (OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET) {
    setupAuthRoutes(app, oauthConfig);
  } else {
    console.error("Dev mode: OAuth routes disabled (using HANDWRYTTEN_API_KEY)");
  }

  // -----------------------------------------------------------------------
  // HEAD /mcp — allow clients to probe the endpoint without a token
  // Required by the MCP Directory submission guide.
  // -----------------------------------------------------------------------

  app.head("/mcp", (_req: Request, res: Response) => {
    res.set("Content-Type", "application/json");
    res.status(200).end();
  });

  // -----------------------------------------------------------------------
  // POST /mcp — handle MCP requests (stateless: new server per request)
  // -----------------------------------------------------------------------

  app.post("/mcp", async (req: Request, res: Response) => {
    console.error("POST /mcp", {
      hasAuth: !!req.headers.authorization,
      bodyMethod: req.body?.method,
      bodyId: req.body?.id,
    });

    // Extract Bearer token (or use dev API key)
    const token = extractBearerToken(req.headers.authorization);
    const isInit = isInitializeRequest(req.body);

    // Allow initialize through without auth (capability discovery).
    // All other methods require a valid token.
    if (!token && !DEV_API_KEY && !isInit) {
      const mcpServerUrl = oauthConfig.mcpServerUrl;
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${mcpServerUrl}/.well-known/oauth-protected-resource"`
        )
        .json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bearer token required. Authenticate via OAuth first.",
          },
          id: (req.body as Record<string, unknown>)?.id ?? null,
        });
      return;
    }

    // Create a fresh client, server, and transport for this request.
    // For unauthenticated initialize, use a dummy client — the initialize
    // response only contains server name/version/capabilities, no API calls.
    const client = token
      ? new Handwrytten({ accessToken: token })
      : new Handwrytten(DEV_API_KEY || "unauthenticated");
    const server = createMcpServer(client, MCP_SERVER_URL);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // -----------------------------------------------------------------------
  // GET /mcp — return 405 (SSE streams not supported in sessionless mode)
  // -----------------------------------------------------------------------

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "SSE streams not supported. Use POST for all requests." },
      id: null,
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /mcp — return 405 (no sessions to close)
  // -----------------------------------------------------------------------

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Sessions not supported. Nothing to delete." },
      id: null,
    });
  });

  // -----------------------------------------------------------------------
  // Writing preview images — serves server-rendered PNG previews
  // -----------------------------------------------------------------------

  app.get("/preview/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const entry = previewCache.get(id);
    if (!entry || entry.expiresAt < Date.now()) {
      previewCache.delete(id);
      res.status(404).send("Preview expired or not found");
      return;
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=600");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(entry.png);
  });

  // -----------------------------------------------------------------------
  // Image proxy — serves CDN images through this server so MCP App
  // sandbox can load them (avoids CSP cross-origin issues)
  // -----------------------------------------------------------------------

  app.get("/img", async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url || (!url.startsWith("https://cdn.handwrytten.com") && !url.startsWith("https://d3e924qpzqov0g.cloudfront.net"))) {
      res.status(400).send("Invalid URL");
      return;
    }
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        res.status(upstream.status).send("Upstream error");
        return;
      }
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400");
      res.set("Access-Control-Allow-Origin", "*");
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (e: any) {
      console.error("Image proxy error:", e.message);
      res.status(502).send("Proxy error");
    }
  });

  // -----------------------------------------------------------------------
  // Documentation page (GET /)
  // -----------------------------------------------------------------------

  const docsHtmlPath = import.meta.filename.endsWith(".ts")
    ? path.join(import.meta.dirname, "ui", "docs.html")
    : path.join(import.meta.dirname, "src", "ui", "docs.html");
  const docsHtml = fs.readFileSync(docsHtmlPath, "utf-8");

  app.get("/", (_req: Request, res: Response) => {
    res.set("Content-Type", "text/html");
    res.send(docsHtml);
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // -----------------------------------------------------------------------
  // Start listening
  // -----------------------------------------------------------------------

  app.listen(PORT, "0.0.0.0", () => {
    console.error(`Handwrytten MCP server listening on http://0.0.0.0:${PORT}`);
    console.error(`OAuth metadata: ${oauthConfig.mcpServerUrl}/.well-known/oauth-authorization-server`);
    console.error(`MCP endpoint:   ${oauthConfig.mcpServerUrl}/mcp`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry point — auto-detect transport mode
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const explicitMode = process.env.MCP_TRANSPORT?.toLowerCase();

  if (explicitMode === "stdio") {
    await runStdio();
  } else if (explicitMode === "http") {
    await runHttp();
  } else {
    // Auto-detect: if stdin is piped (not a TTY), use stdio; otherwise HTTP.
    // When launched by Claude Desktop / Claude Code, stdin is always piped.
    if (process.stdin.isTTY === undefined || process.stdin.isTTY === false) {
      await runStdio();
    } else {
      await runHttp();
    }
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
