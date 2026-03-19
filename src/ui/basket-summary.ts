/**
 * Basket Summary MCP App — displays current basket contents and checkout info.
 *
 * Renders inside the Claude conversation as a sandboxed iframe.
 * Matches the look and feel of app.handwrytten.com/my-basket.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./basket-summary.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Address {
  name?: string;
  firstName?: string;
  lastName?: string;
  business_name?: string;
  company?: string;
  address_line_1?: string;
  address_line_2?: string;
  street1?: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

interface PriceStructure {
  card: number;
  gift_card?: number;
  insert?: number;
  postage: number;
  shipping?: number;
  sub_total: number;
  total: number;
  tax?: number | null;
  delivery_confirmation?: number;
}

interface BasketItem {
  id: number;
  card_cover?: string;
  card?: {
    id: number;
    name: string;
    cover?: string;
    orientation?: string;
  };
  message?: string;
  wishes?: string;
  address_from?: Address;
  address_to?: Address;
  date_send?: string;
  fontInfo?: { name?: string; label?: string };
  price_structure?: PriceStructure;
  sub_total?: number;
  is_bulk?: number;
  children_total?: number;
  test_mode?: number;
  denomination?: { price?: number; name?: string };
  insert?: { name?: string };
  shipping_details?: { name?: string };
  status?: string;
}

interface CheckoutData {
  grand_total: number;
  tax: number;
  total: number;
  applied_credit: number;
  coupon_credit: number;
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const basketItemsEl = document.getElementById("basket-items")!;
const loadingEl = document.getElementById("loading")!;
const emptyStateEl = document.getElementById("empty-state")!;
const itemCountEl = document.getElementById("item-count")!;
const checkoutSection = document.getElementById("checkout-section")!;
const actionsEl = document.getElementById("actions")!;
const refreshBtn = document.getElementById("refresh-btn")!;
const clearBtn = document.getElementById("clear-btn")!;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

// Checkout fields
const checkoutSubtotal = document.getElementById("checkout-subtotal")!;
const checkoutTax = document.getElementById("checkout-tax")!;
const checkoutCredits = document.getElementById("checkout-credits")!;
const checkoutCreditsRow = document.getElementById("checkout-credits-row")!;
const checkoutCoupon = document.getElementById("checkout-coupon")!;
const checkoutCouponRow = document.getElementById("checkout-coupon-row")!;
const checkoutTotal = document.getElementById("checkout-total")!;

// ---------------------------------------------------------------------------
// MCP App instance
// ---------------------------------------------------------------------------

const app = new App(
  { name: "Basket Summary", version: "1.0.0" },
  {},
  { autoResize: true }
);

// ---------------------------------------------------------------------------
// Image loading (same CSP bypass as card preview)
// ---------------------------------------------------------------------------

const b64Cache = new Map<string, string>();

async function fetchImageViaMcp(url: string): Promise<string> {
  if (!url) return "";
  const cached = b64Cache.get(url);
  if (cached) return cached;
  try {
    const result = await app.callServerTool({
      name: "get_card_image",
      arguments: { url },
    });
    const imgBlock = (result.content as any)?.find((c: any) => c.type === "image");
    if (imgBlock?.data && imgBlock?.mimeType) {
      const dataUri = `data:${imgBlock.mimeType};base64,${imgBlock.data}`;
      b64Cache.set(url, dataUri);
      return dataUri;
    }
  } catch (e) {
    console.error("Failed to fetch image:", url, e);
  }
  return "";
}

// Image load queue
const imageQueue: Array<{ url: string; img: HTMLImageElement }> = [];
let imageLoadRunning = 0;

async function processImageQueue() {
  while (imageQueue.length > 0 && imageLoadRunning < 2) {
    const item = imageQueue.shift();
    if (!item) break;
    imageLoadRunning++;
    fetchImageViaMcp(item.url)
      .then((dataUri) => {
        if (dataUri) {
          item.img.src = dataUri;
          item.img.classList.add("loaded");
        }
      })
      .finally(() => {
        imageLoadRunning--;
        processImageQueue();
      });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatPrice(amount: number | undefined | null): string {
  if (amount == null || amount === 0) return "$0.00";
  return `$${Number(amount).toFixed(2)}`;
}

function formatAddress(addr?: Address): string {
  if (!addr) return "—";
  const parts: string[] = [];
  const name = addr.name || [addr.firstName, addr.lastName].filter(Boolean).join(" ");
  if (name) parts.push(`<span class="address-block-name">${escapeHtml(name)}</span>`);
  const biz = addr.business_name || addr.company;
  if (biz) parts.push(escapeHtml(biz));
  const line1 = addr.address_line_1 || addr.street1;
  const line2 = addr.address_line_2 || addr.street2;
  if (line1) parts.push(escapeHtml(line1));
  if (line2) parts.push(escapeHtml(line2));
  const cityLine = [addr.city, addr.state].filter(Boolean).join(", ");
  if (cityLine) parts.push(escapeHtml(cityLine) + (addr.zip ? " " + escapeHtml(addr.zip) : ""));
  if (addr.country && addr.country !== "US" && addr.country !== "United States") parts.push(escapeHtml(addr.country));
  return parts.join("<br>");
}

function cdnUrl(url?: string): string {
  if (!url) return "";
  return url.replace("https://d3e924qpzqov0g.cloudfront.net", "https://cdn.handwrytten.com");
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "ASAP";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBasketItem(item: BasketItem): HTMLElement {
  const el = document.createElement("div");
  el.className = "order-card";

  const cardName = item.card?.name || "Order";
  const coverUrl = cdnUrl(item.card_cover || item.card?.cover);
  const ps = item.price_structure;
  const message = item.message || "";
  const wishes = item.wishes || "";

  // Badges
  let badges = "";
  if (item.test_mode) badges += '<span class="test-badge">TEST</span> ';
  if (item.is_bulk && item.children_total && item.children_total > 1) {
    badges += `<span class="bulk-badge">${item.children_total} recipients</span> `;
  }

  // Price breakdown items
  const priceItems: string[] = [];
  if (ps) {
    if (ps.card) priceItems.push(`<div class="price-item"><span class="price-item-label">Card:</span><span class="price-item-value">${formatPrice(ps.card)}</span></div>`);
    if (ps.gift_card) priceItems.push(`<div class="price-item"><span class="price-item-label">Gift Card:</span><span class="price-item-value">${formatPrice(ps.gift_card)}</span></div>`);
    if (ps.insert) priceItems.push(`<div class="price-item"><span class="price-item-label">Insert:</span><span class="price-item-value">${formatPrice(ps.insert)}</span></div>`);
    if (ps.postage) priceItems.push(`<div class="price-item"><span class="price-item-label">Postage:</span><span class="price-item-value">${formatPrice(ps.postage)}</span></div>`);
    if (ps.shipping) priceItems.push(`<div class="price-item"><span class="price-item-label">Shipping:</span><span class="price-item-value">${formatPrice(ps.shipping)}</span></div>`);
    if (ps.delivery_confirmation) priceItems.push(`<div class="price-item"><span class="price-item-label">Delivery Confirm:</span><span class="price-item-value">${formatPrice(ps.delivery_confirmation)}</span></div>`);
  }
  const subtotal = ps?.sub_total ?? item.sub_total ?? 0;
  priceItems.push(`<div class="price-item"><span class="price-item-label">Subtotal:</span><span class="price-item-value" style="font-weight:700; color:#ee6723">${formatPrice(subtotal)}</span></div>`);

  el.innerHTML = `
    <div class="order-card-body">
      <div class="order-card-image">
        <img alt="${escapeHtml(cardName)}" />
        <div class="image-spinner"></div>
      </div>
      <div class="order-card-details">
        <div class="order-card-top">
          <span class="order-card-name" title="${escapeHtml(cardName)}">${escapeHtml(cardName)}</span>
          <span class="order-card-price">${formatPrice(subtotal)}</span>
        </div>
        <div class="order-card-meta">
          ${badges ? `<div class="meta-row">${badges}</div>` : ""}
          <div class="meta-row">
            <span class="meta-label">Send:</span>
            <span class="meta-value">${item.date_send ? `<span class="schedule-badge">${formatDate(item.date_send)}</span>` : "ASAP"}</span>
          </div>
          ${item.fontInfo?.label ? `<div class="meta-row"><span class="meta-label">Font:</span><span class="meta-value">${escapeHtml(item.fontInfo.label || item.fontInfo.name || "")}</span></div>` : ""}
          ${item.denomination?.name ? `<div class="meta-row"><span class="meta-label">Gift:</span><span class="meta-value">${escapeHtml(item.denomination.name)} (${formatPrice(item.denomination.price)})</span></div>` : ""}
          ${item.insert?.name ? `<div class="meta-row"><span class="meta-label">Insert:</span><span class="meta-value">${escapeHtml(item.insert.name)}</span></div>` : ""}
        </div>
        ${message ? `<div class="order-message"><div class="order-message-label">Message:</div>${escapeHtml(message)}</div>` : ""}
        ${wishes ? `<div class="order-message"><div class="order-message-label">Wishes:</div>${escapeHtml(wishes)}</div>` : ""}
      </div>
    </div>
    <div class="order-addresses">
      <div class="address-block">
        <div class="address-block-label">From</div>
        ${formatAddress(item.address_from)}
      </div>
      <div class="address-block">
        <div class="address-block-label">To</div>
        ${formatAddress(item.address_to)}
      </div>
    </div>
    ${priceItems.length > 0 ? `<div class="order-price-breakdown">${priceItems.join("")}</div>` : ""}
    <div class="order-card-footer">
      <button class="btn-edit" data-id="${item.id}">Edit in App</button>
      <button class="btn-remove" data-id="${item.id}">Remove</button>
    </div>
  `;

  // Queue image load
  const img = el.querySelector(".order-card-image img") as HTMLImageElement;
  if (img && coverUrl) {
    imageQueue.push({ url: coverUrl, img });
    processImageQueue();
  }

  // Remove button handler
  const removeBtn = el.querySelector(".btn-remove") as HTMLButtonElement;
  removeBtn.addEventListener("click", async () => {
    removeBtn.textContent = "Removing...";
    removeBtn.disabled = true;
    try {
      await app.callServerTool({
        name: "basket_remove_item",
        arguments: { basketId: item.id },
      });
      el.remove();
      // Refresh data
      loadBasket();
    } catch (e) {
      console.error("Remove failed:", e);
      removeBtn.textContent = "Remove";
      removeBtn.disabled = false;
    }
  });

  // Edit button — send message to Claude
  const editBtn = el.querySelector(".btn-edit") as HTMLButtonElement;
  editBtn.addEventListener("click", () => {
    app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `I'd like to edit basket order #${item.id} ("${cardName}")` }],
    });
  });

  return el;
}

function renderCheckout(checkout: CheckoutData) {
  checkoutSubtotal.textContent = formatPrice(checkout.grand_total);
  checkoutTax.textContent = checkout.tax ? formatPrice(checkout.tax) : "Free";
  checkoutTotal.textContent = checkout.total ? formatPrice(checkout.total) : "Free";

  if (checkout.applied_credit > 0) {
    checkoutCredits.textContent = `-${formatPrice(checkout.applied_credit)}`;
    checkoutCreditsRow.classList.remove("hidden");
  } else {
    checkoutCreditsRow.classList.add("hidden");
  }

  if (checkout.coupon_credit > 0) {
    checkoutCoupon.textContent = `-${formatPrice(checkout.coupon_credit)}`;
    checkoutCouponRow.classList.remove("hidden");
  } else {
    checkoutCouponRow.classList.add("hidden");
  }

  checkoutSection.classList.remove("hidden");
}

function renderBasket(data: { items: BasketItem[]; checkout?: CheckoutData; count?: number }) {
  basketItemsEl.innerHTML = "";
  loadingEl.classList.add("hidden");

  const items = data.items || [];
  const count = data.count ?? items.length;

  if (items.length === 0) {
    emptyStateEl.classList.remove("hidden");
    checkoutSection.classList.add("hidden");
    actionsEl.classList.add("hidden");
    itemCountEl.textContent = "";
    return;
  }

  emptyStateEl.classList.add("hidden");
  actionsEl.classList.remove("hidden");
  itemCountEl.textContent = `${count} item${count !== 1 ? "s" : ""}`;

  items.forEach((item) => {
    basketItemsEl.appendChild(renderBasketItem(item));
  });

  if (data.checkout) {
    renderCheckout(data.checkout);
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function loadBasket() {
  loadingEl.classList.remove("hidden");
  loadingEl.textContent = "Loading basket...";
  emptyStateEl.classList.add("hidden");

  try {
    const result = await app.callServerTool({
      name: "get_basket_summary",
      arguments: {},
    });

    const text = result.content?.find((c: any) => c.type === "text")?.text;
    if (text) {
      const data = JSON.parse(text);
      renderBasket(data);
    }
  } catch (e) {
    console.error("Failed to load basket:", e);
    loadingEl.textContent = "Failed to load basket.";
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

refreshBtn.addEventListener("click", () => {
  loadBasket();
});

let clearConfirmPending = false;
let clearConfirmTimer: ReturnType<typeof setTimeout> | undefined;

clearBtn.addEventListener("click", async () => {
  if (!clearConfirmPending) {
    clearConfirmPending = true;
    clearBtn.textContent = "CONFIRM CLEAR?";
    clearBtn.classList.add("btn-danger-confirm");
    clearConfirmTimer = setTimeout(() => {
      clearConfirmPending = false;
      clearBtn.textContent = "Clear Basket";
      clearBtn.classList.remove("btn-danger-confirm");
    }, 4000);
    return;
  }

  clearTimeout(clearConfirmTimer);
  clearConfirmPending = false;
  clearBtn.classList.remove("btn-danger-confirm");
  clearBtn.textContent = "CLEARING...";
  clearBtn.disabled = true;
  try {
    await app.callServerTool({
      name: "basket_clear_all",
      arguments: {},
    });
    loadBasket();
  } catch (e) {
    console.error("Clear failed:", e);
  } finally {
    clearBtn.textContent = "Clear Basket";
    clearBtn.disabled = false;
  }
});

let sendConfirmPending = false;
let sendConfirmTimer: ReturnType<typeof setTimeout> | undefined;

sendBtn.addEventListener("click", async () => {
  if (!sendConfirmPending) {
    // First click — show confirmation state
    sendConfirmPending = true;
    sendBtn.textContent = "CONFIRM SEND?";
    sendBtn.classList.add("btn-send-confirm");
    // Auto-reset after 4 seconds if not confirmed
    sendConfirmTimer = setTimeout(() => {
      sendConfirmPending = false;
      sendBtn.textContent = "SEND!";
      sendBtn.classList.remove("btn-send-confirm");
    }, 4000);
    return;
  }

  // Second click — confirmed, send the basket
  clearTimeout(sendConfirmTimer);
  sendConfirmPending = false;
  sendBtn.classList.remove("btn-send-confirm");
  sendBtn.textContent = "SENDING...";
  sendBtn.disabled = true;
  try {
    await app.callServerTool({
      name: "basket_send",
      arguments: {},
    });
    loadBasket();
  } catch (e) {
    console.error("Send failed:", e);
    sendBtn.textContent = "SEND!";
    sendBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// MCP App lifecycle
// ---------------------------------------------------------------------------

app.ontoolresult = (result: CallToolResult) => {
  try {
    const text = result.content?.find((c: any) => c.type === "text")?.text;
    if (!text) return;
    const data = JSON.parse(text);
    renderBasket(data);
  } catch (e) {
    console.error("Error processing tool result:", e);
  }
};

app.onerror = console.error;
app.connect();
