# ChatGPT and Claude OAuth setup

This branch adds a separate ChatGPT endpoint on the same server. Changes require deployment; a successful live OAuth connection has not yet been verified.

## URLs

| Platform | MCP URL | OAuth issuer | Automatic registration |
| --- | --- | --- | --- |
| Claude (existing) | `https://mcp.handwrytten.com/mcp` | `https://mcp.handwrytten.com` | `/register` |
| ChatGPT (new) | `https://mcp.handwrytten.com/chatgpt/mcp` | `https://mcp.handwrytten.com/chatgpt` | `/chatgpt/register` |

The URL selects the integration configuration. No platform-identification header or query parameter is required. The URL does not prove the identity of the caller. Both platforms still use Handwrytten's backend login and consent screens; end users do not enter client IDs or secrets.

## Server environment

```dotenv
MCP_TRANSPORT=http
MCP_SERVER_URL=https://mcp.handwrytten.com
HANDWRYTTEN_API_URL=https://api2.handwrytten.com
PORT=3000

# Keep existing Claude values unchanged
HANDWRYTTEN_OAUTH_CLIENT_ID=<existing Claude client ID>
HANDWRYTTEN_OAUTH_CLIENT_SECRET=<existing Claude client secret>

# Separate backend ChatGPT OAuth client
HANDWRYTTEN_CHATGPT_OAUTH_CLIENT_ID=<ChatGPT client ID>
HANDWRYTTEN_CHATGPT_OAUTH_CLIENT_SECRET=<ChatGPT client secret>
```

Keep MCP_SERVER_URL at the origin, without `/chatgpt` or `/mcp`. Malformed URLs and URLs containing credentials, paths, queries, or fragments fail startup. Set both ChatGPT variables; the ChatGPT route never falls back to Claude's credentials. Registration is advertised only when the respective credential pair is configured. Unconfigured registration returns HTTP 503 with temporarily_unavailable, while manually configured OAuth clients can still use the proxy.

Each registration route retains the existing Claude automatic setup behavior: it returns that product's configured credentials. Token and revocation routes forward supplied Basic or POST body credentials unchanged. They do not overwrite ChatGPT's credentials with Claude's or inject credentials into requests that omit them.

## Backend settings

Keep separate client records for Claude, ChatGPT, and HubSpot. Do not replace Claude's or HubSpot's IDs, secrets, or redirect allowlists.

For ChatGPT use authorization_code and refresh_token grants, response type code, client_secret_basic authentication and S256 PKCE. Allow the needed scopes:

```json
["read:profile", "send:cards", "read:orders", "read:contacts", "write:contacts", "read:balance"]
```

Copy the exact callback shown by ChatGPT into the ChatGPT backend client's redirect_uris array. Changing the MCP URL or creating another connector may produce a different callback. The previous development connector used `https://chatgpt.com/connector/oauth/IwkHRvUGaflC`; do not assume a new connector will reuse it. The callback is a ChatGPT URL, not `/chatgpt/mcp`.

## ChatGPT setup after deployment

1. Open ChatGPT in the browser. Enable developer mode under Settings > Security and login if needed.
2. Open Plugins > Create app. Use `https://mcp.handwrytten.com/chatgpt/mcp` and OAuth.
3. In Advanced OAuth settings choose Dynamic Client Registration (DCR). No manually entered client ID or secret is needed in this mode.
4. Confirm discovery uses `/chatgpt/authorize`, `/chatgpt/token`, and `/chatgpt/register`, with issuer `https://mcp.handwrytten.com/chatgpt` and resource `https://mcp.handwrytten.com/chatgpt/mcp`.
5. Add the exact callback displayed by ChatGPT to the backend ChatGPT client allowlist before completing connection. If callback details are only available during connection, finish that configuration before retrying authorization.
6. Sign in to Handwrytten and approve access. Verify discovery and a read-only tool before testing writes.

The already-created development connector points at `/mcp` and uses manually configured credentials. Update or recreate it for the new URL and DCR flow. Leave the existing Claude connector URL unchanged.

## Discovery endpoints

Claude's original `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` remain available.

ChatGPT uses `/.well-known/oauth-authorization-server/chatgpt` (RFC 8414 issuer discovery) and `/.well-known/oauth-protected-resource/chatgpt/mcp` (resource discovery). The `/chatgpt/.well-known/oauth-authorization-server` and `/chatgpt/.well-known/oauth-protected-resource` aliases are also supported; HTTP and tool-level challenges point to the latter.

## Compatibility and deferred security work

Automatic setup deliberately preserves the existing shared-per-product credential distribution behavior. This is not full dynamic provisioning: registration echoes requested redirects but does not add them to the backend. The backend's exact redirect allowlist remains authoritative. Separate URLs do not make the distributed client credentials confidential. Coordinate future redesign and credential rotation with working client connections.

Existing clients that send their saved Basic or POST credentials can continue refreshing. Clients relying on the old proxy to inject missing credentials need verification before rollout. No live Claude reconnect or refresh has been tested by the local test suite.

Both endpoints serve the same tools. OAuth scopes are advertised at server level; per-tool scope declarations are not emitted. Enforce authorization in the backend.

Caller API keys remain supported through X-API-Key or raw Authorization on both endpoints. HANDWRYTTEN_API_KEY remains required for local stdio. Private HTTP deployments may explicitly enable environment-key fallback with MCP_ALLOW_API_KEY_FALLBACK=true; it is disabled by default.

HANDWRYTTEN_API_URL configures the OAuth proxy, not the SDK tool API destination. A staging MCP alone does not make writes safe: use a confirmed test account/environment.

## References

- [OpenAI authentication](https://developers.openai.com/plugins/build/auth)
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## Preview and scope checks before merge

The original six advertised OAuth scopes are retained. Do not add read:cards, write:cards, or write:orders to discovery until every affected backend client allowlist and enforcement policy has been coordinated and tested.

Existing tool-level CSP declarations are retained, alongside standard resource CSP in resource listings and resource contents. Resource CSP includes data: and blob: image sources and the existing Handwrytten, CloudFront, and S3 host families. These declarations have local serialization tests; that does not establish host rendering compatibility.

Commit 61eb87c reverts 735cfc3 without explaining why. Live verification remains required for each of Preview-Cards, Preview-Writing, and View-Basket in Claude web, Claude Desktop, and ChatGPT. Check card images, initial writing image and rerender, basket images, and host CSP errors. Use an existing test basket; no real sends are required. All nine host/app combinations are currently unverified on this branch.

Discovery advertises S256 PKCE only. Backend enforcement is separate; changing discovery does not reject direct plain-PKCE requests in the backend.
