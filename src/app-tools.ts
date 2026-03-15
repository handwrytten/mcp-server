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
import fs from "node:fs/promises";
import path from "node:path";

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
  const writingPreviewUri = "ui://handwrytten/writing-preview.html";

  // ═══════════════════════════════════════════════════════════════════════════
  // CARD PREVIEW APP
  // ═══════════════════════════════════════════════════════════════════════════

  registerAppTool(
    server,
    "preview_cards",
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
            `cards/list?with_detailed_images=true&with_images=true&pagination=1&page=1&limit=20` +
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

        const res = await fetch(url);
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

  // Tool for the writing preview app to fetch font files (bypasses sandbox CSP)
  server.tool(
    "get_font_file",
    "Fetch a font file and return it as base64. Used by the writing preview app.",
    {
      url: z.string().describe("Font file URL to fetch"),
    },
    async ({ url }) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${res.status}` }],
            isError: true,
          };
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ base64: buffer.toString("base64") }) }],
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
  // WRITING PREVIEW APP
  // ═══════════════════════════════════════════════════════════════════════════

  registerAppTool(
    server,
    "preview_writing",
    {
      title: "Preview Writing",
      description:
        "Preview how a handwritten message will look on a card with the selected font. " +
        "Shows a live rendering of the text in the chosen handwriting style.",
      inputSchema: {
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
      _meta: {
        ui: {
          resourceUri: writingPreviewUri,
          csp: {
            "font-src": [
              "https://*.handwrytten.com",
              "https://*.amazonaws.com",
              "https://handwrytten.com",
              "data:",
            ],
            "connect-src": [
              "https://*.handwrytten.com",
              "https://*.amazonaws.com",
              "https://handwrytten.com",
            ],
          },
        },
      },
    },
    async ({ message, fontId, cardId, wishes, inkColor }): Promise<CallToolResult> => {
      try {
        // Fetch fonts and optionally card details
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
          previewUrl: f.previewUrl,
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

        // Pre-fetch the selected font file as base64 (sandbox CSP blocks fetch)
        let fontBase64: string | null = null;
        if (selectedFont.mainFontUrl) {
          try {
            const fontRes = await fetch(selectedFont.mainFontUrl);
            if (fontRes.ok) {
              const buf = Buffer.from(await fontRes.arrayBuffer());
              fontBase64 = buf.toString("base64");
            }
          } catch (e: any) {
            console.error("Failed to fetch font:", selectedFont.mainFontUrl, e.message);
          }
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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message,
                wishes: wishes || "",
                inkColor: inkColor || "#0040ac",
                card,
                selectedFont,
                fontBase64,
                fonts,
              }),
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

  // Tool for writing preview app to fetch font data when user switches fonts
  server.tool(
    "get_writing_data",
    "Get font metadata for writing preview. Used by the writing preview app.",
    {
      fontId: z.string().describe("Font ID or label"),
      cardId: z.string().optional().describe("Card ID for dimensions"),
    },
    async ({ fontId, cardId }) => {
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

        let selectedFont = fonts[0];
        const match = fonts.find(
          (f: any) =>
            String(f.id) === String(fontId) ||
            f.label?.toLowerCase() === fontId.toLowerCase() ||
            f.name?.toLowerCase() === fontId.toLowerCase()
        );
        if (match) selectedFont = match;

        // Pre-fetch the selected font file as base64
        let fontBase64: string | null = null;
        if (selectedFont.mainFontUrl) {
          try {
            const fontRes = await fetch(selectedFont.mainFontUrl);
            if (fontRes.ok) {
              const buf = Buffer.from(await fontRes.arrayBuffer());
              fontBase64 = buf.toString("base64");
            }
          } catch (e: any) {
            console.error("Failed to fetch font:", selectedFont.mainFontUrl, e.message);
          }
        }

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

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ selectedFont, fontBase64, card }),
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

  // Writing preview resource
  registerAppResource(
    server,
    writingPreviewUri,
    writingPreviewUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "writing-preview.html"),
        "utf-8"
      );
      return {
        contents: [
          {
            uri: writingPreviewUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    }
  );
}
