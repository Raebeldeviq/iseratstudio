import assert from "node:assert/strict";
import test from "node:test";
import { loadStudioSnapshot, saveStudioState, saveStudioRecoverySnapshot } from "../app/lib/storage.ts";

test("recovery retains the complete rejected browser record separately and cannot replace primary state", async context => {
  const previous = globalThis.indexedDB, records = new Map(); let failWrites = false;
  context.after(() => { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; });
  const db = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
    const tx = { error: null };
    tx.objectStore = () => ({ put(value, key) {
      if (failWrites) queueMicrotask(() => { tx.error = new Error("Quota exceeded"); tx.onabort?.(); });
      else { records.set(key, structuredClone(value)); queueMicrotask(() => tx.oncomplete?.()); }
    }, get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return request; } });
    return tx;
  } };
  globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } };
  const stale = { source: "browser", savedAt: "2026-11-18T09:49:00Z", state: { version: 1, houses: [{ id: "house", images: [{ dataUrl: "data:image/png;base64,YQ==" }] }], projects: [{ listings: [{ id: "listing", status: "draft", texts: { title: "Noch nicht gesicherte Bearbeitung" } }] }] } };
  const current = structuredClone(stale.state); current.projects[0].listings[0].status = "transferred_pending_import";
  await saveStudioState(current, "2026-11-18T08:38:07Z");
  const primary = structuredClone(records.get("primary"));
  await saveStudioRecoverySnapshot(stale);
  assert.deepEqual(records.get("primary"), primary);
  const key = [...records.keys()].find(key => key.startsWith("recovery:device-conflict:"));
  assert.ok(key); assert.deepEqual(records.get(key).state, stale.state);
  assert.equal(records.get(key).savedAt, stale.savedAt); assert.equal(records.get(key).reason, "device-lifecycle-conflict");
  await saveStudioRecoverySnapshot(stale); assert.equal(records.size, 2);
  assert.deepEqual((await loadStudioSnapshot()).state, current);
  failWrites = true;
  await assert.rejects(saveStudioRecoverySnapshot({ ...stale, savedAt: "2026-11-18T10:00:00Z" }), /Quota exceeded/u);
  assert.deepEqual(records.get("primary"), primary); assert.equal(records.size, 2);
});
