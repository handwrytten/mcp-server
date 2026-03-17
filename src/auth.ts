/**
 * OAuth2 proxy routes for the Handwrytten MCP server.
 *
 * The MCP server acts as a proxy between the MCP client (Claude) and
 * the Handwrytten backend OAuth endpoints. This keeps the MCP server
 * as the single point of contact for the MCP client.
 *
 * Routes:
 *   GET  /.well-known/oauth-authorization-server  → metadata
 *   GET  /authorize                                → redirect to backend
 *   POST /token                                    → proxy to backend
 *   POST /revoke                                   → proxy to backend
 */

import type { Express, Request, Response } from "express";

// ---------------------------------------------------------------------------
// Scopes supported by the Handwrytten OAuth implementation
// ---------------------------------------------------------------------------

const SCOPES = [
  "read:profile",
  "send:cards",
  "read:orders",
  "read:contacts",
  "write:contacts",
  "read:balance",
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OAuthConfig {
  /** Public URL of this MCP server (e.g. "https://mcp.handwrytten.com") */
  mcpServerUrl: string;
  /** Handwrytten API base URL (e.g. "https://api.handwrytten.com") */
  handwryttenApiUrl: string;
  /** OAuth client ID for this MCP server */
  oauthClientId: string;
  /** OAuth client secret for this MCP server */
  oauthClientSecret: string;
}

export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

export type OnTokenIssuedCallback = (info: TokenInfo) => void;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupAuthRoutes(app: Express, config: OAuthConfig, onTokenIssued?: OnTokenIssuedCallback): void {
  const backendOAuthBase = `${config.handwryttenApiUrl}/api/v1/oauth`;

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-authorization-server
  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-protected-resource (RFC 9728)
  // Tells MCP clients where to find the authorization server metadata.
  // -----------------------------------------------------------------------

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: `${config.mcpServerUrl}/mcp`,
      authorization_servers: [config.mcpServerUrl],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
    });
  });

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-authorization-server
  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  // -----------------------------------------------------------------------

  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json({
      issuer: config.mcpServerUrl,
      authorization_endpoint: `${config.mcpServerUrl}/authorize`,
      token_endpoint: `${config.mcpServerUrl}/token`,
      revocation_endpoint: `${config.mcpServerUrl}/revoke`,
      registration_endpoint: `${config.mcpServerUrl}/register`,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256", "plain"],
      scopes_supported: SCOPES,
      service_documentation: "https://www.handwrytten.com/api/",
    });
  });

  // -----------------------------------------------------------------------
  // GET /authorize
  // Redirects the user to Handwrytten's authorize endpoint, passing through
  // all OAuth query params. The user logs in and grants consent there.
  // -----------------------------------------------------------------------

  function handleAuthorize(req: Request, res: Response): void {
    const allowedParams = [
      "client_id",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ];

    // Accept params from query string (GET) or body (POST)
    const source = req.method === "POST" ? { ...req.query, ...req.body } : req.query;

    const params = new URLSearchParams();
    for (const key of allowedParams) {
      const value = source[key];
      if (typeof value === "string") {
        params.set(key, value);
      }
    }

    const redirectUrl = `${backendOAuthBase}/authorize?${params.toString()}`;
    res.redirect(302, redirectUrl);
  }

  app.get("/authorize", handleAuthorize);
  app.post("/authorize", handleAuthorize);

  // -----------------------------------------------------------------------
  // POST /token
  // Proxies the token exchange to the Handwrytten backend.
  // Injects the MCP server's client credentials.
  // -----------------------------------------------------------------------

  app.post("/token", async (req: Request, res: Response) => {
    try {
      console.error("Token request body:", JSON.stringify(req.body));

      const basicAuth = Buffer.from(
        `${config.oauthClientId}:${config.oauthClientSecret}`
      ).toString("base64");

      // Forward as JSON to the backend
      const response = await fetch(`${backendOAuthBase}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      console.error("Token response:", response.status, JSON.stringify(data));

      // Notify caller so it can track refresh tokens for proactive renewal
      if (onTokenIssued && response.ok && data.access_token && data.refresh_token) {
        onTokenIssued({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + (data.expires_in ?? 3600) * 1_000,
        });
      }

      res.status(response.status).json(data);
    } catch (e: any) {
      console.error("Token proxy error:", e.message);
      res.status(502).json({
        error: "server_error",
        error_description: "Failed to reach authorization server.",
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /revoke
  // Proxies token revocation to the Handwrytten backend.
  // -----------------------------------------------------------------------

  app.post("/revoke", async (req: Request, res: Response) => {
    try {
      const basicAuth = Buffer.from(
        `${config.oauthClientId}:${config.oauthClientSecret}`
      ).toString("base64");

      const response = await fetch(`${backendOAuthBase}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      console.error("Revoke proxy error:", e.message);
      res.status(502).json({
        error: "server_error",
        error_description: "Failed to reach authorization server.",
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /register
  // Dynamic Client Registration (RFC 7591) — required by MCP spec.
  // Since Handwrytten uses pre-registered clients, we return the MCP
  // server's own client credentials to any registering MCP client.
  // -----------------------------------------------------------------------

  app.post("/register", (req: Request, res: Response) => {
    res.status(201).json({
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      client_name: req.body?.client_name || "MCP Client",
      redirect_uris: req.body?.redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    });
  });
}

// ---------------------------------------------------------------------------
// Bearer token extraction
// ---------------------------------------------------------------------------

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}
