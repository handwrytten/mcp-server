import { App } from "@modelcontextprotocol/ext-apps";
import "./writing-preview.css";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface FontInfo {
  id: string | number;
  label: string;
}

interface WritingData {
  pngBase64: string;
  renderError?: string;
  selectedFont: FontInfo;
  fonts?: FontInfo[];
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

const app = new App(
  { name: "writing-preview", version: "2.0.0" },
  {},
  { autoResize: true },
);

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
    opt.textContent = f.label;
    if (String(f.id) === String(selectedId)) opt.selected = true;
    fontSelect.appendChild(opt);
  }
}

function renderPreview(data: WritingData): void {
  if (data.pngBase64) {
    previewEl.innerHTML = `<img src="data:image/png;base64,${data.pngBase64}" alt="Writing Preview" style="width:100%; display:block; border-radius:4px;" />`;
  } else if (data.renderError) {
    previewEl.innerHTML = `<div class="loading">Error: ${data.renderError}</div>`;
  } else {
    previewEl.innerHTML = `<div class="loading">No preview available</div>`;
  }
}

// Initial tool result from Preview-Writing
app.ontoolresult = async (result) => {
  try {
    const textContent = result.content?.find((c: any) => c.type === "text");
    const rawText = textContent && "text" in textContent ? textContent.text : null;
    const data: WritingData = JSON.parse(extractJson(rawText || "{}"));
    state = data;

    if (data.fonts) {
      populateFontSelect(data.fonts, data.selectedFont?.id);
    }
    renderPreview(data);
  } catch (e: any) {
    previewEl.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
};

// Font selector — re-render with new font via server
fontSelect.addEventListener("change", async () => {
  if (!state) return;

  const fontId = fontSelect.value;

  try {
    previewEl.innerHTML = `<div class="loading">Rendering…</div>`;
    const result = await app.callServerTool({
      name: "preview_writing",
      arguments: {
        fontId,
        message: state.message || "",
        wishes: state.wishes || "",
        inkColor: state.inkColor || "#0040ac",
      },
    });

    const textContent = result.content?.find((c: any) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data: WritingData = JSON.parse(extractJson(text));

    // Keep fonts list from original state
    data.fonts = state.fonts;
    data.message = state.message;
    data.wishes = state.wishes;
    data.inkColor = state.inkColor;
    state = data;

    renderPreview(data);
  } catch (e: any) {
    previewEl.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
});

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
