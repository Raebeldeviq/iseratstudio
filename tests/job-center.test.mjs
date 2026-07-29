import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./total-sync"
      && context.parentURL?.endsWith("/app/lib/job-center.ts")
    ) {
      return nextResolve("./total-sync.ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  appendJobAttempt,
  buildUploadRunHistoryEntry,
  interruptedRun,
  jobShouldRun,
  normalizeTotalSyncRun,
  runCompletionStatus,
  runJobProgress,
  upsertUploadRunHistory,
  UPLOAD_RUN_HISTORY_LIMIT,
} = await import("../app/lib/job-center.ts");
const {
  createTotalSyncRun,
  totalSyncCanResume,
  totalSyncExternalId,
} = await import("../app/lib/total-sync.ts");

const CREATED_AT = "2026-07-24T08:00:00.000Z";

function project(id = "project-one", owner = "fabian") {
  return {
    id,
    owner,
    name: `Projekt ${id}`,
    street: "Musterweg",
    houseNumber: "7",
    zip: "12345",
    city: "Musterstadt",
    district: "",
    plotArea: 625,
    plotPrice: 190000,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings: [],
    createdAt: CREATED_AT,
  };
}

function listing({
  id,
  externalId,
  templateId,
  runId,
  uploadedAt,
  secretText = "",
}) {
  return {
    id,
    externalId,
    templateId,
    templateName: templateId,
    price: 450000,
    texts: {
      title: secretText,
      description: secretText,
      equipment: secretText,
      location: secretText,
      other: secretText,
    },
    totalSyncRunId: runId,
    uploadedAt,
    version: 1,
  };
}

function house(id, name = `Haus ${id}`) {
  return {
    id,
    name,
    houseType: "Einfamilienhaus",
    livingArea: 140,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 350000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung",
    energySource: "Luft-Wasser-Wärmepumpe",
    architecture: "",
    equipmentHighlights: "",
    useStandardPackage: true,
    images: [],
  };
}

function totalSyncHouses(ids) {
  const houseTypes = [
    "Einfamilienhaus",
    "Bungalow",
    "Zweifamilienhaus",
    "Einfamilienhaus",
  ];
  return ids.map((id, index) => ({
    ...house(id),
    houseType: houseTypes[index % houseTypes.length],
  }));
}

function job(status, index) {
  return {
    id: `job-${index}`,
    externalId: `OBJECT-${index}`,
    houseId: `house-${index}`,
    slot: index,
    status,
    attempts: [],
  };
}

function runWithTaskJobs(statusGroups) {
  return {
    id: "status-run",
    kind: "total-sync",
    scope: "all",
    createdAt: CREATED_AT,
    status: "paused",
    skippedProjectCount: 0,
    tasks: statusGroups.map((statuses, taskIndex) => ({
      projectId: `project-${taskIndex + 1}`,
      houseIds: statuses.map((_, jobIndex) => (
        `house-${taskIndex + 1}-${jobIndex + 1}`
      )),
      generated: true,
      uploadedExternalIds: [],
      listingJobs: statuses.map((status, jobIndex) => ({
        ...job(status, taskIndex * 10 + jobIndex + 1),
        houseId: `house-${taskIndex + 1}-${jobIndex + 1}`,
        slot: jobIndex + 1,
      })),
    })),
  };
}

function historyEntry(id, updatedAt, status = "completed") {
  return {
    id,
    kind: "total-sync",
    scope: "all",
    status,
    portalPublicationEnabled: false,
    createdAt: updatedAt,
    updatedAt,
    skippedProjectCount: 0,
    attempts: [],
    listings: [],
  };
}

test("new total-sync runs contain four stable pending listing jobs per address", () => {
  const run = createTotalSyncRun({
    projects: [project()],
    eligibleHouses: totalSyncHouses(["h1", "h2", "h3", "h4", "h5"]),
    scope: "all",
    runId: "run-new-jobs",
    createdAt: CREATED_AT,
    random: () => 0.25,
  });
  const task = run.tasks[0];

  assert.equal(task.listingJobs.length, 4);
  assert.deepEqual(
    task.listingJobs.map((item) => item.status),
    ["pending", "pending", "pending", "pending"],
  );
  assert.deepEqual(
    task.listingJobs.map((item) => item.externalId),
    [1, 2, 3, 4].map((slot) => (
      totalSyncExternalId(run.id, task.projectId, slot)
    )),
  );
  assert.equal(new Set(task.listingJobs.map((item) => item.id)).size, 4);

  run.status = "completed-with-errors";
  assert.equal(totalSyncCanResume(run), true);
});

test("legacy runs migrate uploads and task errors into deterministic listing jobs", () => {
  const legacyProject = project("legacy-project");
  const runId = "legacy-run";
  const readyExternalId = totalSyncExternalId(runId, legacyProject.id, 1);
  const uploadedExternalId = totalSyncExternalId(runId, legacyProject.id, 2);
  legacyProject.listings = [
    listing({
      id: "generated-listing",
      externalId: readyExternalId,
      templateId: "h1",
      runId,
    }),
  ];
  const legacyRun = {
    id: runId,
    scope: "all",
    createdAt: CREATED_AT,
    status: "paused",
    skippedProjectCount: 0,
    tasks: [{
      projectId: legacyProject.id,
      houseIds: ["h1", "h2", "h3", "h4"],
      generated: false,
      uploadedExternalIds: [uploadedExternalId],
      lastError: "Historischer Uploadfehler",
    }],
  };

  const migrated = normalizeTotalSyncRun(legacyRun, [legacyProject]);
  const jobs = migrated.tasks[0].listingJobs;

  assert.equal(migrated.kind, "total-sync");
  assert.equal(migrated.updatedAt, CREATED_AT);
  assert.deepEqual(migrated.attempts, []);
  assert.deepEqual(
    jobs.map((item) => item.externalId),
    [1, 2, 3, 4].map((slot) => (
      totalSyncExternalId(runId, legacyProject.id, slot)
    )),
  );
  assert.deepEqual(
    jobs.map((item) => item.status),
    ["failed", "uploaded", "pending", "pending"],
  );
  assert.equal(jobs[0].lastStage, "generation");
  assert.equal(jobs[0].lastError, "Historischer Uploadfehler");
  assert.deepEqual(migrated.tasks[0].uploadedExternalIds, [uploadedExternalId]);

  assert.deepEqual(
    normalizeTotalSyncRun(migrated, [legacyProject]),
    migrated,
    "migration should be idempotent",
  );
});

test("stale uploading becomes unknown while interrupted generation safely recovers", () => {
  const recoveryProject = project("recovery-project");
  const runId = "recovery-run";
  recoveryProject.listings = [
    listing({
      id: "already-generated",
      externalId: totalSyncExternalId(runId, recoveryProject.id, 2),
      templateId: "h2",
      runId,
    }),
  ];
  const run = {
    id: runId,
    kind: "total-sync",
    scope: "all",
    createdAt: CREATED_AT,
    status: "running",
    skippedProjectCount: 0,
    tasks: [{
      projectId: recoveryProject.id,
      houseIds: ["h1", "h2", "h3", "h4"],
      generated: false,
      uploadedExternalIds: [],
      listingJobs: [
        job("uploading", 1),
        job("generating", 2),
        job("generating", 3),
        job("uploaded", 4),
      ].map((item, index) => ({
        ...item,
        id: `${recoveryProject.id}:${index + 1}`,
        externalId: totalSyncExternalId(runId, recoveryProject.id, index + 1),
        houseId: `h${index + 1}`,
        slot: index + 1,
      })),
    }],
  };

  const normalized = normalizeTotalSyncRun(run, [recoveryProject]);
  assert.equal(normalized.status, "paused");
  assert.deepEqual(
    normalized.tasks[0].listingJobs.map((item) => item.status),
    ["unknown", "ready", "pending", "uploaded"],
  );

  const interrupted = interruptedRun(run);
  const interruptedJobs = interrupted.tasks[0].listingJobs;
  assert.equal(interruptedJobs[0].status, "unknown");
  assert.equal(interruptedJobs[0].lastStage, "upload");
  assert.match(interruptedJobs[0].lastError, /Immoprofessional/);
  assert.equal(interruptedJobs[1].status, "pending");
  assert.equal(interruptedJobs[2].status, "pending");
  assert.equal(interruptedJobs[3].status, "uploaded");
});

test("attempt checkpoints are completed in place instead of counted twice", () => {
  const startedAt = "2026-07-24T08:03:00.000Z";
  const completedAt = "2026-07-24T08:03:05.000Z";
  const initialJob = job("uploading", 1);
  const startedAttempts = appendJobAttempt(initialJob, {
    stage: "upload",
    startedAt,
  });
  const runningJob = { ...initialJob, attempts: startedAttempts };
  const completedAttempts = appendJobAttempt(runningJob, {
    stage: "upload",
    startedAt,
    completedAt,
    succeeded: true,
  });

  assert.equal(startedAttempts.length, 1);
  assert.equal(completedAttempts.length, 1);
  assert.deepEqual(completedAttempts[0], {
    stage: "upload",
    startedAt,
    completedAt,
    succeeded: true,
  });
});

test("job progress counts all statuses and only fully uploaded addresses", () => {
  const run = runWithTaskJobs([
    ["uploaded", "uploaded", "uploaded", "uploaded"],
    ["pending", "generating", "ready", "uploading"],
    ["failed", "unknown", "pending", "ready"],
  ]);

  assert.deepEqual(runJobProgress(run), {
    total: 12,
    handled: 6,
    pending: 2,
    active: 2,
    ready: 2,
    uploaded: 4,
    failed: 1,
    unknown: 1,
    completedProjects: 1,
  });
});

test("open work keeps a mixed failed-only result paused until pending jobs are handled", () => {
  const mixed = runWithTaskJobs([
    ["uploaded", "failed", "pending", "ready"],
  ]);
  assert.equal(runCompletionStatus(mixed), "paused");

  mixed.tasks[0].listingJobs[2].status = "failed";
  mixed.tasks[0].listingJobs[3].status = "unknown";
  assert.equal(runCompletionStatus(mixed), "completed-with-errors");

  mixed.tasks[0].listingJobs.forEach((item) => {
    item.status = "uploaded";
  });
  assert.equal(
    runCompletionStatus(mixed),
    "paused",
    "four uploads still need a saved project finalization",
  );
  mixed.tasks[0].completedAt = "2026-07-24T08:04:00.000Z";
  assert.equal(runCompletionStatus(mixed), "completed");
});

test("failed-only retry selects no successful, active, pending, or unknown jobs", () => {
  const statuses = [
    "pending",
    "generating",
    "ready",
    "uploading",
    "uploaded",
    "failed",
    "unknown",
  ];
  const failedOnly = statuses.filter((status, index) => (
    jobShouldRun(job(status, index + 1), "failed-only")
  ));
  const continued = statuses.filter((status, index) => (
    jobShouldRun(job(status, index + 1), "continue")
  ));

  assert.deepEqual(failedOnly, ["failed"]);
  assert.deepEqual(continued, ["pending", "ready", "failed"]);
});

test("history upsert deduplicates runs, orders newest first, and caps at 30", () => {
  let history = [];
  for (let index = 0; index < 35; index += 1) {
    const updatedAt = new Date(
      Date.parse(CREATED_AT) + index * 60_000,
    ).toISOString();
    history = upsertUploadRunHistory(
      history,
      historyEntry(`run-${index}`, updatedAt),
    );
  }

  assert.equal(history.length, UPLOAD_RUN_HISTORY_LIMIT);
  assert.equal(history[0].id, "run-34");
  assert.equal(history.at(-1).id, "run-5");
  assert.equal(history.some((entry) => entry.id === "run-4"), false);

  const replacement = historyEntry(
    "run-10",
    "2026-07-25T12:00:00.000Z",
    "completed-with-errors",
  );
  history = upsertUploadRunHistory(history, replacement);

  assert.equal(history.length, UPLOAD_RUN_HISTORY_LIMIT);
  assert.equal(history[0].id, "run-10");
  assert.equal(history[0].status, "completed-with-errors");
  assert.equal(
    history.filter((entry) => entry.id === "run-10").length,
    1,
  );
});

test("history contains operational metadata but no texts, images, address, or credentials", () => {
  const secretText = "PRIVATE-LISTING-TEXT-7c12";
  const secretImage = "data:image/png;base64,PRIVATE-IMAGE-7c12";
  const secretCredential = "sk-private-credential-7c12";
  const metadataProject = project("metadata-project", "pascal");
  metadataProject.street = "PRIVATE-STREET-7c12";
  metadataProject.houseNumber = "PRIVATE-HOUSE-NUMBER-7c12";
  metadataProject.plotPrice = 987654321;
  metadataProject.locationFacts = secretText;
  metadataProject.notes = secretCredential;
  metadataProject.apiKey = secretCredential;
  const metadataHouse = house("h1", "SUN 142");
  metadataHouse.architecture = secretText;
  metadataHouse.password = secretCredential;
  metadataHouse.images = [{
    id: "private-image",
    name: "private.png",
    mimeType: "image/png",
    dataUrl: secretImage,
    caption: secretText,
    isFloorplan: false,
  }];
  const metadataHouses = [
    metadataHouse,
    { ...house("h2"), houseType: "Bungalow" },
    { ...house("h3"), houseType: "Zweifamilienhaus" },
    house("h4"),
  ];
  const run = createTotalSyncRun({
    projects: [metadataProject],
    eligibleHouses: metadataHouses,
    scope: "all",
    aiModel: "gpt-5.6-luna",
    runId: "metadata-run",
    createdAt: CREATED_AT,
  });
  const firstJob = run.tasks[0].listingJobs[0];
  metadataProject.listings = [
    listing({
      id: "private-listing",
      externalId: firstJob.externalId,
      templateId: firstJob.houseId,
      runId: run.id,
      secretText,
    }),
  ];
  run.tasks[0].listingJobs[0] = {
    ...firstJob,
    status: "failed",
    attempts: [{
      stage: "upload",
      startedAt: "2026-07-24T08:01:00.000Z",
      completedAt: "2026-07-24T08:01:01.000Z",
      succeeded: false,
      message: "Technischer Uploadfehler",
    }],
    lastStage: "upload",
    lastAttemptAt: "2026-07-24T08:01:00.000Z",
    lastError: "Technischer Uploadfehler",
    aiUsage: {
      model: "gpt-5.6-luna",
      inputTokens: 1_250,
      outputTokens: 840,
      requestCount: 2,
    },
  };

  const entry = buildUploadRunHistoryEntry(
    run,
    [metadataProject],
    metadataHouses,
    "completed-with-errors",
    "2026-07-24T08:02:00.000Z",
  );
  const serialized = JSON.stringify(entry);
  const firstListing = entry.listings[0];

  assert.equal(firstListing.projectName, metadataProject.name);
  assert.equal(firstListing.owner, "pascal");
  assert.equal(firstListing.city, "Musterstadt");
  assert.equal(firstListing.externalId, firstJob.externalId);
  assert.equal(
    firstListing.houseName,
    metadataHouses.find((item) => item.id === firstJob.houseId).name,
  );
  assert.equal(firstListing.status, "failed");
  assert.equal(firstListing.attemptCount, 1);
  assert.equal(firstListing.lastStage, "upload");
  assert.equal(firstListing.lastError, "Technischer Uploadfehler");
  assert.equal(entry.aiModel, "gpt-5.6-luna");
  assert.deepEqual(firstListing.aiUsage, {
    model: "gpt-5.6-luna",
    inputTokens: 1_250,
    outputTokens: 840,
    requestCount: 2,
  });

  assert.equal(serialized.includes(secretText), false);
  assert.equal(serialized.includes(secretImage), false);
  assert.equal(serialized.includes(secretCredential), false);
  assert.equal(serialized.includes(metadataProject.street), false);
  assert.equal(serialized.includes(metadataProject.houseNumber), false);
  assert.equal(serialized.includes(String(metadataProject.plotPrice)), false);
  assert.equal(Object.hasOwn(firstListing, "texts"), false);
  assert.equal(Object.hasOwn(firstListing, "images"), false);
  assert.equal(Object.hasOwn(firstListing, "street"), false);
  assert.equal(Object.hasOwn(firstListing, "credentials"), false);
});
