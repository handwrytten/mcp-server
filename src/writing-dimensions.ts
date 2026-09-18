import type { Card } from "handwrytten";

export function writingDimensions(card: Card | null) {
  if (!card) return { width: 672, height: 480, padding: [28.8, 28.8, 28.8, 28.8] as [number, number, number, number] };
  const raw = card.raw;
  const inches = (value: unknown, name: string, allowZero = false): number => {
    const n = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
      throw new Error(`Card ${card.id} has invalid ${name}; cannot render accurate dimensions.`);
    }
    return n * 96;
  };
  const width = inches(raw.closed_width, "width");
  const height = inches(raw.closed_height, "height");
  const padding = ["top", "right", "bottom", "left"].map(side =>
    inches(raw[`preview_margin_${side}`] ?? raw[`margin_${side}`] ?? 0.3, `${side} margin`, true)
  ) as [number, number, number, number];
  if (padding[1] + padding[3] >= width || padding[0] + padding[2] >= height) {
    throw new Error(`Card ${card.id} margins leave no writing area.`);
  }
  return { width, height, padding };
}
