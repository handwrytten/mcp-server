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
  cardId?: string;
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
const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement;
let currentPng: string | null = null;

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

// Build the preview image data URI from the tool result. The PNG travels in
// _meta (a UI-only channel the host forwards to the app but keeps out of the
// model's context), so it's self-contained — no server round-trip to load it.
// Falls back to an image content block if present, for resilience.
function imageDataUri(result: any): string | null {
  const metaPng = result?._meta?.["handwrytten/previewPng"];
  if (metaPng) return `data:image/png;base64,${metaPng}`;
  const img = result?.content?.find((c: any) => c.type === "image");
  if (img && "data" in img && img.data) {
    return `data:${img.mimeType || "image/png"};base64,${img.data}`;
  }
  return null;
}

function renderPreview(dataUri: string | null, data: WritingData): void {
  currentPng = dataUri?.startsWith("data:image/png;base64,") ? dataUri.slice("data:image/png;base64,".length) : null;
  downloadBtn.disabled = !currentPng;
  if (dataUri) {
    previewEl.innerHTML = `<img src="${dataUri}" alt="Writing Preview" style="width:100%; display:block; border-radius:4px;" />`;
  } else if (data.renderError) {
    previewEl.textContent = `Error: ${data.renderError}`;
  } else {
    previewEl.innerHTML = `<div class="loading">No preview available</div>`;
  }
}

// Initial tool result from preview_writing
app.ontoolresult = async (result) => {
  try {
    if (result.isError) throw new Error(result.content?.find(c => c.type === "text")?.text || "Preview failed");
    const textContent = result.content?.find((c: any) => c.type === "text");
    const rawText = textContent && "text" in textContent ? textContent.text : null;
    const data: WritingData = JSON.parse(extractJson(rawText || "{}"));
    state = data;

    if (data.fonts) {
      populateFontSelect(data.fonts, data.selectedFont?.id);
    }
    renderPreview(imageDataUri(result), data);
  } catch (e: any) {
    previewEl.textContent = `Error: ${e.message}`;
  }
};

// Font selector — re-render with new font via server
fontSelect.addEventListener("change", async () => {
  if (!state) return;

  const fontId = fontSelect.value;

  try {
    downloadBtn.disabled = true;
    previewEl.innerHTML = `<div class="loading">Rendering…</div>`;
    const result = await app.callServerTool({
      name: "render_writing_preview",
      arguments: {
        fontId,
        ...(state.cardId ? { cardId: state.cardId } : {}),
        message: state.message || "",
        wishes: state.wishes || "",
        inkColor: state.inkColor || "#0040ac",
      },
    });

    if (result.isError) throw new Error(result.content?.find(c => c.type === "text")?.text || "Preview failed");

    const textContent = result.content?.find((c: any) => c.type === "text");
    const text = textContent && "text" in textContent ? textContent.text : "{}";
    const data: WritingData = JSON.parse(extractJson(text));

    // Keep fonts list from original state
    data.cardId = state.cardId;
    data.fonts = state.fonts;
    data.message = state.message;
    data.wishes = state.wishes;
    data.inkColor = state.inkColor;
    state = data;

    renderPreview(imageDataUri(result), data);
  } catch (e: any) {
    previewEl.textContent = `Error: ${e.message}`;
  }
});

// Sandboxed iframes can't download directly; the host saves the file (usually after a confirmation).
downloadBtn.addEventListener("click", async () => {
  if (!currentPng) return;
  const font = String(state?.selectedFont?.label || "preview").trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  try {
    const { isError } = await app.downloadFile({
      contents: [{
        type: "resource",
        resource: { uri: `file:///handwrytten-${font}.png`, mimeType: "image/png", blob: currentPng },
      }],
    });
    if (isError) console.warn("Download denied or cancelled");
  } catch (e) {
    console.error("Download failed:", e);
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

app.connect().then(() => {
  downloadBtn.hidden = !app.getHostCapabilities()?.downloadFile;
});
