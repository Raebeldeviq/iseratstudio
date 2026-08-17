#!/usr/bin/env node

import { installHelperLaunchAgent } from "./helper-launch-agent.mjs";
import { stageHelperRuntime } from "./helper-runtime-stage.mjs";

async function main() {
  if (process.argv[2] !== "install") {
    throw new Error("Verwendung: node helper-launch-agent-cli.mjs install");
  }
  const staged = await stageHelperRuntime({ sourceRoot: process.cwd() });
  const result = await installHelperLaunchAgent({ projectRoot: staged.runtimePath });
  process.stdout.write(`${JSON.stringify({ ...result, runtimeManifest: staged.manifest }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
