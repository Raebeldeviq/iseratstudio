import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import {
  assertOpenImmoExternalIdsInArchive,
  OPENIMMO_EXTERNAL_ID_GUARD_CODE,
} from "../openimmo-external-id-guard.mjs";

async function archive(externalId, openImmoId = externalId, originId = externalId) {
  const zip = new JSZip();
  zip.file("openimmo.xml", `<openimmo><immobilie><verwaltung_objekt><objektnr_extern>${externalId}</objektnr_extern></verwaltung_objekt><verwaltung_techn><openimmo_obid>${openImmoId}</openimmo_obid><kennung_ursprung>${originId}</kennung_ursprung></verwaltung_techn></immobilie></openimmo>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("permits a final ZIP only when all three external OpenImmo IDs match 30460-N", async () => {
  const result = await assertOpenImmoExternalIdsInArchive(await archive("30460-46"));
  assert.deepEqual(result.diagnostics.objectNumbers, ["30460-46"]);
});

test("permits the new batch number in all three external OpenImmo ID fields", async () => {
  const result = await assertOpenImmoExternalIdsInArchive(await archive("30460-093001"));
  assert.deepEqual(result.diagnostics.objectNumbers, ["30460-093001"]);
});

test("blocks FPI and mismatching external IDs before FTPS", async () => {
  await assert.rejects(
    () => assertOpenImmoExternalIdsInArchive(archive("FPI-TEST", "FPI-TEST", "FPI-TEST")),
    { code: OPENIMMO_EXTERNAL_ID_GUARD_CODE },
  );
  await assert.rejects(
    () => assertOpenImmoExternalIdsInArchive(archive("30460-46", "30460-47", "30460-46")),
    { code: OPENIMMO_EXTERNAL_ID_GUARD_CODE },
  );
});
