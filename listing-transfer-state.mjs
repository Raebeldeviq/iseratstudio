import { normalizeListingGroup, updateListingControl } from "./listing-groups.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

function replaceProject(state, updatedProject) {
  return {
    ...state,
    projects: state.projects.map((project) => project.id === updatedProject.id ? updatedProject : project),
  };
}

export function updatePreparedCopyAfterUpload(state, projectId, copyId, result, at) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const copy = project?.listings.find((candidate) => candidate.id === copyId);
  if (!project || !copy) return state;
  const source = project.listings.find((candidate) => candidate.id === copy.rotationSourceListingId);
  const repairSourceStatus = copy.productionLifecycle?.regressionRepair?.format === 1
    ? copy.productionLifecycle.regressionRepair.sourceOriginalStatus
    : "";
  const succeeded = result.ok === true;
  const copyStatus = succeeded ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT : WORKFLOW_STATUS.PREPARED;
  const copyMessage = succeeded
    ? "FTPS übertragen · Importbestätigung ausstehend"
    : "FTPS-Übertragung fehlgeschlagen · erneuter Upload bleibt möglich";
  let group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
  group = updateListingControl(group, copy, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    lastAttemptAt: at,
    status: succeeded ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT : WORKFLOW_STATUS.FAILED,
    statusMessage: copyMessage,
    lastError: succeeded ? "" : String(result.error || "FTPS-Übertragung fehlgeschlagen."),
    processLease: null,
  }, { now: at });
  if (source) {
    group = updateListingControl(group, source, {
      status: repairSourceStatus || WORKFLOW_STATUS.PUBLISHED,
      statusMessage: repairSourceStatus
        ? (succeeded
            ? "Regression-Replacement unverändert · korrekter Ersatzimport ausstehend"
            : "Regression-Replacement unverändert · Ersatzübertragung fehlgeschlagen")
        : (succeeded
            ? "Veröffentlicht · Ersatz wurde übertragen, Importbestätigung ausstehend"
            : "Veröffentlicht · Ersatzübertragung fehlgeschlagen"),
      pendingRotationListingId: copy.id,
      pendingRotationJobId: String(result.jobId || ""),
      schedulerSelectionId: "",
      schedulerSelectedAt: "",
      processLease: null,
    }, { now: at });
  }
  const updatedCopy = {
    ...copy,
    status: copyStatus,
    statusMessage: copyMessage,
    uploadError: succeeded ? "" : String(result.error || "FTPS-Übertragung fehlgeschlagen."),
    ...(succeeded ? { transferredAt: at } : {}),
  };
  const uploadLog = {
    id: globalThis.crypto.randomUUID(),
    jobId: String(result.jobId || ""),
    batchId: String(result.runId || ""),
    projectId: project.id,
    address: [project.street, project.houseNumber, project.zip, project.city].filter(Boolean).join(" "),
    listingId: copy.id,
    externalId: copy.externalId,
    houseVariant: copy.templateName,
    promotionImageId: "",
    createdAt: String(copy.createdAt || at),
    updatedAt: at,
    nextUpdatedAt: "",
    status: succeeded ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT : WORKFLOW_STATUS.FAILED,
    statusMessage: copyMessage,
    error: succeeded ? "" : String(result.error || "FTPS-Übertragung fehlgeschlagen."),
  };
  return {
    ...replaceProject(state, {
      ...project,
      listings: project.listings.map((listing) => listing.id === copy.id ? updatedCopy : listing),
      listingGroup: group,
    }),
    uploadHistory: [...(state.uploadHistory || []), uploadLog].slice(-5000),
  };
}
