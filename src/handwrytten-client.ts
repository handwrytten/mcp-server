import { Handwrytten, HttpClient, parseCard, parseCountry, parseState, parseOrder, parseCustomCard, type HandwryttenOptions } from "handwrytten";

/** Compatibility for fixes not yet published in SDK 1.6.0.
 * Remove these adapters after adopting the SDK parity release. */
export function createHandwryttenClient(options: string | HandwryttenOptions): Handwrytten {
  // SDK retries include POSTs and transport failures. Until the backend
  // guarantees idempotency, an ambiguous response must never replay a write.
  // Apply this to both SDK and compatibility-adapter HTTP clients.
  const config = { ...(typeof options === "string" ? { apiKey: options } : options), maxRetries: 1 };
  const client = new Handwrytten(config);
  const http = new HttpClient(config);
  // The published SDK uses orders/get/:id and per_page, but the backend
  // exposes orders/details?id=... and the pagination middleware reads limit.
  const normalizeOrder = (data: any) => parseOrder({ ...data,
    card_id: data.card_id ?? data.card?.id,
    font_id: data.font_id ?? data.fontInfo?.id ?? data.font,
    created_at: data.created_at ?? data.date_created,
  });
  client.orders.get = async orderId => {
    const response = await http.get("orders/details", { id: orderId }) as any;
    if (!response?.order || String(response.order.id) !== orderId) throw new Error("Order lookup returned no matching order.");
    return normalizeOrder(response.order);
  };
  client.orders.list = async options => {
    const response = await http.get("orders/list", { page: options?.page ?? 1, limit: options?.perPage ?? 20 }) as any;
    const orders = Array.isArray(response) ? response : response?.orders;
    if (!Array.isArray(orders)) throw new Error("Order history returned an invalid response.");
    return orders.map(normalizeOrder);
  };
  client.cards.get = async (cardId: string) => {
    const response = await http.get("cards/view", { card_id: cardId }) as { card?: Record<string, unknown> };
    if (!response?.card || String(response.card.id) !== cardId) {
      throw new Error("Card lookup returned no matching card.");
    }
    return parseCard(response.card);
  };
  client.customCards.get = async cardId => {
    const response = await http.get("design/getCustomCard", { id: cardId }) as any;
    if (!response?.card || Number(response.card.id) !== cardId) throw new Error("Custom card lookup returned no matching card.");
    return parseCustomCard(response.card);
  };
  client.addressBook.countries = async () => {
    const data = await http.get("countries/list") as any;
    const items = Array.isArray(data) ? data : data?.countries ?? data?.results ?? [];
    return items.map(parseCountry);
  };
  client.addressBook.states = async (code = "US") => {
    const country = (await client.addressBook.countries()).find(c => c.code.toUpperCase() === code.toUpperCase());
    const states = country?.raw.states;
    return Array.isArray(states) ? states.map(s => parseState({ ...s, code: s.code ?? s.abbreviation ?? s.short_name })) : [];
  };
  const addOrder = client.basket.addOrder.bind(client.basket);
  client.basket.addOrder = async options => {
    if (options.addresses != null && options.addressIds != null) throw new Error("Pass either addresses or addressIds, not both.");
    const addresses = options.addresses?.map(row => ({ ...row,
      ...(options.returnAddressId != null && !("return_address_id" in row) ? { return_address_id: options.returnAddressId } : {}),
    }));
    return addOrder({ ...options, ...(addresses ? { addresses } : {}) });
  };
  return client;
}
