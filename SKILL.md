---
name: Handwrytten
description: Send real handwritten notes through robots with real pens — physical cards mailed to recipients
metadata: {"openclaw":{"requires":{"env":["HANDWRYTTEN_API_KEY"],"bins":["node"]},"primaryEnv":"HANDWRYTTEN_API_KEY","emoji":"envelope","homepage":"https://github.com/handwrytten/handwrytten-mcp-server","install":[{"type":"node","package":"@handwrytten/mcp-server"}]}}
---

# Handwrytten — Send Real Handwritten Notes

You have access to the Handwrytten API, which sends real handwritten notes using robots with actual pens writing on physical cards that get mailed to recipients.

## Typical Workflow

1. **Browse options first**: Call `list_cards` and `list_fonts` to discover available card templates and handwriting styles before sending.
2. **Review the note**: Show the card, font, message, saved recipient and sender IDs and payment implications. Use `preview_writing` when a handwriting preview is requested. Confirm before submitting an order.
3. **Send the confirmed note**: Call `send_order` with `confirmSend=true` and saved address IDs. It requires an empty basket. Use `wishes` for the closing text. Report the actual backend result; an error does not establish whether a submission occurred.

## Key Tools

### Sending Notes (Core)
- `send_order` — Submit a confirmed handwritten card order using one saved recipient ID or an array of saved IDs. All recipients receive the same message. Requires an empty basket and `confirmSend=true`; can charge the account and initiate physical mailing.
- `get_order` / `list_orders` — Check order status and history.

### Browsing Cards & Fonts
- `list_cards` — Browse card templates. Supports filtering by category name/ID and search by name. Use `list_card_categories` to discover category IDs. Results are paginated (default 20/page).
- `list_fonts` — Browse handwriting styles for the order message.
- `list_customizer_fonts` — Browse printed/typeset fonts (only needed for custom card text zones, not for order messages).

### Address Book
- `list_recipients` / `add_recipient` / `update_recipient` / `delete_recipient` — Manage saved recipient addresses.
- `list_senders` / `add_sender` / `delete_sender` — Manage saved return addresses.
- `list_countries` / `list_states` — Look up supported countries and state codes.

### Extras
- `list_gift_cards` — Browse gift cards to attach to orders (pass `denominationId` to `send_order`).
- `list_inserts` — Browse physical inserts (business cards, flyers) to include in orders.
- `list_signatures` — List saved handwriting signatures.

### Custom Cards (Advanced)
For creating custom card designs with logos, images, and printed text:
1. `list_custom_card_dimensions` — Get available card formats (flat/folded, portrait/landscape).
2. `upload_custom_image` — Upload a cover or logo image (JPEG/PNG/GIF via public URL).
3. `create_custom_card` — Build the card design with zones (header, main, footer, back). Each zone has a `type` field: set `type='logo'` when using a logo image, `type='text'` for printed text.
4. Use the resulting card ID with `send_order` to mail it.

### QR Codes
- `create_qr_code` / `list_qr_codes` / `delete_qr_code` — Manage QR codes that can be placed on custom cards.
- `list_qr_code_frames` — Browse decorative frames for QR codes.

### Basket (Multi-Step Orders)
For building up multiple orders before submitting them together:
- `basket_add_order` → `basket_list` → `basket_send`
- Use `send_order` instead for simple single-step sends.

## Important Guidelines

- **Always browse before sending.** Call `list_cards` and `list_fonts` before `send_order` so you use valid IDs.
- **Confirm before ordering.** Sending a note costs money and results in a physical card being mailed. Always confirm the details with the user before calling `send_order`.
- **Addresses require:** firstName, lastName, street1, city, state, zip. Country defaults to US.
- **Bulk sends:** Pass an array of saved recipient IDs to `send_order`. Per-recipient message overrides are not exposed by this MCP tool.
- **Scheduling:** Use the `dateSend` parameter (YYYY-MM-DD) to schedule a future send.
- **Account balance:** Call `get_user` to check the user's credits balance.
