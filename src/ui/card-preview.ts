/**
 * Card Preview MCP App — interactive 3D card browser.
 *
 * Renders inside the Claude conversation as a sandboxed iframe.
 * Uses the same 3D flip animation as app.handwrytten.com/cards.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./card-preview.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CardImage {
  id?: number;
  image: string;
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

function createCardElement(card: Card): HTMLElement {
  const isFlat = card.orientation === "F";
  const orientationClass =
    card.orientation === "L"
      ? "postcard__side_horizontal"
      : "postcard__side_vertical";

  const frontImg = card.detailed_images?.front?.image || card.cover || "";
  const insideImg = card.detailed_images?.inside?.image || "";
  const backImg = card.detailed_images?.back?.image || "";

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
          <img src="${escapeHtml(frontImg)}" alt="${escapeHtml(card.name)}" loading="lazy" />
        </div>
        <div class="inside-face" style="background-image: url('${escapeHtml(insideImg)}')"></div>
        <div class="back-face" style="background-image: url('${escapeHtml(backImg)}')"></div>
      </div>
    </div>
    <div class="card-footer">
      <ul class="card__preview">
        <li class="active" data-view="front">Front</li>
        ${!isFlat ? `<li data-view="inside">Inside</li>` : ""}
        <li data-view="back">Back</li>
      </ul>
    </div>
  `;

  // Get references
  const scene = el.querySelector(".scene-3d") as HTMLElement;
  const postcardSide = el.querySelector(".postcard__side") as HTMLElement;
  const tabs = el.querySelectorAll(".card__preview li");

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
  }

  // Hover events
  scene.addEventListener("mouseenter", () => {
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
      const view = (tab as HTMLElement).dataset.view as View;
      setView(view);
    });
  });

  return el;
}

function renderCards(cards: Card[], append = false) {
  if (!append) {
    cardsGrid.innerHTML = "";
  }

  cards.forEach((card) => {
    cardsGrid.appendChild(createCardElement(card));
  });

  loadingEl.classList.add("hidden");
  loadMoreBtn.style.display = cards.length >= 20 ? "block" : "none";
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
        perPage: 20,
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
