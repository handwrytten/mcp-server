import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

// Preserve the original advertised scopes until backend client allowlists
// and enforcement are migrated together. A global catalog entry is not enough.
export const OAUTH_SCOPES = [
  "read:profile", "send:cards", "read:orders", "read:contacts", "write:contacts", "read:balance",
];

// OAuth is advertised at the server level; the installed SDK cannot emit
// top-level tool securitySchemes. Do not emit an incomplete _meta-only mirror.
export function registerAuthenticatedTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  annotations: ToolAnnotations,
  callback: ToolCallback<Args>,
) {
  return server.registerTool(name, {
    title: annotations.title,
    description,
    inputSchema,
    annotations: { openWorldHint: true, ...annotations },
  }, callback);
}

export function toolError(error: unknown, oauthServerUrl?: string): CallToolResult {
  const failure = error as { message?: string; statusCode?: number; responseBody?: { error?: string } } | null;
  const result: CallToolResult = {
    content: [{ type: "text", text: `Error: ${failure?.message || "Handwrytten request failed"}` }],
    isError: true,
  };
  // Only explicit OAuth failures should launch OAuth. A bad API key or a
  // billing/permission/network error must not be misreported as an expired login.
  const insufficientScope = failure?.statusCode === 403 && failure.responseBody?.error === "insufficient_scope";
  if (oauthServerUrl && (failure?.statusCode === 401 || insufficientScope)) {
    const resourceMetadata = `${oauthServerUrl.replace(/\/+$/, "")}/.well-known/oauth-protected-resource`;
    result._meta = {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${resourceMetadata}", error="${insufficientScope ? "insufficient_scope" : "invalid_token"}", error_description="Please reconnect your Handwrytten account"`,
      ],
    };
  }
  return result;
}
