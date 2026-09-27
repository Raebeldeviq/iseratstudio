import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BATCH_UPLOAD_LOG_LIMIT } from "../batch-upload.mjs";
import { MAX_UPLOAD_LOGS } from "../listing-rules.mjs";

const studioSource = await readFile(new URL("../app/InseratStudio.tsx", import.meta.url), "utf8");

test("desktop upload normalization imports the central batch upload log limit", () => {
  assert.equal(BATCH_UPLOAD_LOG_LIMIT, MAX_UPLOAD_LOGS);
  assert.match(
    studioSource,
    /import\s*\{[^}]*BATCH_UPLOAD_LOG_LIMIT[^}]*\}\s*from\s*["']\.\.\/batch-upload\.mjs["']/s,
  );
  assert.match(
    studioSource,
    /uploadHistory:\s*Array\.isArray\(state\.uploadHistory\)\s*\?\s*state\.uploadHistory\.slice\(-BATCH_UPLOAD_LOG_LIMIT\)\s*:\s*\[\]/,
  );
});

test("desktop catalog load remains fail-closed", () => {
  assert.match(
    studioSource,
    /Der Katalog wurde nicht überschrieben\. Bitte die Datenprüfung abschließen und anschließend neu laden\./,
  );
});
