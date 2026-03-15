/**
 * Server-side SVG postcard renderer using opentype.js.
 *
 * Mirrors the browser-based postcard-renderer exactly, but:
 * - Uses opentype.js for text measurement (instead of getBBox)
 * - Renders text as <path> elements (instead of <text> + @font-face)
 *
 * This bypasses all browser CSP restrictions since no font loading
 * is needed in the iframe.
 */

import opentype from "opentype.js";

// ---------------------------------------------------------------------------
// Constants (identical to browser renderer)
// ---------------------------------------------------------------------------

const SAFE_MAX_WIDTH = 0.98;
const SAFE_MAX_WIDTH_WISHES = 0.98;
const DEFAULT_LINE_HEIGHT = 0.6;
const EMPTY_LINE_DIVIDER = 4;
const MIN_WIDTH_WISHES = 0.45;
const MAX_WIDTH_WISHES = 0.7;
const MARGIN_AFTER_MESSAGE = 0.5;
const DEFAULT_CARD_WIDTH = 672;
const DEFAULT_CARD_HEIGHT = 480;
const DEFAULT_CARD_PADDING: [number, number, number, number] = [
  28.8, 28.8, 28.8, 28.8,
];
const MAX_FONT_SIZE_PX = 73.15;
const MIN_FONT_SIZE_PX = 13.15;

// ---------------------------------------------------------------------------
// Text measurement via opentype.js
// ---------------------------------------------------------------------------

const measureCache = new Map<string, { width: number; height: number }>();

function measureText(
  text: string,
  font: opentype.Font,
  fontSize: number
): { width: number; height: number } {
  if (!text) return { width: 0, height: 0 };

  const cacheKey = `${fontSize}|${text}`;
  if (measureCache.has(cacheKey)) {
    return measureCache.get(cacheKey)!;
  }

  const measureStr = text.replace(/ {2,}/g, (match) => {
    return ` ${"\u00A0".repeat(match.length - 1)}`;
  });

  const width = font.getAdvanceWidth(measureStr, fontSize);
  // Approximate height using font metrics
  const scale = fontSize / font.unitsPerEm;
  const height = (font.ascender - font.descender) * scale;

  const result = { width, height };
  measureCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Text wrapping (identical logic)
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  isEmpty: boolean;
}

