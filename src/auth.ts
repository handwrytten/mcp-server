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
  "read:orders",
  "write:orders",
  "send:cards",
  "read:cards",
  "write:cards",
  "read:contacts",
  "write:contacts",
  "read:campaigns",
  "write:campaigns",
  "read:balance",
  "manage:billing",
  "manage:subscriptions",
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupAuthRoutes(app: Express, config: OAuthConfig): void {
  const backendOAuthBase = `${config.handwryttenApiUrl}/api/v1/oauth`;

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

  app.get("/authorize", (req: Request, res: Response) => {
    const allowedParams = [
      "client_id",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ];

    const params = new URLSearchParams();
    for (const key of allowedParams) {
      const value = req.query[key];
      if (typeof value === "string") {
        params.set(key, value);
      }
    }

    const redirectUrl = `${backendOAuthBase}/authorize?${params.toString()}`;
    res.redirect(302, redirectUrl);
  });

  // -----------------------------------------------------------------------
  // POST /token
  // Proxies the token exchange to the Handwrytten backend.
  // Injects the MCP server's client credentials.
  // -----------------------------------------------------------------------

  app.post("/token", async (req: Request, res: Response) => {
    try {
      const basicAuth = Buffer.from(
        `${config.oauthClientId}:${config.oauthClientSecret}`
      ).toString("base64");

      const response = await fetch(`${backendOAuthBase}/token`, {
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
