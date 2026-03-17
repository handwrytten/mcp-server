/**
 * MCP App tool and resource registrations.
 *
 * Registers two MCP Apps:
 *   1. Card Preview — interactive 3D card browser
 *   2. Writing Preview — handwriting preview on card
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Handwrytten } from "handwrytten";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { renderCardToSvgServer } from "./server-postcard-renderer.js";

/** Convert an SVG string to a PNG Buffer. */
function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: 800 },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ---------------------------------------------------------------------------
// In-memory preview image cache — served via /preview/:id in index.ts
// ---------------------------------------------------------------------------

export const previewCache = new Map<string, { png: Buffer; expiresAt: number }>();
const PREVIEW_TTL_MS = 10 * 60 * 1_000; // 10 minutes

/** Store a PNG in the cache and return its ID. */
function cachePreview(png: Buffer): string {
  const id = crypto.randomUUID();
  previewCache.set(id, { png, expiresAt: Date.now() + PREVIEW_TTL_MS });
  // Lazy cleanup of expired entries
  for (const [key, entry] of previewCache) {
    if (entry.expiresAt < Date.now()) previewCache.delete(key);
  }
  return id;
}

// Works both from source (.ts) and compiled (dist/.js)
// Vite outputs HTML to dist/src/ui/, tsup outputs JS to dist/
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "dist", "src", "ui")
  : path.join(import.meta.dirname, "src", "ui");

// Rewrite CloudFront URLs to cdn.handwrytten.com (CSP-friendly)
function cdnUrl(url: string | undefined): string {
  if (!url) return "";
  return url.replace("https://d3e924qpzqov0g.cloudfront.net", "https://cdn.handwrytten.com");
}

