import type { ProjectInput } from "../types";

export const FIRST_HV_OBJECT_SEQUENCE = 13226;

export function normalizeProviderNumber(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
}

export function providerExternalIdSequence(
  externalId: string,
  providerNumber: string,
): number | undefined {
  const prefix = normalizeProviderNumber(providerNumber);
  const normalizedId = externalId.trim().toUpperCase();
  const expectedPrefix = `${prefix}-`;
  if (!prefix || !normalizedId.startsWith(expectedPrefix)) return undefined;
  const suffix = normalizedId.slice(expectedPrefix.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const sequence = Number(suffix);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

export function isProviderExternalId(
  externalId: string,
  providerNumber: string,
): boolean {
  return providerExternalIdSequence(externalId, providerNumber) !== undefined;
}

export function allocateProviderExternalIds(
  providerNumber: string,
  existingExternalIds: Iterable<string>,
  count: number,
  firstSequence = FIRST_HV_OBJECT_SEQUENCE,
): string[] {
  const prefix = normalizeProviderNumber(providerNumber);
  if (!prefix) {
    throw new Error(
      "Bitte unter Export & Upload zuerst die HV-/Anbieternummer eintragen.",
    );
  }

  const reserved = new Set(
    Array.from(existingExternalIds, (externalId) => externalId.trim().toUpperCase())
      .filter(Boolean),
  );
  let highestSequence = Math.max(0, Math.floor(firstSequence) - 1);
  for (const externalId of reserved) {
    const sequence = providerExternalIdSequence(externalId, prefix);
    if (sequence !== undefined) highestSequence = Math.max(highestSequence, sequence);
  }

  const allocated: string[] = [];
  let sequence = highestSequence + 1;
  while (allocated.length < Math.max(0, Math.floor(count))) {
    const candidate = `${prefix}-${String(sequence).padStart(5, "0")}`;
    sequence += 1;
    if (reserved.has(candidate)) continue;
    reserved.add(candidate);
    allocated.push(candidate);
  }
  return allocated;
}

export function migrateDraftExternalIds(
  projects: ProjectInput[],
  providerNumber: string,
  reservedExternalIds: Iterable<string> = [],
): { projects: ProjectInput[]; changedCount: number } {
  const prefix = normalizeProviderNumber(providerNumber);
  if (!prefix) return { projects, changedCount: 0 };

  const draftsToMigrate = projects.flatMap((project) => (
    project.listings.filter((listing) => (
      !listing.uploadedAt
      && !listing.totalSyncRunId
      && !isProviderExternalId(listing.externalId, prefix)
    ))
  ));
  if (!draftsToMigrate.length) return { projects, changedCount: 0 };

  const allocated = allocateProviderExternalIds(
    prefix,
    [
      ...reservedExternalIds,
      ...projects.flatMap((project) => (
        project.listings.map((listing) => listing.externalId)
      )),
    ],
    draftsToMigrate.length,
  );
  const replacements = new Map(
    draftsToMigrate.map((listing, index) => [listing.id, allocated[index]]),
  );

  return {
    projects: projects.map((project) => ({
      ...project,
      listings: project.listings.map((listing) => {
        const externalId = replacements.get(listing.id);
        return externalId ? { ...listing, externalId } : listing;
      }),
    })),
    changedCount: replacements.size,
  };
}
