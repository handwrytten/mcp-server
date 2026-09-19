import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const raw = z.record(z.unknown());
const id = z.union([z.string(), z.number()]);
const record = (fields: z.ZodRawShape) => z.object(fields).passthrough();
const card = record({ id: z.string(), title: z.string(), raw });
const font = record({ id: z.string(), name: z.string(), label: z.string(), raw });
const address = record({ id: z.number(), raw });
const order = record({ id: z.string(), raw });
const writing = record({ renderError: z.string(), selectedFont: record({ id, label: z.string() }), cardId: z.string().optional() });
const basket = record({ items: z.array(raw), count: z.number(), checkout: record({ estimated_subtotal: z.number().nullable(), is_estimate: z.literal(true), complete: z.boolean(), notice: z.string() }) });

/** Exact stable fields are typed; raw backend extension fields remain extensible. */
export const resultSchemas: Record<string, z.ZodTypeAny> = {
  get_user: record({ id: z.string(), raw }),
  list_signatures: z.array(record({ id: z.number(), preview: z.string().optional(), raw })),
  list_cards: record({ cards: z.array(record({ id: z.string(), title: z.string() })), pagination: record({ page: z.number(), perPage: z.number(), total: z.number(), totalPages: z.number() }) }),
  get_card: card,
  list_card_categories: z.array(record({ id, name: z.string() })),
  list_fonts: z.array(font), list_customizer_fonts: z.array(raw),
  list_gift_cards: z.array(record({ id: z.string(), title: z.string(), denominations: z.array(record({ id: z.number(), nominal: z.number(), price: z.number() })), raw })),
  list_inserts: z.array(record({ id: z.string(), title: z.string(), raw })),
  list_qr_codes: z.array(record({ id: z.string(), raw })), create_qr_code: record({ id: z.string(), raw }), delete_qr_code: raw,
  list_qr_code_frames: z.array(raw), list_recipients: z.array(address), list_senders: z.array(address),
  add_recipient: record({ addressId: z.number(), message: z.string() }), update_recipient: record({ addressId: z.number(), message: z.string() }), add_sender: record({ addressId: z.number(), message: z.string() }),
  delete_recipient: raw, delete_sender: raw,
  list_countries: z.array(record({ id: z.number(), code: z.string(), name: z.string(), aliases: z.array(z.string()), deliveryCost: z.number(), raw })),
  list_states: z.array(record({ code: z.string(), name: z.string(), raw })),
  send_order: raw, get_order: order, list_orders: z.array(order), list_past_baskets: z.array(raw),
  basket_add_order: raw, basket_send: raw, basket_list: raw, basket_count: record({ count: z.number() }), basket_remove: raw, basket_clear: raw,
  list_custom_card_dimensions: z.array(record({ id: z.number(), orientation: z.string(), format: z.string(), openWidth: z.union([z.string(), z.number()]), openHeight: z.union([z.string(), z.number()]), raw })),
  upload_custom_image: record({ id: z.number(), raw }), check_custom_image: raw,
  list_custom_images: z.array(record({ id: z.number(), raw })), delete_custom_image: raw,
  create_custom_card: record({ cardId: z.number(), raw }), get_custom_card: record({ cardId: z.number(), raw }), delete_custom_card: raw,
  "Preview-Cards": record({ cards: z.array(raw) }), get_cards_detailed: record({ cards: z.array(raw), page: z.number(), perPage: z.number() }),
  get_card_image: record({ imageAvailable: z.literal(true), mimeType: z.string() }),
  "Preview-Writing": writing, preview_writing: writing,
  "View-Basket": basket, get_basket_summary: basket,
  basket_remove_item: record({ success: z.boolean(), result: raw }), basket_clear_all: record({ success: z.boolean(), result: raw }),
};

export function outputSchemaFor(name: string) {
  const schema = resultSchemas[name];
  if (!schema) throw new Error(`Missing result schema for ${name}`);
  return { result: schema.describe("Tool result; legacy text content contains the same value without the result envelope.") };
}

const secretKeys = new Set(["uid", "password", "password_hash", "api_key", "apikey", "access_token", "accesstoken", "refresh_token", "refreshtoken", "client_secret", "clientsecret", "authorization", "session_token"]);
export function redactSecrets(value: unknown): any {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKeys.has(key.toLowerCase())).map(([key, item]) => [key, redactSecrets(item)]));
  return value;
}

export function structuredResult(name: string, result: CallToolResult): CallToolResult {
  if (result.isError) return result;
  const image = result.content.find(c => c.type === "image");
  const text = result.content.find(c => c.type === "text");
  const value = name === "get_card_image" && image?.type === "image"
    ? { imageAvailable: true, mimeType: image.mimeType }
    : text?.type === "text" ? redactSecrets(JSON.parse(text.text)) : undefined;
  // The SDK falls back to the legacy UID credential when numeric id is absent.
  // Never expose that credential under the normalized id alias.
  if (name === "get_user" && text?.type === "text") {
    const original = JSON.parse(text.text);
    if (original.raw?.uid != null && String(original.id) === String(original.raw.uid)) value.id = original.raw.id != null ? String(original.raw.id) : "";
  }
  resultSchemas[name].parse(value);
  return { ...result,
    content: result.content.map(c => c.type === "text" ? { ...c, text: JSON.stringify(value) } : c),
    structuredContent: { result: value },
  };
}

export function withStructuredResult<T extends (...args: any[]) => any>(name: string, callback: T): T {
  return (async (...args: any[]) => structuredResult(name, await callback(...args))) as T;
}
