#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { createPlotInquiryWorkflow } from "./plot-inquiry-workflow.mjs";
import { previewLocalPlotInquiries } from "./plot-inquiry-preview.mjs";

function parseArgs(argv) {
  const args = { command: "", plotIds: [], input: "", file: "", decision: "", name: "" };
  const values = argv.slice(2);
  args.command = values.shift() || "status";
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--plot-id" && values[index + 1]) args.plotIds.push(values[++index]);
    else if (value === "--input" && values[index + 1]) args.input = values[++index];
    else if (value === "--file" && values[index + 1]) args.file = values[++index];
    else if (value === "--decision" && values[index + 1]) args.decision = values[++index];
    else if (value === "--name" && values[index + 1]) args.name = values[++index];
    else throw new Error(`Unbekannter Parameter: ${value}`);
  }
  return args;
}

async function inputJson(path) {
  if (!path) throw new Error("Für das Ereignis fehlt --input /pfad/ereignis.json.");
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

const args = parseArgs(process.argv);
const workflow = createPlotInquiryWorkflow();
let result;

if (args.command === "status") result = await workflow.status();
else if (args.command === "preview") {
  result = await previewLocalPlotInquiries();
}
else if (args.command === "sync") result = await workflow.sync();
else if (args.command === "approve") result = await workflow.approveInquiries(args.plotIds);
else if (args.command === "claim") {
  if (args.plotIds.length !== 1) throw new Error("Für den Versandstart ist genau eine --plot-id erforderlich.");
  result = await workflow.claimDispatch(args.plotIds[0]);
}
else if (args.command === "dismiss") result = await workflow.dismissInquiries(args.plotIds);
else if (args.command === "provider") {
  if (args.plotIds.length !== 1 || !args.name) throw new Error("Für den Inseratersteller sind genau eine --plot-id und --name erforderlich.");
  result = await workflow.identifyProvider(args.plotIds[0], args.name);
}
else if (args.command === "event") result = await workflow.recordEvent(await inputJson(args.input));
else if (args.command === "legal-decision") {
  if (args.plotIds.length !== 1) throw new Error("Für die rechtliche Entscheidung ist genau eine --plot-id erforderlich.");
  result = await workflow.legalDecision(args.plotIds[0], args.decision);
} else if (args.command === "attach-expose") {
  if (args.plotIds.length !== 1 || !args.file) throw new Error("Für den Exposé-Import sind genau eine --plot-id und --file erforderlich.");
  result = await workflow.attachExpose(args.plotIds[0], resolve(args.file));
} else {
  throw new Error("Aufruf: plot-inquiry-cli.mjs status|preview|sync|approve|claim|dismiss|provider|event|legal-decision|attach-expose [Optionen]");
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
