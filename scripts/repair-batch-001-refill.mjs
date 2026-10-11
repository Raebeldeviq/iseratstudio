import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPLICATION_DATA_DIRECTORY } from '../platform-paths.mjs';
import { createCatalogStateStore } from '../catalog-state-store.mjs';
import { discardUntransferredRefill, adoptApprovedRefillPools, prepareSmartRefill, planSmartRefill } from '../smart-refill.mjs';
import { prepareProjectListings } from '../app/lib/listing-preparation.ts';

export const WRONG_NUMBERS = ['30460-010005', '30460-011005', '30460-012001', '30460-013001'];
export const SOURCE_NUMBERS = ['30460-001003', '30460-001004', '30460-001005', '30460-001006'];
const wrongCycleId = 'refill:93840498-dcf4-4d0b-be4a-090bc98ec9fe:1';
const wrongPlotId = '93840498-dcf4-4d0b-be4a-090bc98ec9fe';

// Exact scoped repair. No deletion confirmation, scheduler, FTPS or portal calls.
export function prepareBatch001Recovery(state, uploadJobs, at = new Date().toISOString()) {
  const existing = state.smartRefill?.cycles.filter(cycle => cycle.kind === 'listing-replacement' && SOURCE_NUMBERS.includes(cycle.sourceExternalId)) || [];
  if (existing.length === 4 && state.smartRefill?.cancellations?.some(item => item.cycleId === wrongCycleId)) return state;
  if (existing.length) throw new Error('Teilweise vorhandene Batch-001-Reparatur muss zuerst geprüft werden.');
  const cycle = state.smartRefill?.cycles.find(item => item.id === wrongCycleId);
  if (!cycle || cycle.plotId !== wrongPlotId || cycle.creditIds.length !== 4) throw new Error('Die falsche Rothenbücherweg-Vorbereitung ist nicht exakt zugeordnet.');
  const credits = cycle.creditIds.map(id => state.smartRefill.credits.find(credit => credit.id === id));
  assert.deepEqual(credits.map(credit => credit?.externalId).sort(), [...SOURCE_NUMBERS].sort());
  assert.ok(credits.every(credit => credit.batchId === 'delete-batch:1:1'));
  const discarded = discardUntransferredRefill(state, cycle.id, WRONG_NUMBERS, uploadJobs, at);
  assert.equal(planSmartRefill(discarded).free, planSmartRefill(state).free + 4);
  const approved = adoptApprovedRefillPools(discarded, at);
  const next = prepareSmartRefill(approved, (input, ids, distribution, replacements) =>
    prepareProjectListings(input, ids, distribution, project => project, { replacements, now: at }).state,
  { now: at, creditIds: cycle.creditIds });
  assert.deepEqual(next.smartRefill.credits, state.smartRefill.credits);
  const newCycles = next.smartRefill.cycles.filter(item => item.kind === 'listing-replacement' && cycle.creditIds.includes(item.creditIds[0]));
  assert.equal(newCycles.length, 4); assert.equal(new Set(newCycles.map(item => item.plotId)).size, 4);
  assert.ok(newCycles.every(item => item.pool === 'B' && item.sourcePool === 'A' && item.plotId !== wrongPlotId));
  const discardedIds = new Set(cycle.listingIds);
  for (const project of state.projects) for (const listing of project.listings) if (!discardedIds.has(listing.id))
    assert.deepEqual(next.projects.find(item => item.id === project.id)?.listings.find(item => item.id === listing.id), listing);
  for (const plot of state.plots) if (plot.id !== wrongPlotId) assert.deepEqual(next.plots.find(item => item.id === plot.id), plot);
  const wrongPlot = next.plots.find(item => item.id === wrongPlotId);
  if (wrongPlot) {
    const oldPlot = state.plots.find(item => item.id === wrongPlotId);
    assert.deepEqual({ ...wrongPlot, addressRotation: undefined }, { ...oldPlot, addressRotation: undefined });
    assert.deepEqual(wrongPlot.addressRotation?.poolA, oldPlot.addressRotation?.poolA);
    assert.deepEqual(wrongPlot.addressRotation?.poolB, oldPlot.addressRotation?.poolB);
  }
  for (const key of Object.keys(state)) if (!['projects', 'plots', 'deleteBatches', 'smartRefill', 'houseDistribution', 'interiorRotationLastSet'].includes(key))
    assert.deepEqual(next[key], state[key], `Unbeteiligte Daten verändert: ${key}`);
  for (const batch of state.deleteBatches) for (const entry of batch.entries) {
    const retained = next.deleteBatches.find(item => item.id === batch.id).entries.find(item => item.externalId === entry.externalId);
    assert.deepEqual(retained, discardedIds.has(entry.listingId) ? { ...entry, status: 'void' } : entry);
  }
  assert.equal(planSmartRefill(next).reserved, planSmartRefill(state).reserved);
  return next;
}
function receipt(state) {
  return { credits: state.smartRefill.credits.length, free: planSmartRefill(state).free,
    reservations: planSmartRefill(state).reserved, discarded: WRONG_NUMBERS,
    successors: state.smartRefill.cycles.filter(cycle => cycle.kind === 'listing-replacement' && SOURCE_NUMBERS.includes(cycle.sourceExternalId)).map(cycle => {
      const project = state.projects.find(item => item.id === cycle.projectId), listing = project.listings.find(item => item.id === cycle.listingIds[0]);
      return { plotId: cycle.plotId, sourceListingId: cycle.sourceListingId, sourceExternalId: cycle.sourceExternalId,
        externalId: listing.externalId, sourcePool: cycle.sourcePool, pool: cycle.pool, sourceHouse: cycle.sourceHouseName,
        house: listing.templateName, address: listing.addressSnapshot.address, housePosition: listing.addressSnapshot.housePosition,
        plannedDeletionDate: listing.addressSnapshot.plannedDeletionDate, interiorSet: listing.interiorSet, status: listing.status };
    }) };
}
async function run() {
  const apply = process.argv.includes('--apply'), store = createCatalogStateStore();
  const outputDirectory = join(process.cwd(), 'outputs'); await mkdir(outputDirectory, { recursive: true });
  const loadJobs = async () => JSON.parse(await readFile(join(APPLICATION_DATA_DIRECTORY, 'upload-jobs.json'), 'utf8')).jobs;
  if (!apply) {
    const current = await store.load(); const next = prepareBatch001Recovery(current.state, await loadJobs());
    await writeFile(join(outputDirectory, 'batch001-dry-run.json'), JSON.stringify(receipt(next), null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipt(next))); return;
  }
  const mode = JSON.parse(await readFile(join(APPLICATION_DATA_DIRECTORY, 'listing-rotation-mode.json'), 'utf8'));
  const policy = JSON.parse(await readFile(join(APPLICATION_DATA_DIRECTORY, 'listing-rotation-production-policy.json'), 'utf8'));
  if (mode.mode !== 'off' || policy.startupCatchupMode !== 'detect-only') throw new Error('Runtime muss off / detect-only bleiben.');
  const expectedCommit = process.argv.find(value => value.startsWith('--runtime-commit='))?.slice('--runtime-commit='.length);
  if (!/^[a-f0-9]{40}$/u.test(expectedCommit || '')) throw new Error('Der verifizierte Release-Commit muss explizit angegeben werden.');
  const token = (await readFile(join(APPLICATION_DATA_DIRECTORY, 'helper-session'), 'utf8')).trim();
  const response = await fetch('http://127.0.0.1:43182/runtime-provenance', { headers: { 'X-FPI-Session': token } });
  const provenance = await response.json();
  if (!response.ok || provenance.runtimeCommit !== expectedCommit || provenance.productionGuard?.valid !== true)
    throw new Error('Die laufende Runtime entspricht nicht dem verifizierten Release-Commit.');
  const backup = join(APPLICATION_DATA_DIRECTORY, 'backups', `batch001-refill-one-to-one-${Date.now()}`); await mkdir(backup, { recursive: true });
  const result = await store.update(async (state, metadata) => {
    const jobs = await loadJobs(); const next = prepareBatch001Recovery(state, jobs);
    if (next === state) return state;
    await writeFile(join(backup, `catalog-before-attempt-${metadata.attempt}.json`), JSON.stringify({ savedAt: metadata.savedAt, state }), { mode: 0o600 });
    await writeFile(join(backup, 'upload-jobs-before.json'), JSON.stringify(jobs), { mode: 0o600 });
    return next;
  });
  const verified = await store.load();
  assert.deepEqual(verified.state.smartRefill, result.state.smartRefill);
  const report = { ...receipt(verified.state), changed: result.changed, savedAt: verified.savedAt, backup };
  await writeFile(join(backup, 'receipt.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(join(outputDirectory, 'batch001-applied.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
