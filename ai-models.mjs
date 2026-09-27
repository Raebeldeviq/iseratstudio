export const DEFAULT_AI_MODEL = "gpt-6-luna";

export const AI_MODEL_OPTIONS = Object.freeze([
  Object.freeze({ id: DEFAULT_AI_MODEL, label: "Günstige Empfehlung · GPT-6 Luna" }),
  Object.freeze({ id: "gpt-5.6-terra", label: "Mehr Qualitätsreserve · GPT-5.6 Terra" }),
  Object.freeze({ id: "gpt-5.6-sol", label: "Maximale Textqualität · GPT-5.6 Sol" }),
]);

const SUPPORTED_MODELS = new Set(AI_MODEL_OPTIONS.map(({ id }) => id));

export function normalizeAiModel(value) {
  return SUPPORTED_MODELS.has(value) ? value : DEFAULT_AI_MODEL;
}
