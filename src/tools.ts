/**
 * MCP tool registrations for the Handwrytten API.
 *
 * All 55 tools are registered via `registerTools()` which accepts a
 * McpServer instance and a Handwrytten client. This allows per-session
 * clients in HTTP mode (OAuth) and a single shared client in stdio mode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Handwrytten } from "handwrytten";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a successful tool result. */
function ok(content: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(content, null, 2) }],
  };
}

/** Wrap an error tool result. */
function err(message: string): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, client: Handwrytten): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "get_user",
    "[READ-ONLY] Get the authenticated user's Handwrytten profile. Returns: id, name, email, credits balance, test_mode flag, subscription status.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const user = await client.auth.getUser();
        return ok(user);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_signatures",
    "[READ-ONLY] List the user's saved handwriting signature images. Returns array of {id, name, preview_url}. Use the id as signatureId when placing orders via send_order or basket_add_order.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const sigs = await client.auth.listSignatures();
        return ok(sigs);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_cards",
    "[READ-ONLY] Browse available card/stationery templates. Returns paginated array of {id, title, imageUrl, category, categoryId, orientation}. " +
      "Use categoryId=27 for 'My Custom Cards'. Call list_card_categories first to discover all category IDs. " +
      "Default: 20 per page, max 50.",
    {
      categoryId: z
        .number()
        .optional()
        .describe(
          "Filter by category ID. Use 27 for 'My Custom Cards'. " +
            "Call list_card_categories to see all options."
        ),
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category name (case-insensitive partial match, e.g. 'thank you', 'birthday', 'custom')"
        ),
      page: z
        .number()
        .optional()
        .describe("Page number (default: 1)"),
      perPage: z
        .number()
        .optional()
        .describe("Results per page (default: 20, max: 50)"),
      query: z
        .string()
        .optional()
        .describe("Search card names (case-insensitive partial match)"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ categoryId, category, page, perPage, query }) => {
      try {
        // Fetch all cards and categories in parallel
        const [allCards, categoriesRaw] = await Promise.all([
          client.cards.list(),
          (client as any)._http.get("categories/list") as Promise<any>,
        ]);

        // Build category lookup
        const categories: Record<number, string> = {};
        const catList = (categoriesRaw as any)?.categories ?? [];
        for (const cat of catList) {
          if (cat.id != null && cat.name) categories[cat.id] = cat.name;
        }

        // Resolve category name to ID if provided
        let filterCatId = categoryId;
        if (!filterCatId && category) {
          const lower = category.toLowerCase();
          const match = catList.find(
            (c: any) => c.name && c.name.toLowerCase().includes(lower)
          );
          if (match) filterCatId = match.id;
        }

        // Filter
        let filtered = allCards;
        if (filterCatId != null) {
          filtered = filtered.filter(
            (c) => (c.raw as any).category_id === filterCatId
          );
        }
        if (query) {
          const q = query.toLowerCase();
          filtered = filtered.filter(
            (c) =>
              (c.title && c.title.toLowerCase().includes(q)) ||
              ((c.raw as any).name && String((c.raw as any).name).toLowerCase().includes(q))
          );
        }

        // Paginate
        const pg = Math.max(1, page ?? 1);
        const pp = Math.min(50, Math.max(1, perPage ?? 20));
        const total = filtered.length;
        const totalPages = Math.ceil(total / pp);
        const start = (pg - 1) * pp;
        const pageItems = filtered.slice(start, start + pp);

        // Return slim card objects to stay under size limits
        const results = pageItems.map((c) => ({
          id: c.id,
          title: c.title || (c.raw as any).name,
          category: categories[(c.raw as any).category_id] ?? null,
          categoryId: (c.raw as any).category_id,
          imageUrl: c.imageUrl || c.cover || null,
          orientation: (c.raw as any).orientation,
          closedWidth: (c.raw as any).closed_width,
          closedHeight: (c.raw as any).closed_height,
        }));

        return ok({
          cards: results,
          pagination: { page: pg, perPage: pp, total, totalPages },
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "get_card",
    "[READ-ONLY] Get full details of a specific card template. Returns: id, name, cover image, orientation (P=portrait, L=landscape, F=flat), dimensions, pricing, detailed_images (front/inside/back).",
    { cardId: z.string().describe("Card template ID (numeric string, from list_cards results)") },
    { readOnlyHint: true, destructiveHint: false },
    async ({ cardId }) => {
      try {
        const card = await client.cards.get(cardId);
        return ok(card);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_card_categories",
    "[READ-ONLY] List all card categories (e.g. 'Thank You', 'Birthday', 'Holiday', 'My Custom Cards'). Returns array of {id, name, slug}. Pass the returned id as categoryId to list_cards to filter.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const data = await (client as any)._http.get("categories/list") as any;
        const categories = (data?.categories ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
        }));
        return ok(categories);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FONTS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_fonts",
    "[READ-ONLY] List available handwriting font styles for the message body of orders. Returns array of {id, name, label, previewUrl}. Pass the id or label as the 'font' parameter to send_order or basket_add_order. These are robot-handwritten fonts, not printed fonts.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const fonts = await client.fonts.list();
        return ok(fonts);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_customizer_fonts",
    "[READ-ONLY] List printed/typeset fonts for custom card text zones (header, footer, main, back). Returns array of {id, name, label}. These are DIFFERENT from handwriting fonts — use these only with create_custom_card zone parameters (headerFontId, mainFontId, footerFontId, backFontId).",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const fonts = await client.fonts.listForCustomizer();
        return ok(fonts);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // GIFT CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_gift_cards",
    "[READ-ONLY] List available physical gift card products and their price denominations. Returns array of {id, name, denominations: [{id, price}]}. Pass a denomination id as denominationId to send_order or basket_add_order to include a gift card in the envelope.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const gcs = await client.giftCards.list();
        return ok(gcs);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // INSERTS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_inserts",
    "[READ-ONLY] List available card inserts (business cards, flyers, brochures) that can be physically included in the envelope with a card. Returns array of {id, name, description, image}. Pass the id as insertId to send_order or basket_add_order.",
    {
      includeHistorical: z
        .boolean()
        .optional()
        .describe("If true, also return discontinued inserts"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ includeHistorical }) => {
      try {
        const inserts = await client.inserts.list({ includeHistorical });
        return ok(inserts);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // QR CODES
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_qr_codes",
    "[READ-ONLY] List QR codes created on this account. Returns array of {id, name, url, scan_count}. QR codes can be placed on custom cards via create_custom_card.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const qrs = await client.qrCodes.list();
        return ok(qrs);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "create_qr_code",
    "[CREATES DATA] Create a new QR code for use on custom cards. Returns the created QR code with its id. Use the id with create_custom_card's qrCodeId parameter.",
    {
      name: z.string().describe("Display name for the QR code (for your reference only, not printed)"),
      url: z.string().describe("The URL users will be directed to when they scan the QR code"),
      iconId: z.number().optional().describe("Optional icon ID"),
      webhookUrl: z.string().optional().describe("Webhook URL to receive POST notifications when the QR code is scanned"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const qr = await client.qrCodes.create(params);
        return ok(qr);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "delete_qr_code",
    "[DESTRUCTIVE — permanently deletes QR code] Permanently delete a QR code. This cannot be undone. Any custom cards using this QR code will no longer display it.",
    { qrCodeId: z.number().describe("ID of the QR code to delete") },
    { destructiveHint: true },
    async ({ qrCodeId }) => {
      try {
        const result = await client.qrCodes.delete(qrCodeId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_qr_code_frames",
    "[READ-ONLY] List decorative border frames available for QR codes on custom cards. Returns array of {id, name, preview_url}. Pass the id as qrCodeFrameId to create_custom_card.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const frames = await client.qrCodes.frames();
        return ok(frames);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDRESS BOOK
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_recipients",
    "[READ-ONLY] List saved recipient (TO) addresses from the address book. Returns array of {id, firstName, lastName, street1, city, state, zip, company, birthday, anniversary}. Pass the id as 'recipient' to send_order or in the addressIds array to basket_add_order.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const recipients = await client.addressBook.listRecipients();
        return ok(recipients);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "add_recipient",
    "[CREATES DATA] Save a new recipient (TO) address to the address book. Returns {addressId}. You must save an address first before you can send a card to it — use the returned addressId as 'recipient' in send_order or in addressIds for basket_add_order.",
    {
      firstName: z.string().describe("First name"),
      lastName: z.string().describe("Last name"),
      street1: z.string().describe("Street address"),
      city: z.string().describe("City"),
      state: z.string().describe("Two-letter state/province code (e.g. 'CA', 'NY', 'TX')"),
      zip: z.string().describe("ZIP/postal code (e.g. '90210', '10001')"),
      street2: z.string().optional().describe("Address line 2"),
      company: z.string().optional().describe("Company name"),
      countryId: z.string().optional().describe("Two-letter country code (default: 'US'). Call list_countries for valid codes."),
      birthday: z.string().optional().describe("Recipient's birthday in YYYY-MM-DD format (for automated birthday cards)"),
      anniversary: z.string().optional().describe("Recipient's anniversary in YYYY-MM-DD format (for automated anniversary cards)"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const id = await client.addressBook.addRecipient(params);
        return ok({ addressId: id, message: "Recipient saved successfully" });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "update_recipient",
    "[MODIFIES DATA] Update an existing saved recipient address. Only pass the fields you want to change — omitted fields remain unchanged. Returns {addressId}.",
    {
      addressId: z.number().describe("ID of the address to update"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      street1: z.string().optional().describe("Street address"),
      city: z.string().optional().describe("City"),
      state: z.string().optional().describe("State/province code"),
      zip: z.string().optional().describe("ZIP/postal code"),
      street2: z.string().optional().describe("Address line 2"),
      company: z.string().optional().describe("Company name"),
      countryId: z.string().optional().describe("Country code"),
      birthday: z.string().optional().describe("Birthday (YYYY-MM-DD)"),
      anniversary: z.string().optional().describe("Anniversary (YYYY-MM-DD)"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const id = await client.addressBook.updateRecipient(params);
        return ok({ addressId: id, message: "Recipient updated successfully" });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "delete_recipient",
    "[DESTRUCTIVE — deletes address data] Permanently delete one or more recipient addresses from the address book. Provide either a single addressId OR an array of addressIds, not both. This cannot be undone.",
    {
      addressId: z.number().optional().describe("Single address ID to delete"),
      addressIds: z
        .array(z.number())
        .optional()
        .describe("Array of address IDs for batch delete"),
    },
    { destructiveHint: true },
    async (params) => {
      try {
        const result = await client.addressBook.deleteRecipient(params);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_senders",
    "[READ-ONLY] List saved sender (FROM / return) addresses from the address book. Returns array of {id, firstName, lastName, street1, city, state, zip, company, isDefault}. Pass the id as 'sender' to send_order or as returnAddressId to basket_add_order.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const senders = await client.addressBook.listSenders();
        return ok(senders);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "add_sender",
    "[CREATES DATA] Save a new sender (FROM / return) address to the address book. Returns {addressId}. Use the returned addressId as 'sender' in send_order or as returnAddressId in basket_add_order.",
    {
      firstName: z.string().describe("First name"),
      lastName: z.string().describe("Last name"),
      street1: z.string().describe("Street address"),
      city: z.string().describe("City"),
      state: z.string().describe("State/province code"),
      zip: z.string().describe("ZIP/postal code"),
      street2: z.string().optional().describe("Address line 2"),
      company: z.string().optional().describe("Company name"),
      countryId: z.string().optional().describe("Country code"),
      default: z.boolean().optional().describe("If true, this becomes the default return address used when no sender is specified"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const id = await client.addressBook.addSender(params);
        return ok({ addressId: id, message: "Sender saved successfully" });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "delete_sender",
    "[DESTRUCTIVE — deletes address data] Permanently delete one or more sender (return) addresses. Provide either a single addressId OR an array of addressIds, not both. This cannot be undone.",
    {
      addressId: z.number().optional().describe("Single address ID to delete"),
      addressIds: z
        .array(z.number())
        .optional()
        .describe("Array of address IDs for batch delete"),
    },
    { destructiveHint: true },
    async (params) => {
      try {
        const result = await client.addressBook.deleteSender(params);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_countries",
    "[READ-ONLY] List all countries Handwrytten can mail to. Returns array of {id, code, name}. Use the code as countryId when adding addresses.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const countries = await client.addressBook.countries();
        return ok(countries);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_states",
    "[READ-ONLY] List states/provinces for a given country. Returns array of {id, code, name}. Use the code as the 'state' parameter when adding addresses.",
    {
      countryCode: z
        .string()
        .optional()
        .describe("Two-letter country code (default: 'US'). Use list_countries to see valid codes."),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ countryCode }) => {
      try {
        const states = await client.addressBook.states(countryCode);
        return ok(states);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERS — The main event!
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "send_order",
    "[SENDS REAL MAIL — charges the user's account and mails a physical card] Always confirm card, message, recipient, and sender details with the user before calling. " +
      "Send a real handwritten note via Handwrytten. This is the primary tool — it places " +
      "an order that results in a physical card being written by a robot with a real pen " +
      "and mailed to the recipient. Use list_cards and list_fonts first to get valid IDs. " +
      "Recipients and senders must be saved address IDs (use add_recipient / add_sender first). " +
      "For bulk sends, pass an array of recipient IDs.",
    {
      cardId: z.string().describe("Card template ID (from list_cards). Must be a string, e.g. '1234'."),
      font: z.string().describe("Handwriting font ID or label (from list_fonts). e.g. '42' or 'Sarah'."),
      message: z.string().optional().describe("The handwritten message body. Character limit depends on the card size — typically 500-800 characters."),
      wishes: z.string().optional().describe("Closing text rendered below the message in the same handwriting (e.g. 'Best regards,\\nThe Team'). Use \\n for line breaks."),
      recipient: z
        .union([
          z.number().describe("Saved recipient address ID (from add_recipient or list_recipients)"),
          z.array(z.number().describe("Saved recipient address ID")),
        ])
        .describe("Saved recipient address ID (from add_recipient or list_recipients), or an array of IDs for bulk sends to multiple recipients."),
      sender: z
        .number()
        .optional()
        .describe("Saved sender (return) address ID (from add_sender or list_senders). If omitted, the account's default sender address is used."),
      denominationId: z
        .number()
        .optional()
        .describe("Gift card denomination ID (from list_gift_cards → denominations array). Includes a physical gift card in the envelope."),
      insertId: z
        .number()
        .optional()
        .describe("Insert ID (from list_inserts). Includes a physical insert (business card, flyer) in the envelope."),
      signatureId: z
        .number()
        .optional()
        .describe("Handwriting signature image ID (from list_signatures). Printed below the message."),
      dateSend: z
        .string()
        .optional()
        .describe("Schedule send date in YYYY-MM-DD format (e.g. '2025-12-25'). If omitted, the card is sent immediately."),
      clientMetadata: z
        .string()
        .optional()
        .describe("Your own reference string for tracking this order in your systems (not printed on the card)."),
    },
    { destructiveHint: true },
    async (params) => {
      try {
        const result = await client.orders.send(params as any);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "get_order",
    "[READ-ONLY] Get full details of a specific order including status, tracking info, card details, message, addresses, and pricing. Returns: id, status, tracking_link, card, message, address_from, address_to, price_structure, date_send, date_complete.",
    { orderId: z.string().describe("The order ID (numeric string, from send_order response or list_orders results)") },
    { readOnlyHint: true, destructiveHint: false },
    async ({ orderId }) => {
      try {
        const order = await client.orders.get(orderId);
        return ok(order);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_orders",
    "[READ-ONLY] List past orders with pagination. Returns paginated array of orders with id, status, card name, recipient, send date. Default: page 1.",
    {
      page: z.number().optional().describe("Page number, starting from 1 (default: 1)"),
      perPage: z.number().optional().describe("Number of orders per page (default: 20)"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async (params) => {
      try {
        const orders = await client.orders.list(params);
        return ok(orders);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_past_baskets",
    "[READ-ONLY] List previously submitted order baskets (groups of orders placed together). Returns paginated array of baskets with id, date, item count, total.",
    {
      page: z.number().optional().describe("Page number"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async (params) => {
      try {
        const baskets = await client.orders.listPastBaskets(params);
        return ok(baskets);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BASKET (advanced multi-step workflow)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "basket_add_order",
    "[CREATES DATA] Add an order to the basket (multi-step workflow). Use send_order instead for single-step sends. " +
      "Recipients and senders must be saved address IDs (use add_recipient / add_sender first).",
    {
      cardId: z.string().describe("Card template ID string (from list_cards). e.g. '1234'."),
      font: z.string().optional().describe("Handwriting font ID or label (from list_fonts). e.g. '42' or 'Sarah'."),
      message: z.string().optional().describe("The handwritten message body."),
      wishes: z.string().optional().describe("Closing text below the message (e.g. 'Best,\\nThe Team')."),
      addressIds: z
        .array(z.number())
        .describe("Array of saved recipient address IDs (from add_recipient or list_recipients). One order is created per address."),
      returnAddressId: z.number().optional().describe("Saved sender (return) address ID (from add_sender or list_senders). If omitted, uses account default."),
      denominationId: z.number().optional().describe("Gift card denomination ID (from list_gift_cards → denominations)."),
      insertId: z.number().optional().describe("Insert ID (from list_inserts) to include in the envelope."),
      signatureId: z.number().optional().describe("Signature image ID (from list_signatures)."),
      dateSend: z.string().optional().describe("Schedule send date in YYYY-MM-DD format. Omit to send when basket is submitted."),
      clientMetadata: z.string().optional().describe("Your own reference/tracking string (not printed on card)."),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const result = await client.basket.addOrder(params as any);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "basket_send",
    "[SENDS REAL MAIL — charges the user's account and mails ALL orders in the basket] Always confirm with the user before calling. Submits every order in the basket for physical fulfillment. Cards will be handwritten and mailed. This charges the user's payment method. Returns: basket_id, items, price_structure.",
    {
      couponCode: z.string().optional().describe("Coupon/promo code to apply for a discount (validated server-side)."),
      testMode: z.boolean().optional().describe("If true, orders are validated but NOT actually sent or charged. Use for testing."),
    },
    { destructiveHint: true },
    async (params) => {
      try {
        const result = await client.basket.send(params);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "basket_list",
    "[READ-ONLY] List all orders currently in the basket (not yet submitted). Returns array of basket items with card, message, addresses, pricing. Use View-Basket app tool for a richer visual display.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const items = await client.basket.list();
        return ok(items);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "basket_count",
    "[READ-ONLY] Get the count of orders currently in the basket. Returns {count: number}. Quick check without fetching full item details.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      try {
        const count = await client.basket.count();
        return ok({ count });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "basket_remove",
    "[DESTRUCTIVE — removes order from basket] Remove a single order from the basket. The order is discarded and not recoverable. Confirm with the user before calling.",
    { basketId: z.number().describe("Basket item ID to remove (from basket_list results)") },
    { destructiveHint: true },
    async ({ basketId }) => {
      try {
        const result = await client.basket.remove(basketId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "basket_clear",
    "[DESTRUCTIVE — removes ALL orders from basket] Permanently removes every order from the basket. None of the orders will be sent. Always confirm with the user before calling — this cannot be undone.",
    {},
    { destructiveHint: true },
    async () => {
      try {
        const result = await client.basket.clear();
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_custom_card_dimensions",
    "[READ-ONLY] List available card sizes/formats for custom card designs. Returns array of {id, format (flat/folded), orientation (portrait/landscape), width, height}. Pass the id as dimensionId to create_custom_card.",
    {
      format: z
        .string()
        .optional()
        .describe("Filter by format: 'flat' or 'folded'"),
      orientation: z
        .string()
        .optional()
        .describe("Filter by orientation: 'portrait' or 'landscape'"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async (params) => {
      try {
        const dims = await client.customCards.dimensions(params);
        return ok(dims);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "upload_custom_image",
    "[CREATES DATA] Upload an image from a URL for use in custom card designs. The image is downloaded and stored by Handwrytten. Returns {id, url, width, height}. Use imageType='cover' for full-bleed card faces, imageType='logo' for logos on the writing side. Pass the returned id to create_custom_card (as coverId, headerLogoId, mainLogoId, footerLogoId, or backLogoId).",
    {
      url: z.string().describe("Publicly accessible URL of the image (JPEG/PNG/GIF)"),
      imageType: z
        .enum(["cover", "logo"])
        .describe("'cover' for full-bleed front/back, 'logo' for writing-side logo"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const img = await client.customCards.uploadImage(params);
        return ok(img);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "check_custom_image",
    "[READ-ONLY] Validate that an uploaded image meets print quality requirements (DPI, dimensions) for a specific card size. Returns {valid: boolean, issues: string[]}. Call this after upload_custom_image to verify before using in a design.",
    {
      imageId: z.number().describe("Image ID to check"),
      cardId: z.number().optional().describe("Optional card ID for dimension-specific checks"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ imageId, cardId }) => {
      try {
        const result = await client.customCards.checkImage(imageId, cardId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "list_custom_images",
    "[READ-ONLY] List all images previously uploaded to this account for custom card designs. Returns array of {id, url, imageType, width, height}. Filter by type: 'cover' (full-bleed faces) or 'logo' (writing-side logos).",
    {
      imageType: z
        .enum(["cover", "logo"])
        .optional()
        .describe("Filter by image type"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ imageType }) => {
      try {
        const images = await client.customCards.listImages(imageType);
        return ok(images);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "delete_custom_image",
    "[DESTRUCTIVE — permanently deletes uploaded image] Permanently delete an uploaded custom image. Any custom card designs still referencing this image may display incorrectly. This cannot be undone.",
    { imageId: z.number().describe("Image ID to delete") },
    { destructiveHint: true },
    async ({ imageId }) => {
      try {
        const result = await client.customCards.deleteImage(imageId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "create_custom_card",
    "[CREATES DATA] Create a custom card design from uploaded images and text zones.\n\n" +
      "IMPORTANT — Each writing-side zone (header/main/footer) and the back side has a 'type' field:\n" +
      "  type='logo' → displays a logo image (must also provide the matching logoId + sizePercent)\n" +
      "  type='text' → displays printed text (provide text + fontId)\n" +
      "  If you set a logoId without setting the type to 'logo', the logo will NOT render.\n\n" +
      "FLAT CARDS (dimension_id=1 or 2) — writing-side logo example:\n" +
      "  headerLogoId=IMG_ID, headerLogoSizePercent=80, headerType='logo'\n\n" +
      "FOLDED CARDS (dimension_id=3) — back/writing side is REQUIRED:\n" +
      "  backLogoId=IMG_ID, backSizePercent=20, backType='logo', backVerticalAlign='center'\n\n" +
      "Upload images first with upload_custom_image:\n" +
      "  imageType='cover' → full-bleed front covers (use with coverId)\n" +
      "  imageType='logo'  → logos for the writing side (use with headerLogoId/mainLogoId/footerLogoId/backLogoId)",
    {
      name: z.string().describe("Name for the custom card"),
      dimensionId: z.string().describe("Dimension ID (from list_custom_card_dimensions)"),
      coverId: z.number().optional().describe("Front cover image ID (from upload_custom_image with imageType='cover')"),

      // --- Writing-side header zone ---
      headerType: z
        .enum(["logo", "text"])
        .optional()
        .describe("Header zone content type. MUST be 'logo' when using headerLogoId, or 'text' for printed text."),
      headerText: z.string().optional().describe("Header zone printed text (when headerType='text')"),
      headerFontId: z.string().optional().describe("Header font ID (from list_customizer_fonts)"),
      headerLogoId: z
        .number()
        .optional()
        .describe("Header zone logo image ID. MUST set headerType='logo' for this to render."),
      headerLogoSizePercent: z.number().optional().describe("Header logo size (1-100)"),

      // --- Writing-side main zone ---
      mainType: z
        .enum(["logo", "text"])
        .optional()
        .describe("Main zone content type. MUST be 'logo' when using mainLogoId, or 'text' for printed text."),
      mainText: z.string().optional().describe("Main zone printed text (when mainType='text')"),
      mainFontId: z.string().optional().describe("Main zone font ID"),
      mainLogoId: z
        .number()
        .optional()
        .describe("Main zone logo image ID. MUST set mainType='logo' for this to render."),
      mainLogoSizePercent: z.number().optional().describe("Main logo size (1-100)"),

      // --- Writing-side footer zone ---
      footerType: z
        .enum(["logo", "text"])
        .optional()
        .describe("Footer zone content type. MUST be 'logo' when using footerLogoId, or 'text' for printed text."),
      footerText: z.string().optional().describe("Footer zone printed text (when footerType='text')"),
      footerFontId: z.string().optional().describe("Footer zone font ID"),
      footerLogoId: z
        .number()
        .optional()
        .describe("Footer zone logo image ID. MUST set footerType='logo' for this to render."),
      footerLogoSizePercent: z.number().optional().describe("Footer logo size (1-100)"),

      // --- Back side (REQUIRED for folded cards, optional for flat) ---
      backLogoId: z
        .number()
        .optional()
        .describe(
          "Image ID for the back/writing side (from upload_custom_image). " +
            "REQUIRED for folded cards (dimension_id=3). Must be paired with backType."
        ),
      backType: z
        .enum(["logo", "cover"])
        .optional()
        .describe(
          "Type of back side content. REQUIRED when backLogoId is provided. " +
            "'logo' = sized/aligned logo image; 'cover' = full-bleed cover image."
        ),
      backSizePercent: z
        .number()
        .optional()
        .describe("Back logo size as percentage (1-100). Only used when backType='logo'."),
      backVerticalAlign: z
        .enum(["top", "center", "bottom"])
        .optional()
        .describe("Vertical alignment of back logo. Only used when backType='logo'."),
      backCoverId: z.number().optional().describe("Back cover image ID (alternative to backLogoId for full-bleed backs)"),
      backText: z.string().optional().describe("Back side printed text"),
      backFontId: z.number().optional().describe("Back side font ID"),

      // --- QR code ---
      qrCodeId: z.number().optional().describe("QR code ID to attach"),
      qrCodeLocation: z
        .enum(["header", "footer", "main"])
        .optional()
        .describe("Where to place the QR code"),
      qrCodeSizePercent: z.number().optional().describe("QR code size (1-100)"),
      qrCodeAlign: z.string().optional().describe("QR code alignment (left, center, right)"),
      qrCodeFrameId: z.number().optional().describe("QR code frame ID"),
    },
    { destructiveHint: false },
    async (params) => {
      try {
        const card = await client.customCards.create(params as any);
        return ok(card);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "get_custom_card",
    "[READ-ONLY] Get full details of a custom card design including dimensions, cover images, text zones, logos, and QR code placement. Returns all configuration needed to understand or duplicate the design.",
    { cardId: z.number().describe("Custom card ID") },
    { readOnlyHint: true, destructiveHint: false },
    async ({ cardId }) => {
      try {
        const card = await client.customCards.get(cardId);
        return ok(card);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  server.tool(
    "delete_custom_card",
    "[DESTRUCTIVE — permanently deletes custom card design] Permanently delete a custom card design. Orders already placed with this card are unaffected, but new orders cannot use it. This cannot be undone.",
    { cardId: z.number().describe("Custom card ID to delete") },
    { destructiveHint: true },
    async ({ cardId }) => {
      try {
        const result = await client.customCards.delete(cardId);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PROSPECTING
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "calculate_targets",
    "[READ-ONLY] Estimate the number of prospecting targets (businesses/residents) in a geographic area. Returns target counts by category and estimated mailing costs. Use this to preview before creating a prospecting campaign.",
    {
      zipCode: z.string().describe("Center ZIP code for the search area (US only, e.g. '90210')"),
      radiusMiles: z
        .number()
        .optional()
        .describe("Search radius in miles from the center ZIP code (e.g. 5, 10, 25)"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async (params) => {
      try {
        const result = await client.prospecting.calculateTargets(params);
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );
}
