# Handwrytten MCP Server — Comprehensive Documentation

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Authentication](#authentication)
- [Setup Instructions](#setup-instructions)
- [Tool Reference](#tool-reference)
  - [Orders (Core)](#orders-core)
  - [Cards & Fonts](#cards--fonts)
  - [Address Book](#address-book)
  - [Gift Cards & Inserts](#gift-cards--inserts)
  - [Custom Cards](#custom-cards)
  - [QR Codes](#qr-codes)
  - [Basket (Multi-Step Ordering)](#basket-multi-step-ordering)
  - [Account](#account)
- [Interactive App Tools](#interactive-app-tools)
- [Common Workflows](#common-workflows)
- [Usage Examples](#usage-examples)
- [Safety & Permissions](#safety--permissions)
- [Error Handling](#error-handling)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [Privacy & Support](#privacy--support)

---

## Overview

The Handwrytten MCP server connects AI assistants (Claude, and others supporting [MCP](https://modelcontextprotocol.io/)) to the [Handwrytten](https://www.handwrytten.com) platform. Handwrytten uses robots with real pens to write personalized messages on physical greeting cards and stationery, which are then mailed to recipients.

Through this MCP server, an AI assistant can browse card templates, compose messages, manage addresses, and place orders — resulting in real physical cards being handwritten and mailed.

## Features

| Feature | Description |
|---------|-------------|
| **Send handwritten notes** | Single or bulk sends, with per-recipient customization |
| **Browse cards & fonts** | Discover 200+ stationery templates and 40+ handwriting styles |
| **Manage addresses** | Save, update, and delete recipient and sender addresses |
| **Create custom cards** | Upload images, add logos and text, design your own cards |
| **Gift cards & inserts** | Include physical gift cards or marketing inserts in envelopes |
| **QR codes** | Create trackable QR codes and place them on custom cards |
| **Order tracking** | Check order status, view history, get delivery tracking info |
| **Basket workflow** | Build multi-order baskets, review, and submit together |
| **Interactive previews** | 3D card browser, handwriting preview, and basket summary UI apps |
| **Scheduled delivery** | Schedule cards to be sent on a future date |

## Authentication

The server supports two authentication methods. Both provide access to the full feature set.

### OAuth 2.0 (Recommended)

The remote server uses OAuth 2.0 authorization code flow. Users sign in with their Handwrytten account when prompted — no API key needed.

- **Protocol**: OAuth 2.0 Authorization Code Flow
- **Token endpoint**: `https://mcp.handwrytten.com/token`
- **Authorization endpoint**: `https://mcp.handwrytten.com/authorize`
- **Token refresh**: Automatic — the server proactively refreshes tokens before expiry

### API Key (Local/Development)

For local or self-hosted setups, pass a Handwrytten API key via the `HANDWRYTTEN_API_KEY` environment variable. Get your key from [handwrytten.com/api](https://www.handwrytten.com/api/).

## Setup Instructions

### Claude.ai (Remote, OAuth)

Add Handwrytten from the MCP integrations menu in Claude.ai settings. No installation required — you'll be prompted to sign in with your Handwrytten account.

### Claude Desktop (Remote, OAuth)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "handwrytten": {
      "url": "https://mcp.handwrytten.com/mcp"
    }
  }
}
```

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code (Remote, OAuth)

```bash
claude mcp add handwrytten --transport http https://mcp.handwrytten.com/mcp
```

### Claude Desktop (Local, API Key)

```bash
npm install -g @handwrytten/mcp-server
```

```json
{
  "mcpServers": {
    "handwrytten": {
      "command": "handwrytten-mcp",
      "env": {
        "HANDWRYTTEN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Claude Code (Local, API Key)

```bash
npm install -g @handwrytten/mcp-server
claude mcp add handwrytten -- env HANDWRYTTEN_API_KEY=your_api_key_here handwrytten-mcp
```

### Cursor (Local, API Key)

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "handwrytten": {
      "command": "handwrytten-mcp",
      "env": {
        "HANDWRYTTEN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## Tool Reference

### Orders (Core)

#### `send_order`

**Send a real handwritten card.** This is the primary tool. It places an order that results in a physical card being written by a robot with a real pen and mailed to the recipient.

> **Important**: This charges the user's account and sends real physical mail. Always confirm all details with the user before calling.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardId` | string | Yes | Card template ID (from `list_cards`). e.g. `"1234"` |
| `font` | string | Yes | Handwriting font ID or label (from `list_fonts`). e.g. `"42"` or `"Sarah"` |
| `message` | string | No | The handwritten message body. Typically 500-800 character limit depending on card size. |
| `wishes` | string | No | Closing text below the message (e.g. `"Best regards,\nThe Team"`). Use `\n` for line breaks. |
| `recipient` | number or number[] | Yes | Saved recipient address ID (from `add_recipient` or `list_recipients`), or array of IDs for bulk sends. |
| `sender` | number | No | Saved sender address ID. If omitted, uses the account default. |
| `denominationId` | number | No | Gift card denomination ID (from `list_gift_cards` → denominations). |
| `insertId` | number | No | Insert ID (from `list_inserts`). Includes a physical insert in the envelope. |
| `signatureId` | number | No | Signature image ID (from `list_signatures`). Printed below the message. |
| `dateSend` | string | No | Schedule date in `YYYY-MM-DD` format. Omit to send immediately. |
| `clientMetadata` | string | No | Your own reference string for tracking (not printed on card). |

**Returns**: Order confirmation with ID, status, and pricing details.

**Typical workflow**:
1. `list_cards` → choose a card
2. `list_fonts` → choose a handwriting style
3. `add_recipient` → save the recipient address (if not already saved)
4. `send_order` → place the order

---

#### `get_order`

**Get full details of a specific order.** Returns status, tracking info, card details, message, addresses, and pricing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `orderId` | string | Yes | Order ID (from `send_order` response or `list_orders` results) |

---

#### `list_orders`

**List past orders with pagination.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number, starting from 1 (default: 1) |
| `perPage` | number | No | Orders per page (default: 20) |

---

### Cards & Fonts

#### `list_cards`

**Browse available card/stationery templates.** Returns paginated results with ID, title, image URL, category, and orientation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `categoryId` | number | No | Filter by category ID. Use `27` for "My Custom Cards". Call `list_card_categories` first. |
| `category` | string | No | Filter by category name (case-insensitive partial match, e.g. `"thank you"`, `"birthday"`). |
| `page` | number | No | Page number (default: 1) |
| `perPage` | number | No | Results per page (default: 20, max: 50) |
| `query` | string | No | Search card names (case-insensitive partial match) |

---

#### `get_card`

**Get full details of a specific card template.** Returns dimensions, orientation (`P`=portrait, `L`=landscape, `F`=flat), pricing, and detailed images (front/inside/back).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardId` | string | Yes | Card template ID (from `list_cards`) |

---

#### `list_card_categories`

**List all card categories** (e.g. "Thank You", "Birthday", "Holiday", "My Custom Cards"). Returns `{id, name, slug}`. Pass the `id` as `categoryId` to `list_cards`.

No parameters.

---

#### `list_fonts`

**List handwriting font styles** for the message body of orders. These are robot-handwritten fonts (not printed fonts). Returns `{id, name, label, previewUrl}`. Pass the `id` or `label` as the `font` parameter to `send_order` or `basket_add_order`.

No parameters.

---

#### `list_customizer_fonts`

**List printed/typeset fonts** for custom card text zones (header, footer, main, back). These are different from handwriting fonts — use only with `create_custom_card`.

No parameters.

---

### Address Book

Addresses must be saved before they can be used in orders. Use `add_recipient` / `add_sender` to save addresses, then pass their IDs to `send_order` or `basket_add_order`.

#### `list_recipients`

**List saved recipient (TO) addresses.** Returns `{id, firstName, lastName, street1, city, state, zip, company, birthday, anniversary}`.

No parameters.

---

#### `add_recipient`

**Save a new recipient address.** Returns `{addressId}` which you pass as `recipient` to `send_order`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `firstName` | string | Yes | First name |
| `lastName` | string | Yes | Last name |
| `street1` | string | Yes | Street address |
| `city` | string | Yes | City |
| `state` | string | Yes | Two-letter state/province code (e.g. `"CA"`, `"NY"`) |
| `zip` | string | Yes | ZIP/postal code (e.g. `"90210"`) |
| `street2` | string | No | Address line 2 |
| `company` | string | No | Company name |
| `countryId` | string | No | Two-letter country code (default: `"US"`). Call `list_countries` for valid codes. |
| `birthday` | string | No | Birthday in `YYYY-MM-DD` format (for automated birthday cards) |
| `anniversary` | string | No | Anniversary in `YYYY-MM-DD` format (for automated anniversary cards) |

---

#### `update_recipient`

**Update an existing recipient address.** Only pass the fields you want to change — omitted fields remain unchanged.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `addressId` | number | Yes | ID of the address to update |
| *(all other fields from `add_recipient`)* | — | No | Only changed fields needed |

---

#### `delete_recipient`

**Permanently delete recipient address(es).** Provide either `addressId` or `addressIds`, not both. Cannot be undone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `addressId` | number | No | Single address ID to delete |
| `addressIds` | number[] | No | Array of address IDs for batch delete |

---

#### `list_senders`

**List saved sender (FROM / return) addresses.** Returns `{id, firstName, lastName, street1, city, state, zip, company, isDefault}`.

No parameters.

---

#### `add_sender`

**Save a new sender address.** Returns `{addressId}` which you pass as `sender` to `send_order` or `returnAddressId` to `basket_add_order`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `firstName` | string | Yes | First name |
| `lastName` | string | Yes | Last name |
| `street1` | string | Yes | Street address |
| `city` | string | Yes | City |
| `state` | string | Yes | State/province code |
| `zip` | string | Yes | ZIP/postal code |
| `street2` | string | No | Address line 2 |
| `company` | string | No | Company name |
| `countryId` | string | No | Country code (default: `"US"`) |
| `default` | boolean | No | If `true`, becomes the default return address |

---

#### `delete_sender`

**Permanently delete sender address(es).** Same interface as `delete_recipient`.

---

#### `list_countries`

**List all countries Handwrytten can mail to.** Returns `{id, code, name}`. Use `code` as `countryId` when adding addresses.

No parameters.

---

#### `list_states`

**List states/provinces for a country.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `countryCode` | string | No | Two-letter country code (default: `"US"`) |

---

### Gift Cards & Inserts

#### `list_gift_cards`

**List available gift card products and their price denominations.** Returns `{id, name, denominations: [{id, price}]}`. Pass a denomination `id` as `denominationId` to `send_order` or `basket_add_order` to include a physical gift card in the envelope.

No parameters.

---

#### `list_inserts`

**List available card inserts** (business cards, flyers, brochures). Returns `{id, name, description, image}`. Pass `id` as `insertId` to `send_order` or `basket_add_order`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeHistorical` | boolean | No | If `true`, also returns discontinued inserts |

---

### Custom Cards

Custom cards let you design your own stationery with uploaded images, logos, text zones, and QR codes.

**Typical workflow**:
1. `list_custom_card_dimensions` → choose a card size/format
2. `upload_custom_image` → upload cover and logo images
3. `check_custom_image` → verify image quality
4. `create_custom_card` → assemble the design
5. Use the resulting card ID with `send_order`

#### `list_custom_card_dimensions`

**List available card sizes/formats.** Returns `{id, format (flat/folded), orientation (portrait/landscape), width, height}`. Pass `id` as `dimensionId` to `create_custom_card`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | Filter: `"flat"` or `"folded"` |
| `orientation` | string | No | Filter: `"portrait"` or `"landscape"` |

---

#### `upload_custom_image`

**Upload an image from a URL** for use in custom card designs. Returns `{id, url, width, height}`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Publicly accessible URL of the image (JPEG/PNG/GIF) |
| `imageType` | `"cover"` or `"logo"` | Yes | `"cover"` for full-bleed card faces, `"logo"` for writing-side logos |

**Where to use the returned `id`**:
- `imageType="cover"` → pass as `coverId` or `backCoverId` in `create_custom_card`
- `imageType="logo"` → pass as `headerLogoId`, `mainLogoId`, `footerLogoId`, or `backLogoId`

---

#### `check_custom_image`

**Validate image quality** (DPI, dimensions) for a specific card size.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `imageId` | number | Yes | Image ID (from `upload_custom_image`) |
| `cardId` | number | No | Card ID for dimension-specific checks |

---

#### `list_custom_images`

**List previously uploaded images.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `imageType` | `"cover"` or `"logo"` | No | Filter by type |

---

#### `delete_custom_image`

**Permanently delete an uploaded image.** Cannot be undone. Custom cards referencing this image may display incorrectly.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `imageId` | number | Yes | Image ID to delete |

---

#### `create_custom_card`

**Create a custom card design** from uploaded images and text zones.

This is a complex tool with many parameters organized by zone:

**Core parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name for the custom card |
| `dimensionId` | string | Yes | Dimension ID (from `list_custom_card_dimensions`) |
| `coverId` | number | No | Front cover image ID (from `upload_custom_image` with `imageType="cover"`) |

**Writing-side zones** (header, main, footer) — each zone has a `type` that must match the content:

| Zone Parameter Pattern | Description |
|----------------------|-------------|
| `{zone}Type` | `"logo"` or `"text"` — **must be `"logo"` when using a logo ID** |
| `{zone}Text` | Printed text (when type is `"text"`) |
| `{zone}FontId` | Font ID from `list_customizer_fonts` |
| `{zone}LogoId` | Logo image ID (from `upload_custom_image` with `imageType="logo"`) |
| `{zone}LogoSizePercent` | Logo size 1-100 |

Where `{zone}` is `header`, `main`, or `footer`.

**Back side** (required for folded cards):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `backLogoId` | number | No* | Image ID for back. *Required for folded cards (dimension_id=3). |
| `backType` | `"logo"` or `"cover"` | No* | *Required when `backLogoId` is provided. |
| `backSizePercent` | number | No | Logo size 1-100 (when `backType="logo"`) |
| `backVerticalAlign` | `"top"`, `"center"`, or `"bottom"` | No | Logo alignment (when `backType="logo"`) |
| `backCoverId` | number | No | Alternative full-bleed back image |
| `backText` | string | No | Back side printed text |
| `backFontId` | number | No | Back side font ID |

**QR code**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `qrCodeId` | number | No | QR code ID (from `create_qr_code`) |
| `qrCodeLocation` | `"header"`, `"footer"`, or `"main"` | No | Placement zone |
| `qrCodeSizePercent` | number | No | Size 1-100 |
| `qrCodeAlign` | string | No | Alignment: `"left"`, `"center"`, `"right"` |
| `qrCodeFrameId` | number | No | Decorative frame (from `list_qr_code_frames`) |

---

#### `get_custom_card`

**Get full details of a custom card design.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardId` | number | Yes | Custom card ID |

---

#### `delete_custom_card`

**Permanently delete a custom card design.** Existing orders are unaffected, but new orders cannot use it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardId` | number | Yes | Custom card ID to delete |

---

### QR Codes

QR codes can be placed on custom cards. When scanned, they direct to a URL and track scan counts.

#### `list_qr_codes`

**List QR codes on this account.** Returns `{id, name, url, scan_count}`.

No parameters.

---

#### `create_qr_code`

**Create a new QR code.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Display name (for your reference, not printed) |
| `url` | string | Yes | URL the QR code links to |
| `iconId` | number | No | Icon ID for the QR code center |
| `webhookUrl` | string | No | Webhook URL for scan notifications |

---

#### `delete_qr_code`

**Permanently delete a QR code.** Custom cards using it will no longer display it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `qrCodeId` | number | Yes | QR code ID to delete |

---

#### `list_qr_code_frames`

**List decorative frames for QR codes.** Returns `{id, name, preview_url}`. Pass `id` as `qrCodeFrameId` to `create_custom_card`.

No parameters.

---

### Basket (Multi-Step Ordering)

The basket workflow lets you build up multiple orders, review them, and submit them all at once. Use `send_order` instead for simple single-step sends.

**Typical workflow**:
1. `basket_add_order` → add orders (one per recipient)
2. `basket_list` or `View-Basket` app → review
3. `basket_send` → submit all orders for fulfillment

#### `basket_add_order`

**Add an order to the basket.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardId` | string | Yes | Card template ID (from `list_cards`) |
| `font` | string | No | Handwriting font ID or label |
| `message` | string | No | The handwritten message |
| `wishes` | string | No | Closing text |
| `addressIds` | number[] | Yes | Recipient address IDs. One order is created per address. |
| `returnAddressId` | number | No | Sender address ID. If omitted, uses account default. |
| `denominationId` | number | No | Gift card denomination ID |
| `insertId` | number | No | Insert ID |
| `signatureId` | number | No | Signature image ID |
| `dateSend` | string | No | Schedule date (`YYYY-MM-DD`). Omit to send when basket is submitted. |
| `clientMetadata` | string | No | Your reference string |

---

#### `basket_send`

**Submit the basket for processing.** This charges the user's account and sends all orders.

> **Important**: Always confirm with the user before calling. This sends real physical mail.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `couponCode` | string | No | Coupon/promo code for a discount |
| `testMode` | boolean | No | If `true`, validates but does NOT send or charge |

---

#### `basket_list`

**List all items currently in the basket** (not yet submitted).

No parameters.

---

#### `basket_count`

**Get the count of basket items.** Quick check without fetching full details.

No parameters. Returns `{count: number}`.

---

#### `basket_remove`

**Remove a single order from the basket.** The order is discarded permanently.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `basketId` | number | Yes | Basket item ID (from `basket_list`) |

---

#### `basket_clear`

**Remove all orders from the basket.** Cannot be undone.

No parameters.

---

#### `list_past_baskets`

**List previously submitted baskets.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number |

---

### Account

#### `get_user`

**Get the authenticated user's profile.** Returns ID, name, email, credits balance, test mode flag, and subscription status.

No parameters.

---

#### `list_signatures`

**List saved handwriting signature images.** Returns `{id, name, preview_url}`. Pass `id` as `signatureId` when placing orders.

No parameters.

---

## Interactive App Tools

These tools open rich interactive UIs inside the conversation. They are read-only and do not modify data (except for action buttons within the UI).

### Preview-Cards (Browse Cards)

Opens an interactive 3D card browser. Browse card templates with flip animation showing front, inside, and back views. Click "Select" to choose a card.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `categoryId` | number | No | Filter by category ID |
| `query` | string | No | Search card names |

### Preview-Writing (Preview Writing)

Renders a live preview of how a handwritten message will look on a card. Supports interactively changing fonts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Message text to preview |
| `fontId` | string | No | Font ID or label |
| `cardId` | string | No | Card ID for accurate dimensions |
| `wishes` | string | No | Closing text |
| `inkColor` | string | No | Ink color hex (e.g. `"#0040ac"`) |

### View-Basket (View Basket)

Opens a visual summary of the current basket. Shows each order with card preview, addresses, message, pricing breakdown, and checkout totals. Supports removing items and clearing the basket from within the UI.

No parameters.

---

## Common Workflows

### Send a single card

```
User: "Send a thank-you note to John Smith at 456 Oak Ave, Tempe AZ 85281"
```

1. `list_cards` with `category="thank you"` → choose a card
2. `list_fonts` → choose a handwriting style
3. `add_recipient` with John's address → get `addressId`
4. `send_order` with `cardId`, `font`, `message`, `recipient=addressId`

### Send bulk cards from a list

```
User: "Send birthday cards to all these people: [CSV/list]"
```

1. `list_cards` with `category="birthday"` → choose a card
2. `list_fonts` → choose a font
3. `add_recipient` for each person → collect address IDs
4. `send_order` with `recipient=[id1, id2, id3, ...]`

### Create and send a custom card

```
User: "Create a custom card with our company logo and send it to our top 5 clients"
```

1. `list_custom_card_dimensions` → choose flat or folded
2. `upload_custom_image` with `imageType="cover"` → get cover image ID
3. `upload_custom_image` with `imageType="logo"` → get logo image ID
4. `create_custom_card` with cover, logo zones, and text → get card ID
5. `list_recipients` → find the top 5 clients
6. `send_order` with the custom card ID and recipient IDs

### Build a basket and review before sending

```
User: "Add thank-you cards for these 3 clients but don't send yet, let me review first"
```

1. `list_cards` → choose a card
2. `list_fonts` → choose a font
3. `basket_add_order` for each client
4. `View-Basket` → user reviews the visual summary
5. User confirms → `basket_send`

### Schedule a card for a future date

```
User: "Send a holiday card to our team on December 20th"
```

1. `list_cards` with `category="holiday"` → choose a card
2. `send_order` with `dateSend="2025-12-20"`

### Include a gift card

```
User: "Send a thank-you card with a $25 Amazon gift card"
```

1. `list_cards` → choose a card
2. `list_gift_cards` → find Amazon gift card, get the $25 denomination ID
3. `send_order` with `denominationId`

---

## Usage Examples

### Example 1: Simple Thank-You Card

**User prompt**: "Send a thank-you card to Jane Doe at 123 Main St, Phoenix, AZ 85001 saying 'Thank you for your business! We truly appreciate your partnership.'"

**What Claude does**:
1. Calls `list_cards` with `category="thank you"` — finds card ID 42
2. Calls `list_fonts` — selects font "Sarah" (ID 7)
3. Calls `add_recipient` with Jane's address — gets addressId 1234
4. Confirms details with user
5. Calls `send_order` with `cardId="42"`, `font="7"`, `message="Thank you for your business!..."`, `recipient=1234`

**Result**: A physical thank-you card is handwritten and mailed to Jane.

### Example 2: Bulk Holiday Cards

**User prompt**: "Send holiday cards to everyone in my address book"

**What Claude does**:
1. Calls `list_recipients` — gets 15 saved addresses
2. Calls `list_cards` with `category="holiday"` — presents options to user
3. User picks a card → ID 88
4. Calls `list_fonts` — user picks "Classic" font
5. Confirms the message and recipient list with user
6. Calls `send_order` with `cardId="88"`, `font="Classic"`, `message="..."`, `recipient=[id1, id2, ..., id15]`

**Result**: 15 handwritten holiday cards are mailed to all recipients.

### Example 3: Custom Card with Logo

**User prompt**: "I want to create a custom flat card with our company logo on the front and send it to our newest client"

**What Claude does**:
1. Calls `list_custom_card_dimensions` — user picks flat portrait
2. Calls `upload_custom_image` with company logo URL, `imageType="cover"` → gets imageId 55
3. Calls `create_custom_card` with `name="Company Card"`, `dimensionId="1"`, `coverId=55` → gets cardId 200
4. Calls `add_recipient` with client's address → gets addressId 5678
5. Confirms with user
6. Calls `send_order` with `cardId="200"`, `recipient=5678`

**Result**: A custom-designed card is printed, handwritten, and mailed.

### Example 4: Basket Review Workflow

**User prompt**: "Add thank-you cards for these 3 people but let me review before sending: Alice (123 Oak St, NY), Bob (456 Pine Ave, CA), Carol (789 Elm Dr, TX)"

**What Claude does**:
1. Calls `list_cards` and `list_fonts` — user selects options
2. Calls `add_recipient` three times for Alice, Bob, Carol
3. Calls `basket_add_order` with all three recipient IDs
4. Calls `View-Basket` — shows interactive basket summary with card previews, addresses, and pricing
5. User reviews and confirms
6. Calls `basket_send`

**Result**: Three personalized cards are submitted for fulfillment.

### Example 5: Scheduled Card with Gift Card

**User prompt**: "Send a birthday card with a $50 Starbucks gift card to my friend Mike on March 15th"

**What Claude does**:
1. Calls `list_cards` with `category="birthday"` — user picks a card
2. Calls `list_gift_cards` — finds Starbucks, gets $50 denomination ID
3. Calls `list_fonts` — user picks a font
4. Calls `add_recipient` with Mike's address
5. Confirms total cost with user
6. Calls `send_order` with `dateSend="2026-03-15"`, `denominationId=...`

**Result**: Card is queued and will be handwritten and mailed to arrive around March 15th.

---

## Safety & Permissions

Every tool has explicit safety annotations following the [MCP Directory Policy](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide):

| Annotation | Applied To | Meaning |
|------------|-----------|---------|
| `readOnlyHint: true` | All read/list/get tools | Only reads data, no side effects |
| `destructiveHint: true` | All create/update/delete/send tools | Modifies data or has side effects |
| `title` | All tools | Human-readable name for UI display |

**High-impact tools** that send real mail or clear data include explicit confirmation instructions in their descriptions:

- `send_order` — "Always confirm card, message, recipient, and sender details with the user before calling"
- `basket_send` — "Always confirm with the user before calling"
- `basket_clear` — "Always confirm with the user before calling — this cannot be undone"
- All `delete_*` tools — Marked as "cannot be undone"

---

## Error Handling

All tools return structured error responses:

```json
{
  "content": [{ "type": "text", "text": "Error: <descriptive message>" }],
  "isError": true
}
```

Common error scenarios:
- **Invalid ID**: "Card not found" / "Address not found"
- **Missing required field**: Validation error from the API
- **Authentication expired**: Token refresh is automatic; if it fails, re-authenticate
- **Rate limiting**: The API may return 429 responses during heavy use
- **Network issues**: Timeout errors after 15 seconds

---

## Environment Variables

| Variable | Required | Mode | Description |
|----------|----------|------|-------------|
| `HANDWRYTTEN_API_KEY` | Yes (stdio) | Local/stdio | API key from handwrytten.com/api |
| `MCP_SERVER_URL` | Yes (HTTP) | Remote/HTTP | Public URL of the MCP server (e.g. `https://mcp.handwrytten.com`) |
| `OAUTH_CLIENT_ID` | Yes (HTTP) | Remote/HTTP | OAuth 2.0 client ID |
| `OAUTH_CLIENT_SECRET` | Yes (HTTP) | Remote/HTTP | OAuth 2.0 client secret |
| `HANDWRYTTEN_API_URL` | No | Both | Override the Handwrytten API base URL (default: production) |
| `PORT` | No | HTTP | HTTP server port (default: 3000) |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  AI Assistant (Claude, etc.)                │
│  ┌───────────────────────────────────────┐  │
│  │  MCP Client                           │  │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────┘
                   │ MCP Protocol
                   │ (stdio or Streamable HTTP)
┌──────────────────┼──────────────────────────┐
│  Handwrytten MCP Server                     │
│  ┌───────────────┴───────────────────────┐  │
│  │  40+ Tools      3 Interactive Apps    │  │
│  │  (tools.ts)     (app-tools.ts)        │  │
│  └───────────────┬───────────────────────┘  │
│  ┌───────────────┴───────────────────────┐  │
│  │  Handwrytten TypeScript SDK           │  │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────┘
                   │ HTTPS
┌──────────────────┼──────────────────────────┐
│  Handwrytten API (api.handwrytten.com)      │
│  → Card selection, order placement,         │
│    address management, fulfillment          │
└─────────────────────────────────────────────┘
                   │
                   ▼
        Physical card written by robot
        and mailed to recipient
```

**Transport modes**:
- **Stdio** (local): Used by Claude Desktop and Claude Code when running the server locally. API key auth.
- **Streamable HTTP** (remote): Used by Claude.ai, Claude Desktop (remote), and Claude Code (remote). OAuth 2.0 auth with automatic token refresh.

**Session management** (HTTP mode):
- Each OAuth token gets its own MCP session with a dedicated Handwrytten client
- Sessions are automatically cleaned up after inactivity
- Token refresh happens proactively before expiry

---

## Privacy & Support

- **Privacy Policy**: [handwrytten.com/privacy-policy](https://www.handwrytten.com/privacy-policy)
- **Support**: [handwrytten.com/contact](https://www.handwrytten.com/contact) or email dev@handwrytten.com
- **Source Code**: [github.com/handwrytten/handwrytten-mcp-server](https://github.com/handwrytten/handwrytten-mcp-server)
- **SDK**: [npmjs.com/package/handwrytten](https://www.npmjs.com/package/handwrytten)

**Data practices**:
- The server only collects data necessary for functionality (addresses, messages, order details)
- No conversation data is stored or logged beyond what's needed for API calls
- All API communication uses HTTPS/TLS
