import { App } from "@modelcontextprotocol/ext-apps";
import renderCardToSvg, { type CardSpec } from "./postcard-renderer.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface FontInfo {
  id: string | number;
  name: string;
  label: string;
  mainFontUrl?: string;
  line_spacing?: number;
}

interface WritingData {
  message: string;
  wishes: string;
  inkColor: string;
  card: { width: number; height: number; padding: number[] };
  selectedFont: FontInfo;
  fontBase64: string | null;
  fonts: FontInfo[];
}

let state: WritingData | null = null;
let loadedFontBase64: string | null = null;
let loadedFontFamily: string | null = null;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const previewEl = document.getElementById("preview")!;
const fontSelect = document.getElementById("font-select") as HTMLSelectElement;

// ---------------------------------------------------------------------------
// MCP App instance (declared early so font loader can use it)
// ---------------------------------------------------------------------------

const app = new App({ name: "writing-preview", version: "1.0.0" });

// ---------------------------------------------------------------------------
// Font Loading (via MCP tool to bypass sandbox CSP)
// ---------------------------------------------------------------------------

async function loadFont(url: string): Promise<string> {
  const result = await app.callServerTool({
    name: "get_font_file",
    arguments: { url },
  });
  const text = (result.content as any)?.find((c: any) => c.type === "text")?.text;
  if (text) {
    const data = JSON.parse(text);
    if (data.base64) return data.base64;
  }
  throw new Error("Failed to load font via MCP");
}

function injectFontFace(familyName: string, base64: string): void {
  // Remove previous injected style if any
  const existing = document.getElementById("hw-font-style");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "hw-font-style";
  style.textContent = `
    @font-face {
      font-family: '${familyName}';
      src: url(data:font/truetype;base64,${base64}) format('truetype');
      font-weight: normal;
      font-style: normal;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function renderPreview(): Promise<void> {
  if (!state) return;

  const font = state.selectedFont;

  if (!state.fontBase64) {
    previewEl.innerHTML = `<div class="loading">No font data available</div>`;
    return;
  }

  // Load font if not already loaded for this font
  const fontFamily = `hw-${font.id}`;
  if (loadedFontFamily !== fontFamily) {
    previewEl.innerHTML = `<div class="loading">Loading font…</div>`;
    try {
      loadedFontBase64 = state.fontBase64;
      loadedFontFamily = fontFamily;
      injectFontFace(fontFamily, loadedFontBase64);

      // Wait for font to be usable
      await document.fonts.ready;
    } catch (e: any) {
      previewEl.innerHTML = `<div class="loading">Error loading font: ${e.message}</div>`;
      return;
    }
  }

  const cardSpec: CardSpec = {
    card: {
      width: state.card.width,
      height: state.card.height,
      padding: state.card.padding as [number, number, number, number],
    },
    message: {
      text: state.message,
      fontFamily,
      lineHeight: font.line_spacing ?? 1.2,
    },
    wishes: state.wishes ? { text: state.wishes } : undefined,
    fonts: {
      main: {
        name: fontFamily,
        ttfBase64: loadedFontBase64!,
      },
    },
    inkColor: state.inkColor,
  };

  const svg = renderCardToSvg(cardSpec);
  previewEl.innerHTML = svg;
}

// ---------------------------------------------------------------------------
// Font Selector
// ---------------------------------------------------------------------------

function populateFontSelect(fonts: FontInfo[], selectedId: string | number): void {
  fontSelect.innerHTML = "";
  for (const f of fonts) {
    const opt = document.createElement("option");
    opt.value = String(f.id);
    opt.textContent = f.label || f.name;
    if (String(f.id) === String(selectedId)) opt.selected = true;
    fontSelect.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// MCP App event handlers
// ---------------------------------------------------------------------------

// Extract JSON from MCP result text (handles wrapped responses)
function extractJson(text: string): string {
  // Try as-is first
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  // Try to find JSON object in the string
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) return trimmed.slice(jsonStart);
  return "{}";
}

app.ontoolresult = async (result) => {
  try {
    const textContent = result.content?.find((c) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data: WritingData = JSON.parse(extractJson(text));
    state = data;

    // If fontBase64 not in initial result, fetch via MCP tool
    if (!state.fontBase64 && state.selectedFont?.mainFontUrl) {
      try {
        const fontResult = await app.callServerTool({
          name: "get_font_file",
          arguments: { url: state.selectedFont.mainFontUrl },
        });
        const ft = fontResult.content?.find((c: any) => c.type === "text");
        const ftText = ft && "text" in ft ? ft.text : "{}";
        const ftData = JSON.parse(extractJson(ftText));
        if (ftData.base64) state.fontBase64 = ftData.base64;
      } catch { /* will show "No font data" */ }
    }

    populateFontSelect(data.fonts, data.selectedFont.id);
    await renderPreview();
  } catch (e: any) {
    previewEl.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
};

fontSelect.addEventListener("change", async () => {
  if (!state) return;

  const fontId = fontSelect.value;

  // Always fetch from server (need font base64 data)
  try {
    previewEl.innerHTML = `<div class="loading">Loading font…</div>`;
    const result = await app.callServerTool({
      name: "get_writing_data",
      arguments: { fontId },
    });

    const textContent = result.content?.find((c) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data = JSON.parse(extractJson(text));

    state.selectedFont = data.selectedFont;
    state.fontBase64 = data.fontBase64;
    if (data.card) {
      state.card = data.card;
    }

    await renderPreview();
  } catch (e: any) {
    previewEl.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
});

// Handle theme changes
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme === "dark") {
    document.documentElement.style.setProperty("--bg", "#1e1e1e");
    document.documentElement.style.setProperty("--fg", "#e0e0e0");
    document.documentElement.style.setProperty("--border", "#444");
    document.documentElement.style.setProperty("--input-bg", "#2a2a2a");
  } else {
    document.documentElement.style.setProperty("--bg", "#ffffff");
    document.documentElement.style.setProperty("--fg", "#1a1a1a");
    document.documentElement.style.setProperty("--border", "#e0e0e0");
    document.documentElement.style.setProperty("--input-bg", "#fff");
  }
};

app.connect();
