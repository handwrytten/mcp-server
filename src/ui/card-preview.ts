/**
 * Card Preview MCP App — interactive 3D card browser.
 *
 * Renders inside the Claude conversation as a sandboxed iframe.
 * Uses the same 3D flip animation as app.handwrytten.com/cards.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import lottie from "lottie-web/build/player/lottie_light";
import writeMessageAnimationData from "./write-message-animation.json";
import "./card-preview.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CardImage {
  id?: number;
  image: string;
  image_lowres?: string | null;
}

// Prefer lowres image, ensure CDN URL
function pickImageUrl(img?: CardImage | null, fallback?: string): string {
  const url = img?.image_lowres || img?.image || fallback || "";
  return url.replace("https://d3e924qpzqov0g.cloudfront.net", "https://cdn.handwrytten.com");
}

// Full-res fallback URL
function pickFullResUrl(img?: CardImage | null, fallback?: string): string {
  const url = img?.image || fallback || "";
  return url.replace("https://d3e924qpzqov0g.cloudfront.net", "https://cdn.handwrytten.com");
}

interface Card {
  id: number;
  name: string;
  cover: string;
  price: string;
  discount_price: string | null;
  orientation: "L" | "P" | "F";
  category_id: number;
  detailed_images?: {
    front?: CardImage;
    inside?: CardImage;
    back?: CardImage;
  };
}

interface Category {
  id: number;
  name: string;
}

type View = "front" | "inside" | "back";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let categories: Category[] = [];
let currentPage = 1;
let currentCategoryId: number | undefined;
let currentQuery: string | undefined;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const cardsGrid = document.getElementById("cards-grid")!;
const categorySelect = document.getElementById(
  "category-select"
) as HTMLSelectElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const loadMoreBtn = document.getElementById("load-more-btn")!;
const loadingEl = document.getElementById("loading")!;

// ---------------------------------------------------------------------------
// MCP App instance (declared early so image fetchers can use it)
// ---------------------------------------------------------------------------

const app = new App({ name: "Card Preview", version: "1.0.0" });

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Load images via MCP tool call (bypasses sandbox CSP restrictions since it
// uses postMessage, not HTTP). The server fetches the image and returns base64.
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
    // Look for MCP image content block
    const imgBlock = (result.content as any)?.find((c: any) => c.type === "image");
    if (imgBlock?.data && imgBlock?.mimeType) {
      const dataUri = `data:${imgBlock.mimeType};base64,${imgBlock.data}`;
      b64Cache.set(url, dataUri);
      return dataUri;
    }
  } catch (e) {
    console.error("Failed to fetch image via MCP:", url, e);
  }
  return "";
}

// Try lowres first, fall back to full-res on failure
async function fetchImageWithFallback(
  img?: CardImage | null,
  fallback?: string
): Promise<string> {
  const lowres = pickImageUrl(img, fallback);
  if (lowres) {
    const result = await fetchImageViaMcp(lowres);
    if (result) return result;
  }
  // Fallback to full-res if lowres failed
  const fullres = pickFullResUrl(img, fallback);
  if (fullres && fullres !== lowres) {
    return fetchImageViaMcp(fullres);
  }
  return "";
}

async function loadFrontImage(card: Card, el: HTMLElement): Promise<void> {
  // Use card.cover for the front face (matches webapp behavior).
  // detailed_images.front is a different image for folded cards.
  const frontDataUri = await fetchImageViaMcp(
    pickImageUrl(undefined, card.cover)
  );
  const img = el.querySelector(".front-face img") as HTMLImageElement;
  if (img && frontDataUri) {
    img.src = frontDataUri;
    img.classList.add("loaded");
  }
  // Pre-load inside images right after front so they're ready before hover
  if (!card.detailed_images?.inside && card.orientation === "F") return;
  loadSecondaryImages(card, el);
}

async function loadSecondaryImages(card: Card, el: HTMLElement): Promise<void> {
  const insideFace = el.querySelector(".inside-face") as HTMLElement;
  const innerMaskImg = el.querySelector(".inner-mask > div") as HTMLElement;
  const backFace = el.querySelector(".back-face") as HTMLElement;
  if (insideFace?.dataset.loaded && backFace?.dataset.loaded) return;

  const [insideDataUri, backDataUri] = await Promise.all([
    insideFace && !insideFace.dataset.loaded
      ? fetchImageWithFallback(card.detailed_images?.inside)
      : Promise.resolve(""),
    backFace && !backFace.dataset.loaded
      ? fetchImageWithFallback(card.detailed_images?.back)
      : Promise.resolve(""),
  ]);

  if (insideFace && insideDataUri) {
    insideFace.style.backgroundImage = `url('${insideDataUri}')`;
    insideFace.dataset.loaded = "1";
    // Also set the inner-mask (back of front cover) with mirrored inside image
    if (innerMaskImg) {
      innerMaskImg.style.backgroundImage = `url('${insideDataUri}')`;
    }
  }
  if (backFace && backDataUri) {
    backFace.style.backgroundImage = `url('${backDataUri}')`;
    backFace.dataset.loaded = "1";
  }
}

function createCardElement(card: Card): HTMLElement {
  const isFlat = card.orientation === "F";
  const orientationClass =
    card.orientation === "L"
      ? "postcard__side_horizontal"
      : "postcard__side_vertical";

  // Portrait cards flip on Y axis (like a book), landscape on X axis (like a notepad)
  const isPortrait = card.orientation !== "L";
  const mirrorTransform = isPortrait ? "scaleX(-1)" : "scaleY(-1)";

  const el = document.createElement("div");
  el.className = "card-item";

  // Header: name + price
  const priceDisplay = card.discount_price || card.price;
  el.innerHTML = `
    <div class="card-header">
      <span class="card-name" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</span>
      <span class="card-price">$${priceDisplay}</span>
    </div>
    <div class="scene-3d">
      <div class="postcard__side ${orientationClass} front">
        <div class="front-face">
          <img alt="${escapeHtml(card.name)}" />
          <div class="image-spinner"></div>
        </div>
        ${!isFlat ? `<div class="front-face inner-mask">
          <div style="transform: ${mirrorTransform}"></div>
        </div>` : ""}
        <div class="inside-face"><div class="write-message-anim"></div></div>
        <div class="back-face">${isFlat ? '<div class="write-message-anim"></div>' : ""}</div>
      </div>
    </div>
    <div class="card-footer">
      <ul class="card__preview">
        <li class="active" data-view="front">Front</li>
        ${!isFlat ? `<li data-view="inside">Inside</li>` : ""}
        <li data-view="back">Back</li>
      </ul>
      <button class="select-btn" data-card-id="${card.id}">Select</button>
    </div>
  `;

  // Front image is loaded via the queue; inside/back load lazily on hover
  const scene = el.querySelector(".scene-3d") as HTMLElement;
  const postcardSide = el.querySelector(".postcard__side") as HTMLElement;
  const tabs = el.querySelectorAll(".card__preview li");

  // Lottie animation instance — created lazily on first flip
  let lottieAnim: ReturnType<typeof lottie.loadAnimation> | null = null;
  let lottieContainer: HTMLElement | null = null;

  function playWriteAnimation() {
    // For folded cards, animate inside the inside-face; for flat cards, inside the back-face
    const targetSelector = isFlat ? ".back-face .write-message-anim" : ".inside-face .write-message-anim";
    const container = el.querySelector(targetSelector) as HTMLElement;
    if (!container) {
      console.error("[write-anim] container not found:", targetSelector);
      return;
    }

    if (!lottieAnim || lottieContainer !== container) {
      // Destroy previous instance if targeting a different container
      if (lottieAnim) { lottieAnim.destroy(); lottieAnim = null; }
      lottieContainer = container;
      container.innerHTML = "";
      try {
        console.log("[write-anim] loading lottie, container size:", container.offsetWidth, "x", container.offsetHeight);
        console.log("[write-anim] lottie module:", typeof lottie, typeof lottie?.loadAnimation);
        lottieAnim = lottie.loadAnimation({
          container,
          renderer: "svg",
          loop: false,
          autoplay: true,
          animationData: writeMessageAnimationData,
        });
        console.log("[write-anim] animation loaded:", !!lottieAnim);
      } catch (e) {
        console.error("[write-anim] lottie error:", e);
      }
    } else {
      // Replay from start
      lottieAnim.goToAndPlay(0);
    }
  }

  function stopWriteAnimation() {
    if (lottieAnim) {
      lottieAnim.goToAndStop(0);
    }
  }

  let currentView: View = "front";

  function setView(view: View) {
    if (view === "inside" && isFlat) return;
    currentView = view;

    // Remove all view classes
    postcardSide.classList.remove("front", "inside", "back");
    postcardSide.classList.add(view);

    // Update active tab
    tabs.forEach((tab) => {
      const tabView = (tab as HTMLElement).dataset.view;
      tab.classList.toggle("active", tabView === view);
    });

    // Play or stop the handwriting animation
    const shouldAnimate = isFlat ? view === "back" : view === "inside";
    if (shouldAnimate) {
      playWriteAnimation();
    } else {
      stopWriteAnimation();
    }
  }

  // Hover events — also triggers lazy load of inside/back images
  scene.addEventListener("mouseenter", () => {
    loadSecondaryImages(card, el);
    if (currentView === "front") {
      setView(isFlat ? "back" : "inside");
    }
  });

  scene.addEventListener("mouseleave", () => {
    setView("front");
  });

  // Tab clicks
  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      loadSecondaryImages(card, el);
      const view = (tab as HTMLElement).dataset.view as View;
      setView(view);
    });
  });

  // Select button — tell Claude which card was chosen
  const selectBtn = el.querySelector(".select-btn") as HTMLButtonElement;
  selectBtn.addEventListener("click", () => {
    app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `I'd like to use card: "${card.name}" (ID: ${card.id}, Price: $${card.discount_price || card.price})` }],
    });
  });

  return el;
}

// Queue for loading front images — limits concurrent MCP tool calls
const imageLoadQueue: Array<{ card: Card; el: HTMLElement }> = [];
let imageLoadRunning = 0;
const MAX_CONCURRENT_LOADS = 1;

async function processImageQueue() {
  while (imageLoadQueue.length > 0 && imageLoadRunning < MAX_CONCURRENT_LOADS) {
    const item = imageLoadQueue.shift();
    if (!item) break;
    imageLoadRunning++;
    loadFrontImage(item.card, item.el).finally(() => {
      imageLoadRunning--;
      processImageQueue();
    });
  }
}

function renderCards(cards: Card[], append = false) {
  if (!append) {
    cardsGrid.innerHTML = "";
  }

  cards.forEach((card) => {
    const el = createCardElement(card);
    cardsGrid.appendChild(el);
    // Queue image loading instead of loading all at once
    imageLoadQueue.push({ card, el });
  });
  processImageQueue();

  loadingEl.classList.add("hidden");
  loadMoreBtn.style.display = cards.length >= 4 ? "block" : "none";
}

function populateCategories(cats: Category[]) {
  categories = cats;
  categorySelect.innerHTML = '<option value="">All Categories</option>';
  cats.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = String(cat.id);
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchCards(
  categoryId?: number,
  page = 1,
  query?: string,
  append = false
) {
  loadingEl.classList.remove("hidden");
  loadingEl.textContent = append ? "Loading more..." : "Loading cards...";

  try {
    const result = await app.callServerTool({
      name: "get_cards_detailed",
      arguments: {
        ...(categoryId != null ? { categoryId } : {}),
        page,
        perPage: 10,
        ...(query ? { query } : {}),
      },
    });

    const text = result.content?.find((c: any) => c.type === "text")?.text;
    if (text) {
      const data = JSON.parse(text);
      renderCards(data.cards, append);
      currentPage = page;
    }
  } catch (e) {
    console.error("Failed to fetch cards:", e);
    loadingEl.textContent = "Failed to load cards.";
    loadingEl.classList.remove("hidden");
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

let searchTimeout: ReturnType<typeof setTimeout>;

categorySelect.addEventListener("change", () => {
  const val = categorySelect.value;
  currentCategoryId = val ? parseInt(val, 10) : undefined;
  currentPage = 1;
  fetchCards(currentCategoryId, 1, currentQuery);
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentQuery = searchInput.value.trim() || undefined;
    currentPage = 1;
    fetchCards(currentCategoryId, 1, currentQuery);
  }, 400);
});

loadMoreBtn.addEventListener("click", () => {
  fetchCards(currentCategoryId, currentPage + 1, currentQuery, true);
});

// ---------------------------------------------------------------------------
// MCP App event handlers
// ---------------------------------------------------------------------------

app.ontoolresult = (result: CallToolResult) => {
  try {
    const text = result.content?.find((c: any) => c.type === "text")?.text;
    if (!text) return;

    const data = JSON.parse(text);

    if (data.categories) {
      populateCategories(data.categories);
    }

    if (data.cards) {
      renderCards(data.cards);
    }
  } catch (e) {
    console.error("Error processing tool result:", e);
  }
};

app.onerror = console.error;

app.connect();
