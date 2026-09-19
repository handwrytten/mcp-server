import type { Handwrytten } from "handwrytten";

export function estimateBasket(items: any[], count: number) {
  const amounts = items.map(item => item.price_structure?.sub_total ?? item.sub_total);
  const complete = count === items.length && amounts.every(n => n != null && n !== "" && Number.isFinite(Number(n)) && Number(n) >= 0);
  return {
    estimated_subtotal: complete ? Math.round(amounts.reduce((sum, n) => sum + Number(n), 0) * 100) / 100 : null,
    is_estimate: true as const,
    complete,
    notice: "Estimate only. Final tax, credits, discounts and shipping adjustments are determined at checkout.",
  };
}

export async function requireEmptyBasket(client: Handwrytten) {
  const response = await (client as any)._http.get("basket/count");
  const count = Number(response?.count);
  if (response?.count == null || !Number.isInteger(count) || count !== 0) {
    throw new Error("Single-order send requires an empty basket. Review existing items with View-Basket, then explicitly submit the whole basket with basket_send if desired.");
  }
}

export async function sendSingleOrder(client: Handwrytten, params: any) {
  if (params.confirmSend !== true) throw new Error("Confirm the card, message, recipients, sender and payment before setting confirmSend=true.");
  const { confirmSend, recipient, sender, ...order } = params;
  const addressIds = Array.isArray(recipient) ? recipient : [recipient];
  if (!addressIds.length || addressIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error("Provide at least one valid saved recipient ID.");
  await requireEmptyBasket(client);
  await client.basket.addOrder({ ...order, addressIds, returnAddressId: sender });
  // Detect additions from another client before submission. Atomic basket
  // version enforcement requires backend support; see the deployment notes.
  const count = await (client as any)._http.get("basket/count");
  if (Number(count?.count) !== addressIds.length) {
    throw new Error("Basket contents changed or could not be verified. The new order remains unsent; review the basket before submitting it.");
  }
  return client.basket.send();
}

export async function sendConfirmedBasket(client: Handwrytten, params: { confirmSend: boolean; testMode?: boolean; couponCode?: string }) {
  if (params.confirmSend !== true) throw new Error("Review and confirm ALL basket items and payment before setting confirmSend=true.");
  if (params.testMode) {
    const basket = await (client as any)._http.get("basket/allGrouped", { page: 1, limit: 1 });
    if (basket?.test_mode !== 1 && basket?.test_mode !== true && basket?.test_mode !== "1") {
      throw new Error("Test submission requires a Handwrytten test-mode account. Nothing was submitted.");
    }
  }
  const { confirmSend, ...options } = params;
  return client.basket.send(options);
}
