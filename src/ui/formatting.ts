/** Safe for both HTML text and quoted attribute values in widget templates. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function formatPrice(amount: unknown): string {
  if ((typeof amount !== "number" && typeof amount !== "string") ||
      (typeof amount === "string" && !amount.trim())) return "Unavailable";
  const value = Number(amount);
  return Number.isFinite(value) && value >= 0 ? `$${value.toFixed(2)}` : "Unavailable";
}
