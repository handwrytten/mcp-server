import { App } from "@modelcontextprotocol/ext-apps";
import "./writing-preview.css";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface FontInfo {
  id: string | number;
  name: string;
  label: string;
}

interface WritingData {
  svg: string;
  renderError?: string;
  selectedFont: FontInfo;
  fonts: FontInfo[];
  // Kept for re-rendering on font switch
  message?: string;
  wishes?: string;
  inkColor?: string;
}

let state: WritingData | null = null;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const previewEl = document.getElementById("preview")!;
const fontSelect = document.getElementById("font-select") as HTMLSelectElement;

// ---------------------------------------------------------------------------
// MCP App
// ---------------------------------------------------------------------------

const app = new App({ name: "writing-preview", version: "1.0.0" });

// Extract JSON from MCP result text (handles wrapped responses)
function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) return trimmed.slice(jsonStart);
  return "{}";
}

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

function renderSvg(svg: string, error?: string): void {
  if (svg) {
    previewEl.innerHTML = svg;
  } else {
    previewEl.innerHTML = `<div class="loading">${error || "No preview available"}</div>`;
  }
}

// Initial tool result from preview_writing
app.ontoolresult = async (result) => {
  try {
    const textContent = result.content?.find((c) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data: WritingData = JSON.parse(extractJson(text));
    state = data;

    populateFontSelect(data.fonts || [], data.selectedFont?.id);
    renderSvg(data.svg, data.renderError);
  } catch (e: any) {
    previewEl.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
};

// Font selector — re-render with new font via server
fontSelect.addEventListener("change", async () => {
  if (!state) return;

  const fontId = fontSelect.value;

  try {
    previewEl.innerHTML = `<div class="loading">Loading font…</div>`;
    const result = await app.callServerTool({
      name: "get_writing_data",
      arguments: {
        fontId,
        message: state.message || "",
        wishes: state.wishes || "",
        inkColor: state.inkColor || "#0040ac",
      },
    });

    const textContent = result.content?.find((c: any) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data = JSON.parse(extractJson(text));

    state.selectedFont = data.selectedFont;
    state.svg = data.svg;
    renderSvg(data.svg);
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
