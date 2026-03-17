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
 */

import { randomUUID } from "node:crypto";
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
import { setupAuthRoutes, extractBearerToken, type OAuthConfig, type TokenInfo } from "./auth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "handwrytten";
const SERVER_VERSION = "1.3.0";
const MCP_INSTRUCTIONS =
  "Handwrytten MCP server — send real handwritten notes at scale using robots with real pens. " +
  "Use list_cards and list_fonts first to discover available options, then send_order to mail a note.";

const SESSION_TTL_MS = 8 * 60 * 60 * 1_000; // 8 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
/** Refresh the token this many ms before it actually expires. */
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1_000; // 2 minutes

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

// ---------------------------------------------------------------------------
// Refreshable client — a JS Proxy wrapper so the same object reference can
// be passed to tool registrations once and the underlying client swapped out
// transparently when the OAuth token is renewed.
// ---------------------------------------------------------------------------

function createRefreshableClient(initial: Handwrytten): {
  proxy: Handwrytten;
  update: (next: Handwrytten) => void;
} {
  let current = initial;
  const proxy = new Proxy({} as Handwrytten, {
    get(_target, prop: string | symbol) {
      const val = (current as unknown as Record<string | symbol, unknown>)[prop];
      return typeof val === "function" ? (val as Function).bind(current) : val;
    },
  });
  return { proxy, update: (next) => { current = next; } };
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
// HTTP MODE (OAuth2 Bearer token auth)
// ═══════════════════════════════════════════════════════════════════════════

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
  /** Swaps out the underlying Handwrytten client after a token refresh. */
  updateClient?: (next: Handwrytten) => void;
  /** Handle for the scheduled token-refresh timer so it can be cancelled. */
  refreshTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Short-lived store that maps an access token to its refresh token and expiry.
 * Populated by the /token proxy endpoint; consumed when a new MCP session is
 * initialised with that access token.
 */
const pendingTokens = new Map<string, TokenInfo>();

/**
 * Use a stored refresh token to obtain a fresh access token from Handwrytten,
 * swap the client referenced by the session, and reschedule the next refresh.
 */
async function doTokenRefresh(
  sessionId: string,
  sessions: Map<string, SessionEntry>,
  refreshToken: string,
  config: OAuthConfig
): Promise<void> {
  try {
    const basicAuth = Buffer.from(
      `${config.oauthClientId}:${config.oauthClientSecret}`
    ).toString("base64");

    const response = await fetch(
      `${config.handwryttenApiUrl}/api/v1/oauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      }
    );

    const data = await response.json();
    if (!response.ok || !data.access_token) {
      console.error(`Session ${sessionId}: token refresh failed (${response.status}):`, data);
      return;
    }

    const session = sessions.get(sessionId);
    if (!session?.updateClient) return;

    session.updateClient(new Handwrytten({ accessToken: data.access_token }));
    console.error(`Session ${sessionId}: token refreshed successfully`);

    // Schedule the next refresh
    const nextRefresh = data.refresh_token ?? refreshToken;
    const expiresIn = (data.expires_in ?? 3600) * 1_000;
    const delay = Math.max(expiresIn - TOKEN_REFRESH_BUFFER_MS, 30_000);

    if (session.refreshTimer) clearTimeout(session.refreshTimer);
    session.refreshTimer = setTimeout(
      () => doTokenRefresh(sessionId, sessions, nextRefresh, config),
      delay
    );
  } catch (e: any) {
    console.error(`Session ${sessionId}: token refresh error:`, e.message);
  }
}

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
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    setupAuthRoutes(app, oauthConfig, (info) => {
      // Store the refresh token keyed by access token so we can set up
      // proactive renewal when the MCP session is initialised.
      pendingTokens.set(info.accessToken, info);
      // Auto-expire the entry after double the token lifetime to avoid leaks.
      setTimeout(
        () => pendingTokens.delete(info.accessToken),
        (info.expiresAt - Date.now()) * 2
      );
    });
  } else {
    console.error("Dev mode: OAuth routes disabled (using HANDWRYTTEN_API_KEY)");
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  const sessions = new Map<string, SessionEntry>();

  // Periodic cleanup of stale sessions
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (now - entry.lastActivity > SESSION_TTL_MS) {
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        entry.transport.close?.();
        sessions.delete(id);
        console.error(`Session ${id} expired and cleaned up`);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // -----------------------------------------------------------------------
  // POST /mcp — handle MCP requests
  // -----------------------------------------------------------------------

  app.post("/mcp", async (req: Request, res: Response) => {
    console.error("POST /mcp", {
      sessionId: req.headers["mcp-session-id"],
      hasAuth: !!req.headers.authorization,
      bodyMethod: req.body?.method,
      bodyId: req.body?.id,
    });

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // --- Existing session ---
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      entry.lastActivity = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
      return;
    }

    // --- New session (must be an initialize request) ---
    if (!sessionId && isInitializeRequest(req.body)) {
      // Extract Bearer token (or use dev API key)
      const token = extractBearerToken(req.headers.authorization);
      if (!token && !DEV_API_KEY) {
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

      // Create per-session Handwrytten client (wrapped in a refreshable proxy
      // so the underlying token can be swapped without re-registering tools).
      const initialClient = token
        ? new Handwrytten({ accessToken: token })
        : new Handwrytten(DEV_API_KEY!);
      const { proxy: clientProxy, update: updateClient } = createRefreshableClient(initialClient);
      const server = createMcpServer(clientProxy, MCP_SERVER_URL);

      // Look up the refresh token that was captured when /token was called.
      const tokenInfo = token ? pendingTokens.get(token) : undefined;
      if (tokenInfo) pendingTokens.delete(token!);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          let refreshTimer: ReturnType<typeof setTimeout> | undefined;

          if (tokenInfo?.refreshToken) {
            const msUntilRefresh = Math.max(
              tokenInfo.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS,
              30_000
            );
            refreshTimer = setTimeout(
              () => doTokenRefresh(id, sessions, tokenInfo.refreshToken, oauthConfig),
              msUntilRefresh
            );
            console.error(
              `Session ${id}: token refresh scheduled in ${Math.round(msUntilRefresh / 60_000)} min`
            );
          }

          sessions.set(id, { server, transport, lastActivity: Date.now(), updateClient, refreshTimer });
          console.error(`Session ${id} initialized`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          const entry = sessions.get(transport.sessionId);
          if (entry?.refreshTimer) clearTimeout(entry.refreshTimer);
          sessions.delete(transport.sessionId);
          console.error(`Session ${transport.sessionId} closed`);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // --- Invalid request ---
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid session or missing initialization request." },
      id: req.body?.id ?? null,
    });
  });

  // -----------------------------------------------------------------------
  // GET /mcp — SSE stream for existing sessions
  // -----------------------------------------------------------------------

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      entry.lastActivity = Date.now();
      await entry.transport.handleRequest(req, res);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session." },
        id: null,
      });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /mcp — close a session
  // -----------------------------------------------------------------------

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
      entry.transport.close?.();
      sessions.delete(sessionId);
      res.status(200).json({ ok: true });
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found." },
        id: null,
      });
    }
  });

  // -----------------------------------------------------------------------
  // Writing preview images — serves server-rendered PNG previews
  // -----------------------------------------------------------------------

  app.get("/preview/:id", (req: Request, res: Response) => {
    const entry = previewCache.get(req.params.id);
    if (!entry || entry.expiresAt < Date.now()) {
      previewCache.delete(req.params.id);
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
