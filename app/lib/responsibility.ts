import type {
  ManagementState,
  ProjectInput,
  TotalSyncScope,
} from "../types";

export const ALL_RESPONSIBILITIES_SCOPE = "all";
export const LEGACY_USER_IDS: Record<string, string> = {
  fabian: "user-fabian",
  pascal: "user-pascal",
};

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("de-DE");
}

function descendantUnitIds(
  management: ManagementState,
  rootUnitId: string,
): Set<string> {
  const result = new Set([rootUnitId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of management.organizationUnits) {
      if (unit.parentId && result.has(unit.parentId) && !result.has(unit.id)) {
        result.add(unit.id);
        changed = true;
      }
    }
  }
  return result;
}

export function legacyUserId(value: string | undefined): string | undefined {
  const key = normalized(value);
  return LEGACY_USER_IDS[key] ?? (key.startsWith("user-") ? value?.trim() : undefined);
}

export function userScope(userId: string): TotalSyncScope {
  return `user:${userId}`;
}

export function unitScope(unitId: string): TotalSyncScope {
  return `unit:${unitId}`;
}

export function normalizedResponsibilityScope(scope: TotalSyncScope): TotalSyncScope {
  if (!scope || scope === "all") return ALL_RESPONSIBILITIES_SCOPE;
  if (scope.startsWith("user:") || scope.startsWith("unit:")) return scope;
  const migratedUserId = legacyUserId(scope);
  return migratedUserId ? userScope(migratedUserId) : userScope(scope);
}

export function projectResponsibleUserId(
  project: Partial<ProjectInput>,
): string | undefined {
  return project.listings?.find((listing) => listing.management?.assignedUserId)
      ?.management?.assignedUserId
    || project.responsibleUserId
    || legacyUserId(project.owner)
    || (project.owner?.startsWith("user-") ? project.owner : undefined);
}

export function projectOrganizationUnitId(
  project: Partial<ProjectInput>,
  management?: ManagementState,
): string | undefined {
  const responsibleUserId = projectResponsibleUserId(project);
  return project.organizationUnitId
    || project.listings?.find((listing) => listing.management?.organizationUnitId)
      ?.management?.organizationUnitId
    || management?.users.find((user) => user.id === responsibleUserId)
      ?.organizationUnitIds[0];
}

export function responsibilityLabel(
  management: ManagementState | undefined,
  userId: string | undefined,
): string {
  if (!userId) return "Nicht zugeordnet";
  return management?.users.find((user) => user.id === userId)?.name
    ?? (userId === "user-fabian" ? "Fabian" : userId === "user-pascal" ? "Pascal" : userId);
}

export function scopeLabel(
  management: ManagementState | undefined,
  scope: TotalSyncScope,
): string {
  const normalizedScope = normalizedResponsibilityScope(scope);
  if (normalizedScope === "all") return "Alle sichtbaren Zuständigkeiten";
  if (normalizedScope.startsWith("user:")) {
    return responsibilityLabel(management, normalizedScope.slice(5));
  }
  if (normalizedScope.startsWith("unit:")) {
    const unitId = normalizedScope.slice(5);
    return management?.organizationUnits.find((unit) => unit.id === unitId)?.name
      ?? unitId;
  }
  return normalizedScope;
}

export function projectMatchesResponsibilityScope(
  project: ProjectInput,
  scope: TotalSyncScope,
  management?: ManagementState,
): boolean {
  const normalizedScope = normalizedResponsibilityScope(scope);
  if (normalizedScope === "all") return true;
  if (normalizedScope.startsWith("user:")) {
    return projectResponsibleUserId(project) === normalizedScope.slice(5);
  }
  if (normalizedScope.startsWith("unit:")) {
    const rootUnitId = normalizedScope.slice(5);
    const unitIds = management
      ? descendantUnitIds(management, rootUnitId)
      : new Set([rootUnitId]);
    return Boolean(
      projectOrganizationUnitId(project, management)
      && unitIds.has(projectOrganizationUnitId(project, management)!),
    );
  }
  return false;
}

export function responsibilityScopeOptions(
  management: ManagementState | undefined,
  visibleUserIds?: ReadonlySet<string>,
): Array<{ value: TotalSyncScope; label: string; kind: "all" | "user" | "unit" }> {
  if (!management) return [{ value: "all", label: "Alle Zuständigkeiten", kind: "all" }];
  const users = management.users.filter((user) => (
    user.active && (!visibleUserIds || visibleUserIds.has(user.id))
  ));
  const userUnitIds = new Set(users.flatMap((user) => user.organizationUnitIds));
  return [
    { value: "all", label: "Alle sichtbaren Zuständigkeiten", kind: "all" },
    ...users.map((user) => ({
      value: userScope(user.id),
      label: user.name,
      kind: "user" as const,
    })),
    ...management.organizationUnits
      .filter((unit) => unit.active && userUnitIds.has(unit.id))
      .map((unit) => ({
        value: unitScope(unit.id),
        label: unit.name,
        kind: "unit" as const,
      })),
  ];
}

export function resolveImportedUserId(
  management: ManagementState | undefined,
  value: string,
): string | null {
  const key = normalized(value);
  if (!key) return null;
  const legacy = legacyUserId(key);
  if (legacy && management?.users.some((user) => user.id === legacy && user.active)) {
    return legacy;
  }
  const match = management?.users.find((user) => (
    user.active
    && (
      normalized(user.id) === key
      || normalized(user.name) === key
      || normalized(user.email) === key
    )
  ));
  return match?.id ?? null;
}