function wrapText(
  text: string,
  font: opentype.Font,
  fontSize: number,
  maxWidth: number
): Line[] {
  const SAFE_WIDTH = maxWidth * SAFE_MAX_WIDTH;
  const lines: Line[] = [];

  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push({ text: "", isEmpty: true });
      continue;
    }

    const words = paragraph.split(/(\s+)/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;

      const testLine = currentLine + word;
      const testWidth = measureText(testLine, font, fontSize).width;

      if (testWidth > SAFE_WIDTH && currentLine) {
        lines.push({ text: currentLine.trimEnd(), isEmpty: false });
        currentLine = word.trimStart();
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push({ text: currentLine.trimEnd(), isEmpty: false });
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Font size calculation (identical logic)
// ---------------------------------------------------------------------------

function getLineHeight(fontSize: number, lineHeight = DEFAULT_LINE_HEIGHT) {
  return fontSize * lineHeight;
}

function calculateOptimalFontSize(
  text: string,
  font: opentype.Font,
  fontSizeArray: number[],
  maxWidth: number,
  maxHeight: number,
  lineHeight = DEFAULT_LINE_HEIGHT
): number {
  let low = 0;
  let high = fontSizeArray.length - 1;
  let bestIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const fontSize = fontSizeArray[mid];

    const lines = wrapText(text, font, fontSize, maxWidth);
    const lineSpacing = getLineHeight(fontSize, lineHeight);

    let totalHeight = 0;
    let isFirst = true;

    lines.forEach((line) => {
      if (line.isEmpty) {
        totalHeight += fontSize / EMPTY_LINE_DIVIDER;
      } else if (isFirst) {
        totalHeight += fontSize * lineHeight;
        isFirst = false;
      } else {
        totalHeight += lineSpacing;
      }
    });

    if (totalHeight <= maxHeight) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return fontSizeArray[bestIndex];
}

// ---------------------------------------------------------------------------
// Wishes dimensions (identical logic)
// ---------------------------------------------------------------------------

interface WishesDims {
  lines: Line[];
  fontSize: number;
  width: number;
  height: number;
  lineHeight: number;
}

function calculateWishesDimensions(
  wishesText: string,
  font: opentype.Font,
  fontSize: number,
  contentWidth: number,
  minFontSize: number,
  lineHeight: number
): WishesDims {
  if (!wishesText || wishesText.trim().length === 0) {
    return {
      lines: [],
      fontSize,
      width: contentWidth * MIN_WIDTH_WISHES,
      height: 0,
      lineHeight: getLineHeight(fontSize, lineHeight),
    };
  }

  let wishesWidth = contentWidth * MIN_WIDTH_WISHES;
  let currentFontSize = fontSize;
  let wishesLines: Line[];

  if (wishesText.length < 20) {
    wishesLines = [];
    const paragraphs = wishesText.split("\n");
    paragraphs.forEach((p) => {
      if (p.trim() === "") {
        wishesLines.push({ text: "", isEmpty: true });
      } else {
        wishesLines.push({ text: p, isEmpty: false });
      }
    });

    let needsExpansion = false;
    const textLines = wishesLines.filter((l) => !l.isEmpty);
    for (const line of textLines) {
      const lineWidth = measureText(line.text, font, currentFontSize).width;
      if (lineWidth > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
        needsExpansion = true;
        break;
      }
    }

    if (needsExpansion) {
      let foundFit = false;
      for (
        let pct = MIN_WIDTH_WISHES * 100 + 5;
        pct <= MAX_WIDTH_WISHES * 100;
        pct += 5
      ) {
        wishesWidth = contentWidth * (pct / 100);
        let allFit = true;
        for (const line of textLines) {
          const w = measureText(line.text, font, currentFontSize).width;
          if (w > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
            allFit = false;
            break;
          }
        }
        if (allFit) {
          foundFit = true;
          break;
        }
      }

      if (!foundFit) {
        wishesWidth = contentWidth * MAX_WIDTH_WISHES;
        while (currentFontSize > minFontSize) {
          currentFontSize -= 1;
          wishesLines = wrapText(
            wishesText,
            font,
            currentFontSize,
            wishesWidth
          );
          let nowFits = true;
          for (const line of wishesLines.filter((l) => !l.isEmpty)) {
            const w = measureText(line.text, font, currentFontSize).width;
            if (w > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
              nowFits = false;
              break;
            }
          }
          if (nowFits) break;
        }
      }
    }
  } else {
    wishesLines = wrapText(wishesText, font, currentFontSize, wishesWidth);

    let needsExpansion = false;
    for (const line of wishesLines.filter((l) => !l.isEmpty)) {
      const w = measureText(line.text, font, currentFontSize).width;
      if (w > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
        needsExpansion = true;
        break;
      }
    }

    if (needsExpansion) {
      let foundFit = false;
      for (
        let pct = MIN_WIDTH_WISHES * 100 + 5;
        pct <= MAX_WIDTH_WISHES * 100;
        pct += 5
      ) {
        wishesWidth = contentWidth * (pct / 100);
        wishesLines = wrapText(wishesText, font, currentFontSize, wishesWidth);
        let allFit = true;
        for (const line of wishesLines.filter((l) => !l.isEmpty)) {
          const w = measureText(line.text, font, currentFontSize).width;
          if (w > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
            allFit = false;
            break;
          }
        }
        if (allFit) {
          foundFit = true;
          break;
        }
      }

      if (!foundFit) {
        wishesWidth = contentWidth * MAX_WIDTH_WISHES;
        while (currentFontSize > minFontSize) {
          currentFontSize -= 1;
          wishesLines = wrapText(
            wishesText,
            font,
            currentFontSize,
            wishesWidth
          );
          let nowFits = true;
          for (const line of wishesLines.filter((l) => !l.isEmpty)) {
            const w = measureText(line.text, font, currentFontSize).width;
            if (w > wishesWidth * SAFE_MAX_WIDTH_WISHES) {
              nowFits = false;
              break;
            }
          }
          if (nowFits) break;
        }
      }
    }
  }

  const wishesLineSpacing = getLineHeight(currentFontSize, lineHeight);
  let wishesHeight = 0;
  let isFirst = true;

  wishesLines.forEach((line) => {
    if (line.isEmpty) {
      wishesHeight += currentFontSize / EMPTY_LINE_DIVIDER;
    } else if (isFirst) {
      wishesHeight += currentFontSize * lineHeight;
      isFirst = false;
    } else {
      wishesHeight += wishesLineSpacing;
    }
  });

  return {
    lines: wishesLines,
    fontSize: currentFontSize,
    width: wishesWidth,
    height: wishesHeight,
    lineHeight: wishesLineSpacing,
  };
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export interface ServerCardSpec {
  card: {
    width?: number;
    height?: number;
    padding?: [number, number, number, number];
  };
  message: {
    text: string;
    maxFontSizePx?: number;
    minFontSizePx?: number;
    lineHeight?: number;
    textAlign?: "left" | "center" | "right";
  };
  wishes?: {
    text: string;
    lineHeight?: number;
  };
  inkColor?: string;
}

export function renderCardToSvgServer(
  spec: ServerCardSpec,
  font: opentype.Font
): string {
  const { card, message, wishes, inkColor = "#0040ac" } = spec;

  // Clear measurement cache for each render
  measureCache.clear();

  // Card dimensions
  const width = card.width || DEFAULT_CARD_WIDTH;
  const height = card.height || DEFAULT_CARD_HEIGHT;
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
    card.padding || DEFAULT_CARD_PADDING;

  const contentX = paddingLeft;
  const contentY = paddingTop;
  const contentWidth = width - paddingLeft - paddingRight;
  const contentHeight = height - paddingTop - paddingBottom;

  const messageLineHeight = message.lineHeight || DEFAULT_LINE_HEIGHT;
  const maxFontSize = message.maxFontSizePx || MAX_FONT_SIZE_PX;
  const minFontSize = message.minFontSizePx || MIN_FONT_SIZE_PX;
  const messageText = message.text;

  // Build font size array (1px increments)
  const fontSizeArray: number[] = [];
  for (let s = Math.round(minFontSize); s <= Math.round(maxFontSize); s++) {
    fontSizeArray.push(s);
  }

  // Calculate optimal message font size
  let messageFontSize = calculateOptimalFontSize(
    messageText,
    font,
    fontSizeArray,
    contentWidth,
    contentHeight,
    messageLineHeight
  );

  // Iterative refinement with wishes
  let iteration = 0;
  const maxIterations = 20;
  let converged = false;

  while (iteration < maxIterations && !converged) {
    iteration++;

    const messageLines = wrapText(messageText, font, messageFontSize, contentWidth);
    const messageLineSpacing = getLineHeight(messageFontSize, messageLineHeight);

    let messageHeight = 0;
    let isFirst = true;
    messageLines.forEach((line) => {
      if (line.isEmpty) {
        messageHeight += messageFontSize / EMPTY_LINE_DIVIDER;
      } else if (isFirst) {
        messageHeight += messageFontSize * messageLineHeight;
        isFirst = false;
      } else {
        messageHeight += messageLineSpacing;
      }
    });

    let wishesDims: WishesDims | null = null;
    if (wishes?.text) {
      wishesDims = calculateWishesDimensions(
        wishes.text,
        font,
        messageFontSize,
        contentWidth,
        minFontSize,
        wishes.lineHeight || messageLineHeight
      );
    }

    const marginTop = messageFontSize * MARGIN_AFTER_MESSAGE;
    let totalRequired = messageHeight;
    if (wishesDims) {
      totalRequired += marginTop + wishesDims.height;
    }

    const available = contentHeight - totalRequired;

    if (available < -5) {
      messageFontSize = Math.max(minFontSize, messageFontSize - 1);
    } else if (available > 50 && messageFontSize < maxFontSize) {
      const newSize = Math.min(maxFontSize, messageFontSize + 1);
      if (newSize - messageFontSize > 0.5) {
        messageFontSize = newSize;
      } else {
        converged = true;
      }
    } else {
      converged = true;
    }
  }

  // Final render
  const finalLines = wrapText(messageText, font, messageFontSize, contentWidth);
  const finalLineSpacing = getLineHeight(messageFontSize, messageLineHeight);

  let finalWishes: WishesDims | null = null;
  if (wishes?.text) {
    finalWishes = calculateWishesDimensions(
      wishes.text,
      font,
      messageFontSize,
      contentWidth,
      minFontSize,
      wishes.lineHeight || messageLineHeight
    );
  }

  // Build SVG with path elements (no @font-face needed)
  let svgContent = "";

  // Render message lines as paths
  let currentY = contentY;
  let isFirstLine = true;
  const textAlign = message.textAlign || "left";

  finalLines.forEach((line) => {
    if (line.isEmpty) {
      currentY += messageFontSize / EMPTY_LINE_DIVIDER;
      isFirstLine = false;
    } else {
      const yOffset = isFirstLine
        ? messageFontSize * messageLineHeight
        : finalLineSpacing;
      currentY += yOffset;

      let lineStartX = contentX;

      if (textAlign === "center") {
        const lineWidth = measureText(line.text, font, messageFontSize).width;
        lineStartX = contentX + (contentWidth - lineWidth) / 2;
      } else if (textAlign === "right") {
        const lineWidth = measureText(line.text, font, messageFontSize).width;
        lineStartX = contentX + contentWidth - lineWidth;
      }

      // Convert text to SVG path using opentype.js
      const path = font.getPath(line.text, lineStartX, currentY, messageFontSize);
      svgContent += `<path d="${path.toPathData(2)}" fill="${inkColor}"/>\n`;
      isFirstLine = false;
    }
  });

  // Render wishes as paths
  if (finalWishes && finalWishes.lines.length > 0) {
    currentY += messageFontSize * MARGIN_AFTER_MESSAGE;

    const wishesX = contentX + contentWidth - finalWishes.width;
    let wishesIsFirst = true;

    finalWishes.lines.forEach((line) => {
      if (line.isEmpty) {
        currentY += finalWishes!.fontSize / EMPTY_LINE_DIVIDER;
        wishesIsFirst = false;
      } else {
        if (wishesIsFirst) {
          const lh = wishes?.lineHeight || messageLineHeight;
          currentY += finalWishes!.fontSize * lh;
          wishesIsFirst = false;
        } else {
          currentY += finalWishes!.lineHeight;
        }

        const path = font.getPath(line.text, wishesX, currentY, finalWishes!.fontSize);
        svgContent += `<path d="${path.toPathData(2)}" fill="${inkColor}"/>\n`;
      }
    });
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${svgContent}</svg>`;
}
