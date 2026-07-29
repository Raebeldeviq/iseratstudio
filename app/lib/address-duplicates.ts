import type { ProjectInput } from "../types";

export type AddressDuplicateGroup = {
  id: string;
  addressKey: string;
  projectIds: string[];
  recommendedKeepId: string;
};

function normalizedAddressPart(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00df/g, "ss")
    .replace(/str(?:asse)?\.?(?=$|\s)/g, "strasse")
    .replace(/[^a-z0-9]/g, "");
}

function normalizedHouseNumber(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s/g, "")
    .replace(/[^a-z0-9/-]/g, "");
}

export function normalizedPhysicalAddressKey(
  project: ProjectInput,
): string | undefined {
  if (
    !project.street.trim()
    || !project.houseNumber.trim()
    || !project.zip.trim()
    || !project.city.trim()
  ) return undefined;

  return [
    normalizedAddressPart(project.street),
    normalizedHouseNumber(project.houseNumber),
    normalizedAddressPart(project.zip),
    normalizedAddressPart(project.city),
  ].join("|");
}

function projectCompletenessScore(project: ProjectInput): number {
  const meaningfulTextValues = [
    project.name,
    project.street,
    project.houseNumber,
    project.zip,
    project.city,
    project.district,
    project.locationFacts,
    project.transportFacts,
    project.familyFacts,
    project.natureFacts,
    project.notes,
  ];

  return meaningfulTextValues.filter((value) => value.trim()).length
    + (Number(project.plotArea) > 0 ? 1 : 0)
    + (Number(project.plotPrice) > 0 ? 1 : 0)
    + (Number(project.additionalCosts) > 0 ? 1 : 0)
    + (project.selectedHouseIds.length > 0 ? 1 : 0)
    + (project.listings.length > 0 ? 1 : 0)
    + (Object.keys(project.promotionAssignments ?? {}).length > 0 ? 1 : 0)
    + ((project.headlineHistory?.length ?? 0) > 0 ? 1 : 0)
    + ((project.renewalHistory?.length ?? 0) > 0 ? 1 : 0);
}

function validTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function projectLatestUploadTimestamp(project: ProjectInput): number {
  const timestamps = [
    project.lastRenewedAt,
    project.lastTotalSyncAt,
    ...project.listings.map((listing) => listing.uploadedAt),
    ...(project.renewalHistory ?? []).map((entry) => entry.completedAt),
  ]
    .map(validTimestamp)
    .filter((value): value is number => value !== undefined);

  return timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareKeepCandidates(
  left: ProjectInput,
  right: ProjectInput,
): number {
  const completenessDifference = projectCompletenessScore(right)
    - projectCompletenessScore(left);
  if (completenessDifference !== 0) return completenessDifference;

  const leftUpload = projectLatestUploadTimestamp(left);
  const rightUpload = projectLatestUploadTimestamp(right);
  if (leftUpload !== rightUpload) return rightUpload - leftUpload;

  return compareStableText(left.id, right.id);
}

export function findAddressDuplicateGroups(
  projects: ProjectInput[],
): AddressDuplicateGroup[] {
  const projectsByAddress = new Map<string, ProjectInput[]>();

  projects.forEach((project) => {
    const addressKey = normalizedPhysicalAddressKey(project);
    if (!addressKey) return;
    projectsByAddress.set(addressKey, [
      ...(projectsByAddress.get(addressKey) ?? []),
      project,
    ]);
  });

  return [...projectsByAddress.entries()]
    .filter(([, matches]) => matches.length >= 2)
    .sort(([leftKey], [rightKey]) => compareStableText(leftKey, rightKey))
    .map(([addressKey, matches]) => {
      const projectIds = matches
        .map((project) => project.id)
        .sort(compareStableText);
      const recommendedKeepId = [...matches]
        .sort(compareKeepCandidates)[0].id;

      return {
        id: `address-duplicate:${addressKey}`,
        addressKey,
        projectIds,
        recommendedKeepId,
      };
    });
}
