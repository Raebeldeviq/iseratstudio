export const WORKFLOW_STATUS = Object.freeze({
  DRAFT: "draft",
  PREPARED: "prepared",
  SCHEDULED: "scheduled",
  PROCESSING: "processing",
  PUBLISHED: "published",
  TRANSFERRED_PENDING_IMPORT: "transferred_pending_import",
  BLOCKED: "blocked",
  FAILED: "failed",
  ARCHIVED: "archived",
  DELETED: "deleted",
});

export const WORKFLOW_STATUS_VALUES = Object.freeze(Object.values(WORKFLOW_STATUS));

export const WORKFLOW_STATUS_LABELS = Object.freeze({
  [WORKFLOW_STATUS.DRAFT]: "Entwurf",
  [WORKFLOW_STATUS.PREPARED]: "Vorbereitet",
  [WORKFLOW_STATUS.SCHEDULED]: "Eingeplant",
  [WORKFLOW_STATUS.PROCESSING]: "In Verarbeitung",
  [WORKFLOW_STATUS.PUBLISHED]: "Veröffentlicht",
  [WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT]: "Übertragen · Importbestätigung ausstehend",
  [WORKFLOW_STATUS.BLOCKED]: "Gesperrt",
  [WORKFLOW_STATUS.FAILED]: "Fehlgeschlagen",
  [WORKFLOW_STATUS.ARCHIVED]: "Archiviert",
  [WORKFLOW_STATUS.DELETED]: "Gelöscht",
});

const LEGACY_STATUS_MAP = Object.freeze({
  bereit: WORKFLOW_STATUS.DRAFT,
  entwurf: WORKFLOW_STATUS.DRAFT,
  "noch nicht ausgeführt": WORKFLOW_STATUS.DRAFT,
  "dry run erfolgreich": WORKFLOW_STATUS.PREPARED,
  "dry run ausgewählt": WORKFLOW_STATUS.PREPARED,
  "kopie vorbereitet": WORKFLOW_STATUS.PREPARED,
  "entwurf vorbereitet": WORKFLOW_STATUS.PREPARED,
  "entwurf wartet auf upload": WORKFLOW_STATUS.PREPARED,
  "vorbereitung abgeschlossen": WORKFLOW_STATUS.PREPARED,
  "fur tageslauf ausgewahlt": WORKFLOW_STATUS.SCHEDULED,
  lauft: WORKFLOW_STATUS.PROCESSING,
  "wird verarbeitet": WORKFLOW_STATUS.PROCESSING,
  "ubertragen · importbestatigung ausstehend": WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  "übertragen · importbestätigung ausstehend": WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  erfolgreich: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  "upload erfolgreich": WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  "inserat abgeschlossen": WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  ubersprungen: WORKFLOW_STATUS.BLOCKED,
  blockiert: WORKFLOW_STATUS.BLOCKED,
  gesperrt: WORKFLOW_STATUS.BLOCKED,
  fehlgeschlagen: WORKFLOW_STATUS.FAILED,
  "upload fehlgeschlagen": WORKFLOW_STATUS.FAILED,
  archiviert: WORKFLOW_STATUS.ARCHIVED,
  "durch erfolgreiche rotation ersetzt · loschung manuell prufen": WORKFLOW_STATUS.ARCHIVED,
  geloscht: WORKFLOW_STATUS.DELETED,
});

function normalizedLegacyStatus(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ");
}

export function normalizeWorkflowStatus(value, fallback = WORKFLOW_STATUS.DRAFT) {
  const direct = String(value ?? "").trim().toLocaleLowerCase("de-DE");
  if (WORKFLOW_STATUS_VALUES.includes(direct)) return direct;
  const normalized = normalizedLegacyStatus(value);
  if (LEGACY_STATUS_MAP[normalized]) return LEGACY_STATUS_MAP[normalized];
  if (/transferred.pending.import|ubertragen.*import|übertragen.*import/u.test(normalized)) return WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;
  if (/veröffentlicht|published/u.test(normalized)) return WORKFLOW_STATUS.PUBLISHED;
  if (/upload.*erfolgreich|inserat.*abgeschlossen|erfolgreich|success/u.test(normalized)) return WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;
  if (/vorbereitet|dry run/u.test(normalized)) return WORKFLOW_STATUS.PREPARED;
  if (/ausgewahlt|geplant|scheduled/u.test(normalized)) return WORKFLOW_STATUS.SCHEDULED;
  if (/verarbeit|lauft|processing/u.test(normalized)) return WORKFLOW_STATUS.PROCESSING;
  if (/fehl|error|failed/u.test(normalized)) return WORKFLOW_STATUS.FAILED;
  if (/archiv/u.test(normalized)) return WORKFLOW_STATUS.ARCHIVED;
  if (/losch|deleted/u.test(normalized)) return WORKFLOW_STATUS.DELETED;
  if (/sperr|block|ubersprung/u.test(normalized)) return WORKFLOW_STATUS.BLOCKED;
  return WORKFLOW_STATUS_VALUES.includes(fallback) ? fallback : WORKFLOW_STATUS.DRAFT;
}

export function workflowStatusLabel(value) {
  const status = normalizeWorkflowStatus(value);
  return WORKFLOW_STATUS_LABELS[status];
}

export function workflowStatusMessage(value, existingMessage = "") {
  const raw = String(value ?? "").trim();
  if (existingMessage) return String(existingMessage);
  return raw && !WORKFLOW_STATUS_VALUES.includes(raw) ? raw : workflowStatusLabel(raw);
}

export function isSuccessfulWorkflowStatus(value) {
  const status = normalizeWorkflowStatus(value);
  return status === WORKFLOW_STATUS.PREPARED
    || status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || status === WORKFLOW_STATUS.PUBLISHED;
}
