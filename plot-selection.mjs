export function plotListingCountAppearance(value) {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  return {
    count,
    tone: count >= 4 ? "green" : count > 0 ? "yellow" : "neutral",
    detail: count > 4 ? "Mehr als 4 Inserate vorhanden" : "",
  };
}
