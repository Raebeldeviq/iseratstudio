import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readSheet } from "read-excel-file/node";
import { parseAddressWorkbookRows } from "../app/lib/address-import.ts";

const workbookPath = fileURLToPath(new URL(
  "../public/Fabian-Pascal-Adressimport-Vorlage.xlsx",
  import.meta.url,
));

test("reads the shipped Excel template through the production import parser", async () => {
  const rows = await readSheet(workbookPath);
  const result = parseAddressWorkbookRows(rows, [], () => "template-address");

  assert.equal(result.errors.length, 0);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].owner, "fabian");
  assert.equal(result.projects[0].zip, "15732");
  assert.equal(result.projects[0].plotArea, 620);
});
