/**
 * OAuth2 proxy routes for the Handwrytten MCP server.
 *
 * The MCP server acts as a proxy between pre-registered OAuth clients and
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
import { OAUTH_SCOPES } from "./tool-auth.js";
import { safeErrorInfo } from "./runtime-config.js";

// ---------------------------------------------------------------------------
// Scopes supported by the Handwrytten OAuth implementation
// ---------------------------------------------------------------------------

const SCOPES = OAUTH_SCOPES;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OAuthConfig {
  /** Public URL of this MCP server (e.g. "https://mcp.handwrytten.com") */
  mcpServerUrl: string;
  /** Handwrytten API base URL (e.g. "https://api.handwrytten.com") */
  handwryttenApiUrl: string;
  /** Route prefix selects the integration; it is not proof of caller identity. */
  routePrefix?: "/chatgpt";
  /** Existing backend client used by the automatic registration compatibility flow. */
  oauthClientId?: string;
  oauthClientSecret?: string;
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
  const prefix = config.routePrefix || "";
  const issuer = `${config.mcpServerUrl}${prefix}`;
  const canRegister = Boolean(config.oauthClientId && config.oauthClientSecret);

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-authorization-server
  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-protected-resource (RFC 9728)
  // Tells MCP clients where to find the authorization server metadata.
  // -----------------------------------------------------------------------

  app.get([`${prefix}/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource${prefix}/mcp`], (_req: Request, res: Response) => {
    res.json({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
    });
  });

  // -----------------------------------------------------------------------
  // GET /.well-known/oauth-authorization-server
  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  // -----------------------------------------------------------------------

  app.get([`${prefix}/.well-known/oauth-authorization-server`, `/.well-known/oauth-authorization-server${prefix}`], (_req: Request, res: Response) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/revoke`,
      ...(canRegister ? { registration_endpoint: `${issuer}/register` } : {}),
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
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
      "resource",
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

  app.get(`${prefix}/authorize`, handleAuthorize);
  app.post(`${prefix}/authorize`, handleAuthorize);

  // -----------------------------------------------------------------------
  // POST /token
  // Proxies the token exchange to the Handwrytten backend.
  // Preserves the caller's client credentials for backend validation.
  // -----------------------------------------------------------------------

  app.post(`${prefix}/token`, async (req: Request, res: Response) => {
    try {
      res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });

      // Forward as JSON to the backend
      const response = await fetch(`${backendOAuthBase}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        },
        body: JSON.stringify(req.body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });

      const data = await response.json();
      const challenge = response.headers.get("www-authenticate");
      if (challenge) res.set("WWW-Authenticate", challenge);

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
      console.error("Token proxy request failed", safeErrorInfo(e));
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

  app.post(`${prefix}/revoke`, async (req: Request, res: Response) => {
    try {
      res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });

      const response = await fetch(`${backendOAuthBase}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        },
        body: JSON.stringify(req.body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });

      const data = await response.json();
      const challenge = response.headers.get("www-authenticate");
      if (challenge) res.set("WWW-Authenticate", challenge);
      res.status(response.status).json(data);
    } catch (e: any) {
      console.error("Revoke proxy request failed", safeErrorInfo(e));
      res.status(502).json({
        error: "server_error",
        error_description: "Failed to reach authorization server.",
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /register
  // Preserve the existing automatic setup contract, separately per product.
  // This distributes a configured shared credential, not a newly created client.
  // Backend redirect allowlists remain authoritative.
  // -----------------------------------------------------------------------

  app.post(`${prefix}/register`, (req: Request, res: Response) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
    if (canRegister) {
      res.status(201).json({
        client_id: config.oauthClientId,
        client_secret: config.oauthClientSecret,
        client_name: req.body?.client_name || "MCP Client",
        redirect_uris: req.body?.redirect_uris || [],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
      });
      return;
    }
    res.status(503).json({
      error: "temporarily_unavailable",
      error_description: "Automatic registration is not configured for this endpoint. Contact the server operator.",
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

// ---------------------------------------------------------------------------
// API key extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a Handwrytten API key for third-party clients and MCP gateways
 * (e.g. Runlayer) that authenticate with a static key instead of OAuth.
 *
 * Accepted forms, in priority order:
 *   1. `X-API-Key: <key>` header
 *   2. Raw `Authorization: <key>` header with no auth scheme — the same
 *      convention the Handwrytten SDK uses for API key auth. Values with a
 *      scheme prefix (e.g. "Bearer x", "Basic x") are ignored here.
 */
export function extractApiKey(
  apiKeyHeader: string | string[] | undefined,
  authHeader: string | undefined
): string | null {
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }
  if (authHeader) {
    const value = authHeader.trim();
    // API keys never contain spaces; scheme-formatted credentials always do.
    if (value && !value.includes(" ")) {
      return value;
    }
  }
  return null;
}
