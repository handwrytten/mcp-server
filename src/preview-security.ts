import { parseMcpServerUrl } from "./runtime-config.js";

export const IMAGE_ORIGINS = ["https://cdn.handwrytten.com", "https://d3e924qpzqov0g.cloudfront.net"];

export function validateImageUrl(value: string): URL {
  const url = new URL(value);
  if (!IMAGE_ORIGINS.includes(url.origin) || url.username || url.password) {
    throw new Error("Image URL must use an approved Handwrytten HTTPS CDN origin.");
  }
  return url;
}

/** The UI loads bundled assets and images; tool calls use the host bridge. */
export function previewMetadata(serverUrl?: string) {
  const domain = parseMcpServerUrl(process.env.MCP_WIDGET_DOMAIN || serverUrl || "https://mcp.handwrytten.com");
  const resourceDomains = [...IMAGE_ORIGINS, "data:"];
  const csp = { connectDomains: [] as string[], resourceDomains };
  return {
    legacyCsp: { "img-src": resourceDomains, "connect-src": [] as string[] },
    resourceMeta: {
      ui: { domain, csp },
      "openai/widgetDomain": domain,
      "openai/widgetCSP": { connect_domains: [], resource_domains: resourceDomains },
    },
  };
}
