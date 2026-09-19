import { Handwrytten, HttpClient, parseCard, parseCountry, parseState, type HandwryttenOptions } from "handwrytten";

/** Compatibility for fixes not yet published in SDK 1.6.0.
 * Remove these adapters after adopting the SDK parity release. */
export function createHandwryttenClient(options: string | HandwryttenOptions): Handwrytten {
  const config = typeof options === "string" ? { apiKey: options } : options;
  const client = new Handwrytten(config);
  const http = new HttpClient(config);
  client.cards.get = async (cardId: string) => {
    const response = await http.get("cards/view", { card_id: cardId }) as { card?: Record<string, unknown> };
    if (!response?.card || String(response.card.id) !== cardId) {
      throw new Error("Card lookup returned no matching card.");
    }
    return parseCard(response.card);
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
