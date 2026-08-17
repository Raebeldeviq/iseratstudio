import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

const sessionPath = join(APPLICATION_DATA_DIRECTORY, "helper-session");
const sessionToken = String(await readFile(sessionPath, "utf8")).trim();
if (!/^[a-f0-9]{64}$/u.test(sessionToken)) {
  throw new Error("Die geschützte lokale Helper-Sitzung fehlt oder ist ungültig.");
}
process.env.FPI_SESSION_TOKEN = sessionToken;
await import("./local-upload-server.mjs");
