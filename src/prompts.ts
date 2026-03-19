/**
 * MCP prompt registrations for the Handwrytten API.
 *
 * Prompts are pre-defined prompt templates that MCP clients can discover
 * and present to users. Each prompt returns a message array that guides
 * the AI assistant through a specific workflow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type PromptResult = {
  messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
};

function userMsg(text: string): PromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export function registerPrompts(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // SENDING NOTES
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "send-thank-you-note",
    "Send a handwritten thank-you note to someone",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
      message: z.string().optional().describe("Custom message to write (optional — AI will compose one if omitted)"),
    },
    ({ recipientName, recipientAddress, message }) => {
      const msg = message
        ? `Send a handwritten thank-you note to ${recipientName} at ${recipientAddress} with this message: "${message}". Browse cards and fonts first, then confirm before sending.`
        : `Send a handwritten thank-you note to ${recipientName} at ${recipientAddress}. Browse thank-you cards and fonts, compose a warm message, then confirm before sending.`;
      return userMsg(msg);
    }
  );

  server.prompt(
    "send-birthday-card",
    "Send a handwritten birthday card to someone",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
      message: z.string().optional().describe("Custom birthday message (optional)"),
    },
    ({ recipientName, recipientAddress, message }) => {
      const msg = message
        ? `Send a handwritten birthday card to ${recipientName} at ${recipientAddress} with this message: "${message}". Browse birthday cards and fonts first, then confirm before sending.`
        : `Send a handwritten birthday card to ${recipientName} at ${recipientAddress}. Browse birthday cards and fonts, compose a personal birthday message, then confirm before sending.`;
      return userMsg(msg);
    }
  );

  server.prompt(
    "send-holiday-card",
    "Send a handwritten holiday card to someone",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
    },
    ({ recipientName, recipientAddress }) =>
      userMsg(`Send a handwritten holiday card to ${recipientName} at ${recipientAddress}. Browse holiday cards and fonts, compose a festive message, then confirm before sending.`)
  );

  server.prompt(
    "send-bulk-notes",
    "Send handwritten notes to multiple recipients",
    {
      description: z.string().describe("Describe the recipients and purpose (e.g. 'thank-you notes to all clients in Q4')"),
    },
    ({ description }) =>
      userMsg(`I need to send bulk handwritten notes: ${description}. Help me pick a card and font, compose a message template, and then send to all recipients. Use the basket workflow for multiple orders.`)
  );

  server.prompt(
    "send-note-with-gift-card",
    "Send a handwritten note with a gift card enclosed",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
      giftCardAmount: z.string().optional().describe("Gift card dollar amount (e.g. '$25')"),
    },
    ({ recipientName, recipientAddress, giftCardAmount }) =>
      userMsg(`Send a handwritten note to ${recipientName} at ${recipientAddress} with a${giftCardAmount ? ` ${giftCardAmount}` : ""} gift card enclosed. Browse available cards, fonts, and gift card options, compose a message, then confirm before sending.`)
  );

  server.prompt(
    "send-note-with-insert",
    "Send a handwritten note with a marketing insert (business card, flyer, brochure)",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
    },
    ({ recipientName, recipientAddress }) =>
      userMsg(`Send a handwritten note to ${recipientName} at ${recipientAddress} and include a marketing insert in the envelope. Show me available inserts, browse cards and fonts, compose a message, then confirm before sending.`)
  );

  server.prompt(
    "schedule-future-send",
    "Schedule a handwritten card to be sent on a specific date",
    {
      recipientName: z.string().describe("Recipient's full name"),
      recipientAddress: z.string().describe("Recipient's mailing address"),
      sendDate: z.string().describe("Date to send the card (YYYY-MM-DD)"),
    },
    ({ recipientName, recipientAddress, sendDate }) =>
      userMsg(`Schedule a handwritten card to be sent to ${recipientName} at ${recipientAddress} on ${sendDate}. Browse cards and fonts, compose a message, then confirm before scheduling.`)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSING
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "browse-cards",
    "Browse available card designs and stationery templates",
    {
      category: z.string().optional().describe("Card category to filter by (e.g. 'Birthday', 'Thank You', 'Holiday')"),
    },
    ({ category }) =>
      userMsg(category
        ? `Show me available ${category} cards. Use the card browser to display them visually.`
        : `Show me all available card designs. Use the card browser so I can see them visually and pick one.`)
  );

  server.prompt(
    "browse-fonts",
    "Browse available handwriting styles",
    () => userMsg("Show me all available handwriting font styles so I can pick one for my card.")
  );

  server.prompt(
    "browse-card-categories",
    "See all card categories (Birthday, Thank You, Holiday, etc.)",
    () => userMsg("List all available card categories so I can browse by type.")
  );

  server.prompt(
    "get-card-details",
    "Get full details about a specific card template",
    {
      cardId: z.string().describe("Card ID to look up"),
    },
    ({ cardId }) => userMsg(`Show me the full details for card ID ${cardId}, including images, pricing, and dimensions.`)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDRESS BOOK
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "list-my-recipients",
    "View all saved recipient addresses in your address book",
    () => userMsg("Show me all saved recipient addresses in my address book.")
  );

  server.prompt(
    "add-recipient",
    "Save a new recipient address to your address book",
    {
      name: z.string().describe("Recipient's full name"),
      address: z.string().describe("Full mailing address"),
    },
    ({ name, address }) => userMsg(`Save this recipient to my address book: ${name}, ${address}`)
  );

  server.prompt(
    "update-recipient",
    "Update an existing recipient's address",
    {
      name: z.string().describe("Recipient's name to find and update"),
      newAddress: z.string().describe("Updated mailing address"),
    },
    ({ name, newAddress }) => userMsg(`Update the address for ${name} in my address book to: ${newAddress}`)
  );

  server.prompt(
    "delete-recipient",
    "Remove a recipient from your address book",
    {
      name: z.string().describe("Recipient's name to remove"),
    },
    ({ name }) => userMsg(`Delete ${name} from my recipient address book.`)
  );

  server.prompt(
    "list-my-senders",
    "View all saved sender (return) addresses",
    () => userMsg("Show me all saved sender / return addresses in my address book.")
  );

  server.prompt(
    "add-sender",
    "Save a new sender (return) address",
    {
      name: z.string().describe("Sender's full name or company"),
      address: z.string().describe("Full return address"),
    },
    ({ name, address }) => userMsg(`Save this sender/return address to my address book: ${name}, ${address}`)
  );

  server.prompt(
    "delete-sender",
    "Remove a sender address from your address book",
    {
      name: z.string().describe("Sender name to remove"),
    },
    ({ name }) => userMsg(`Delete the sender address for ${name} from my address book.`)
  );

  server.prompt(
    "list-countries",
    "See all countries that Handwrytten can mail to",
    () => userMsg("What countries can Handwrytten send cards to?")
  );

  server.prompt(
    "list-states",
    "List states or provinces for a country",
    {
      country: z.string().optional().describe("Country code (default: US)"),
    },
    ({ country }) => userMsg(`List all states/provinces for ${country || "the United States"}.`)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "create-custom-card",
    "Design a custom card with your own images, logos, and text",
    {
      description: z.string().describe("Describe what you want on the card (e.g. 'company logo on front, tagline on back')"),
    },
    ({ description }) =>
      userMsg(`Help me create a custom card: ${description}. Walk me through the steps — pick dimensions, upload images, set up text zones, and create the card.`)
  );

  server.prompt(
    "upload-custom-image",
    "Upload an image (logo, photo) for use on a custom card",
    {
      imageUrl: z.string().describe("Public URL of the image to upload (JPEG, PNG, or GIF)"),
    },
    ({ imageUrl }) => userMsg(`Upload this image for use on a custom card: ${imageUrl}`)
  );

  server.prompt(
    "list-custom-card-sizes",
    "See available custom card dimensions (flat/folded, portrait/landscape)",
    () => userMsg("What custom card sizes and formats are available? Show me the dimensions for flat and folded cards in both portrait and landscape.")
  );

  server.prompt(
    "list-my-custom-images",
    "View images you've uploaded for custom cards",
    () => userMsg("Show me all images I've uploaded for custom card designs.")
  );

  server.prompt(
    "list-my-custom-cards",
    "View your custom card designs",
    {
      cardId: z.string().optional().describe("Specific custom card ID to view details for"),
    },
    ({ cardId }) =>
      userMsg(cardId
        ? `Show me the details for my custom card ID ${cardId}.`
        : "Show me all my custom card designs.")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // QR CODES
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "create-qr-code",
    "Create a QR code to put on a custom card",
    {
      url: z.string().describe("URL the QR code should link to"),
    },
    ({ url }) => userMsg(`Create a QR code that links to ${url}. Show me available frames/styles, then create it.`)
  );

  server.prompt(
    "list-my-qr-codes",
    "View your saved QR codes",
    () => userMsg("Show me all my saved QR codes.")
  );

  server.prompt(
    "browse-qr-code-frames",
    "Browse decorative frame styles for QR codes",
    () => userMsg("Show me the available decorative frame styles for QR codes.")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // GIFT CARDS & INSERTS
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "browse-gift-cards",
    "Browse gift cards that can be enclosed with a handwritten note",
    () => userMsg("What gift cards are available to include with handwritten notes? Show me the options and denominations.")
  );

  server.prompt(
    "browse-inserts",
    "Browse physical inserts (business cards, flyers, brochures) to include in envelopes",
    () => userMsg("What inserts (business cards, flyers, brochures) can I include in the envelope with my cards?")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERS & TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "check-order-status",
    "Check the status of a specific order",
    {
      orderId: z.string().describe("Order ID to look up"),
    },
    ({ orderId }) => userMsg(`What's the status of order #${orderId}? Show me the details and tracking info.`)
  );

  server.prompt(
    "list-recent-orders",
    "View your recent order history",
    () => userMsg("Show me my recent orders with their status.")
  );

  server.prompt(
    "list-past-baskets",
    "View previously submitted basket batches",
    () => userMsg("Show me my previously submitted order baskets.")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BASKET
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "view-basket",
    "View current basket contents with the interactive basket summary",
    () => userMsg("Show me what's currently in my basket using the visual basket summary.")
  );

  server.prompt(
    "add-to-basket",
    "Add an order to the basket for batch sending",
    {
      description: z.string().describe("Describe the order to add (card, message, recipient)"),
    },
    ({ description }) => userMsg(`Add this to my basket: ${description}. Browse cards and fonts if needed, then add it.`)
  );

  server.prompt(
    "send-basket",
    "Submit all orders in the basket for fulfillment",
    () => userMsg("Show me my basket contents and then submit all orders for sending. Confirm the total cost before submitting.")
  );

  server.prompt(
    "clear-basket",
    "Remove all items from the basket",
    () => userMsg("Clear everything from my basket.")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "check-account-balance",
    "Check your Handwrytten account credits balance",
    () => userMsg("What's my current Handwrytten account balance and credits?")
  );

  server.prompt(
    "list-my-signatures",
    "View your saved handwriting signature images",
    () => userMsg("Show me my saved handwriting signatures.")
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PROSPECTING
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "prospect-by-zip",
    "Find mailing targets by ZIP code and radius for outreach campaigns",
    {
      zipCode: z.string().describe("Center ZIP code"),
      radiusMiles: z.string().optional().describe("Radius in miles (default: 5)"),
    },
    ({ zipCode, radiusMiles }) =>
      userMsg(`How many mailing targets are available within ${radiusMiles || "5"} miles of ZIP code ${zipCode}? Calculate the target count for a prospecting campaign.`)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PREVIEWS
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "preview-message",
    "Preview how a message will look in a specific handwriting font",
    {
      message: z.string().describe("The message text to preview"),
      font: z.string().optional().describe("Font name or ID (optional — will show default)"),
    },
    ({ message, font }) =>
      userMsg(font
        ? `Preview how this message looks in the "${font}" handwriting font: "${message}"`
        : `Preview how this message looks in handwriting: "${message}"`)
  );
}