function cdnImages(images: any): any {
  if (!images) return images;
  const result = { ...images };
  for (const key of Object.keys(result)) {
    if (result[key]?.image) {
      result[key] = { ...result[key], image: cdnUrl(result[key].image) };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAppTools(
  server: McpServer,
  client: Handwrytten,
  serverUrl?: string
): void {
  const cardPreviewUri = "ui://handwrytten/card-preview.html";

  // ═══════════════════════════════════════════════════════════════════════════
  // CARD PREVIEW APP
  // ═══════════════════════════════════════════════════════════════════════════

  registerAppTool(
    server,
    "Preview-Cards",
    {
      title: "Browse Cards",
      description:
        "Browse and preview card templates interactively with 3D flip animation " +
        "showing front, inside, and back views. Shows card name and price.",
      inputSchema: {
        categoryId: z
          .number()
          .optional()
          .describe("Optional category ID to filter cards"),
        query: z
          .string()
          .optional()
          .describe("Optional search query to filter card names"),
      },
      _meta: {
        ui: {
          resourceUri: cardPreviewUri,
          csp: {
            "img-src": [
              "https://*.cloudfront.net",
              "https://*.handwrytten.com",
              "https://*.amazonaws.com",
              "https://*.trycloudflare.com",
              "https:",
              "http:",
              "data:",
              "blob:",
            ],
            "connect-src": [
              "https://*.cloudfront.net",
              "https://*.handwrytten.com",
              "https://*.amazonaws.com",
              "https://*.trycloudflare.com",
              "https:",
              "http:",
            ],
          },
        },
      },
    },
    async ({ categoryId, query }): Promise<CallToolResult> => {
      try {
        // Fetch categories and first page of cards in parallel
        const [categoriesRaw, cardsRaw] = await Promise.all([
          (client as any)._http.get("categories/list") as Promise<any>,
          (client as any)._http.get(
            `cards/list?with_detailed_images=true&with_images=true&pagination=1&page=1&limit=8` +
              (categoryId ? `&where[category_id]=${categoryId}` : "") +
              (query
                ? `&like[name]=${encodeURIComponent(query)}`
                : "&randomise=1")
          ) as Promise<any>,
        ]);

        const categories = (categoriesRaw?.categories ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
        }));

        const cards = (cardsRaw?.cards ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          cover: cdnUrl(c.cover),
          price: c.price,
          discount_price: c.discount_price,
          orientation: c.orientation,
          category_id: c.category_id,
          detailed_images: cdnImages(c.detailed_images),
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ categories, cards, page: 1, serverUrl: serverUrl || "" }, null, 2),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool for the card preview app to fetch more cards
  server.tool(
    "get_cards_detailed",
    "Fetch cards with detailed images (front/inside/back). Used by the card preview app.",
    {
      categoryId: z.number().optional().describe("Category ID filter"),
      page: z.number().optional().describe("Page number (default: 1)"),
      perPage: z.number().optional().describe("Results per page (default: 20)"),
      query: z.string().optional().describe("Search card names"),
    },
    async ({ categoryId, page, perPage, query }) => {
      try {
        const pg = Math.max(1, page ?? 1);
        const pp = Math.min(50, Math.max(1, perPage ?? 20));

        const data = (await (client as any)._http.get(
          `cards/list?with_detailed_images=true&with_images=true&pagination=1` +
            `&page=${pg}&limit=${pp}` +
            (categoryId ? `&where[category_id]=${categoryId}` : "") +
            (query
              ? `&like[name]=${encodeURIComponent(query)}`
              : "&randomise=1")
        )) as any;

        const cards = (data?.cards ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          cover: cdnUrl(c.cover),
          price: c.price,
          discount_price: c.discount_price,
          orientation: c.orientation,
          category_id: c.category_id,
          detailed_images: cdnImages(c.detailed_images),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ cards, page: pg, perPage: pp, serverUrl: serverUrl || "" }),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool for the card preview app to fetch images (bypasses sandbox CSP)
  server.tool(
    "get_card_image",
    "Fetch a card image and return it as an MCP image content block. Used by the card preview app.",
    {
      url: z.string().describe("Image URL to fetch"),
    },
    async ({ url }) => {
      try {
        // Only allow fetching from known CDN domains
        if (
          !url.startsWith("https://cdn.handwrytten.com") &&
          !url.startsWith("https://d3e924qpzqov0g.cloudfront.net")
        ) {
          return {
            content: [{ type: "text" as const, text: "Invalid URL domain" }],
            isError: true,
          };
        }

        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${res.status}` }],
            isError: true,
          };
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "image/jpeg";

        return {
          content: [{
            type: "image" as const,
            data: buffer.toString("base64"),
            mimeType: contentType,
          }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
        };
      }
    }
  );


  // Card preview resource
  registerAppResource(
    server,
    cardPreviewUri,
    cardPreviewUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "card-preview.html"),
        "utf-8"
      );
      return {
        contents: [
          { uri: cardPreviewUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITING PREVIEW (returns PNG image inline — no app/iframe needed)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "preview_writing",
    "Preview how a handwritten message will look on a card. Returns a PNG image " +
      "rendered server-side in the chosen handwriting font. Use list_fonts to see available fonts.",
    {
      message: z.string().describe("The message text to preview"),
      fontId: z
        .string()
        .optional()
        .describe("Font ID or label (from list_fonts). Defaults to first available font."),
      cardId: z
        .string()
        .optional()
        .describe("Card ID to use for dimensions. Uses default card size if omitted."),
      wishes: z
        .string()
        .optional()
        .describe("Optional closing text (e.g. 'Best,\\nThe Team')"),
      inkColor: z
        .string()
        .optional()
        .describe("Ink color as hex (default: #0040ac)"),
    },
    async ({ message, fontId, cardId, wishes, inkColor }) => {
      try {
        const [fontsRaw, cardData] = await Promise.all([
          client.fonts.list(),
          cardId
            ? (client.cards.get(cardId) as Promise<any>)
            : Promise.resolve(null),
        ]);

        const fonts = fontsRaw.map((f: any) => ({
          id: f.id,
          name: f.raw?.name || f.name,
          label: f.label || f.name,
          mainFontUrl: f.raw?.path || f.raw?.font_file,
          line_spacing: f.raw?.line_spacing,
        }));

        // Find the selected font
        let selectedFont = fonts[0];
        if (fontId) {
          const match = fonts.find(
            (f: any) =>
              String(f.id) === String(fontId) ||
              f.label?.toLowerCase() === fontId.toLowerCase() ||
              f.name?.toLowerCase() === fontId.toLowerCase()
          );
          if (match) selectedFont = match;
        }

        // Card dimensions (from card data or defaults)
        const card = {
          width: cardData?.raw?.closed_width
            ? parseFloat(cardData.raw.closed_width) * 96
            : 672,
          height: cardData?.raw?.closed_height
            ? parseFloat(cardData.raw.closed_height) * 96
            : 480,
          padding: [
            cardData?.raw?.preview_margin_top
              ? parseFloat(cardData.raw.preview_margin_top) * 96
              : 28.8,
            cardData?.raw?.preview_margin_right
              ? parseFloat(cardData.raw.preview_margin_right) * 96
              : 28.8,
            cardData?.raw?.preview_margin_bottom
              ? parseFloat(cardData.raw.preview_margin_bottom) * 96
              : 28.8,
            cardData?.raw?.preview_margin_left
              ? parseFloat(cardData.raw.preview_margin_left) * 96
              : 28.8,
          ],
        };

        // Fetch font file and render SVG → PNG server-side
        let renderError = "";
        if (selectedFont.mainFontUrl) {
          try {
            const fontRes = await fetch(selectedFont.mainFontUrl);
            if (fontRes.ok) {
              const fontBuffer = Buffer.from(await fontRes.arrayBuffer());
              const font = opentype.parse(fontBuffer.buffer.slice(
                fontBuffer.byteOffset,
                fontBuffer.byteOffset + fontBuffer.byteLength
              ));
              const svg = renderCardToSvgServer(
                {
                  card: {
                    width: card.width,
                    height: card.height,
                    padding: card.padding as [number, number, number, number],
                  },
                  message: {
                    text: message,
                    lineHeight: selectedFont.line_spacing ?? undefined,
                  },
                  wishes: wishes ? { text: wishes } : undefined,
                  inkColor: inkColor || "#0040ac",
                },
                font
              );
              const png = svgToPng(svg);
              const previewId = cachePreview(png);
              const previewUrl = `${serverUrl}/preview/${previewId}`;
              return {
                content: [
                  {
                    type: "image" as const,
                    data: png.toString("base64"),
                    mimeType: "image/png",
                  },
                  {
                    type: "text" as const,
                    text: `Font: ${selectedFont.label} (${selectedFont.id})\nPreview: ${previewUrl}`,
                  },
                ],
              };
            } else {
              renderError = `Font fetch failed: HTTP ${fontRes.status}`;
            }
          } catch (fontErr: any) {
            renderError = fontErr.message;
            console.error("[preview_writing] Error:", fontErr.message);
          }
        } else {
          renderError = "No font URL found for selected font";
        }

        return {
          content: [{ type: "text" as const, text: `Error: ${renderError}` }],
          isError: true,
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );
}
