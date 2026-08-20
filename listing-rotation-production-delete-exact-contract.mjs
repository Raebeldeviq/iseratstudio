export const EXACT_PRODUCTION_DELETE_PATH = "/production-delete/run-exact";

export const EXACT_PRODUCTION_DELETE_TARGETS = Object.freeze([
  "30460-574320",
  "30460-268065",
]);

export function requireExactProductionDeleteTarget(value) {
  const target = String(value || "").trim();
  if (!EXACT_PRODUCTION_DELETE_TARGETS.includes(target)) {
    const error = new Error("Der manuelle Einzellauf ist ausschließlich für die zwei ausdrücklich freigegebenen offenen Sources zulässig.");
    error.code = "PRODUCTION_DELETE_EXACT_TARGET_NOT_AUTHORIZED";
    throw error;
  }
  return target;
}
