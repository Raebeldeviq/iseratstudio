#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadHelperRuntimeProvenance, verifyProductionRuntime } from "./helper-runtime-provenance.mjs";
import { createListingRotationProductionPolicyStore } from "./listing-rotation-production-policy.mjs";
import { LISTING_ROTATION_PRODUCTION_POLICY_PATH } from "./listing-rotation-production-policy-cli.mjs";

export async function runHelperRuntimeProvenanceCli(argv, options = {}) {
  if ((argv[0] || "status") !== "status" || argv.length > 1) throw new Error("Verwendung: node helper-runtime-provenance-cli.mjs status");
  const provenance = await (options.loadProvenance || loadHelperRuntimeProvenance)();
  const policyStore = options.policyStore || createListingRotationProductionPolicyStore(LISTING_ROTATION_PRODUCTION_POLICY_PATH);
  const policy = await policyStore.load();
  return {
    ...provenance,
    productionGuard: verifyProductionRuntime(provenance, policy),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHelperRuntimeProvenanceCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime-Provenienz konnte nicht geprüft werden."}\n`);
    process.exitCode = 1;
  });
}
