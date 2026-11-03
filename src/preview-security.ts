import { parseMcpServerUrl } from "./runtime-config.js";

export const IMAGE_ORIGINS = ["https://cdn.handwrytten.com", "https://d3e924qpzqov0g.cloudfront.net"];

export function validateImageUrl(value: string): URL {
  const url = new URL(value);
  if (!IMAGE_ORIGINS.includes(url.origin) || url.username || url.password) {
    throw new Error("Image URL must use an approved Handwrytten HTTPS CDN origin.");
  }
  return url;
}

/** Image type from the file's magic bytes; the CDN serves many PNGs as application/octet-stream. */
export function imageMimeType(buf: Buffer): string | undefined {
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}

/** The UI loads bundled assets and images; tool calls use the host bridge. */
export function previewMetadata(serverUrl?: string) {
  const domain = parseMcpServerUrl(process.env.MCP_WIDGET_DOMAIN || serverUrl || "https://mcp.handwrytten.com");
  const resourceDomains = [...IMAGE_ORIGINS, "data:"];
  const csp = { connectDomains: [] as string[], resourceDomains };
  return {
    legacyCsp: { "img-src": resourceDomains, "connect-src": [] as string[] },
    resourceMeta: {
      // No ui.domain: Claude rejects anything but its own {hash}.claudemcpcontent.com and won't render the panel.
      ui: { csp },
      "openai/widgetDomain": domain,
      "openai/widgetCSP": { connect_domains: [], resource_domains: resourceDomains },
    },
  };
}
