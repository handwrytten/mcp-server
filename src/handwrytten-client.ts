import { Handwrytten, HttpClient, parseCard, type HandwryttenOptions } from "handwrytten";

/** SDK 1.3 uses a nonexistent cards/get/:id route. Keep this API compatibility
 * fix here until the SDK uses cards/view and unwraps its card response. */
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
  return client;
}
