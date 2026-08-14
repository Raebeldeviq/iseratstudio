#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createAppleMailImportReportAdapter } from "./apple-mail-import-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { createImmoprofessionalImportReportService } from "./immoprofessional-import-report-service.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

export async function runListingRotationImportReportCli(argv, options = {}) {
  const externalIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "scan") continue;
    if (argv[index] === "--external-id") externalIds.push(String(argv[++index] || ""));
    else throw new Error(`Unbekanntes Argument: ${argv[index]}`);
  }
  if (externalIds.length !== 1 || !/^30460-\d{6}$/u.test(externalIds[0])) throw new Error("Die begrenzte Importberichtprüfung benötigt exakt eine neue externe Objektnummer.");
  const store = options.store || createCatalogStateStore();
  const uploadJobLedger = options.uploadJobLedger || createUploadJobLedger(join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json"));
  const mailAdapter = options.mailAdapter || createAppleMailImportReportAdapter();
  const writeLog = options.writeLog || createStructuredFileLogger(join(APPLICATION_DATA_DIRECTORY, "immoprofessional-import-reports.log"), { jobType: "immoprofessional-import-report" });
  const service = createImmoprofessionalImportReportService({ store, uploadJobLedger, mailAdapter, writeLog });
  return service.runOnce({
    trigger: "manual-live-canary",
    allowedExternalObjectNumbers: externalIds,
    now: options.now?.(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runListingRotationImportReportCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Importberichtprüfung fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
