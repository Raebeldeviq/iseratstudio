import type {
  BusinessRole,
  GeneratedListing,
  ManagementState,
  ManagementUser,
  OperationalStatus,
  OrganizationUnit,
  ProjectInput,
  StudioState,
} from "../types";

export const BUSINESS_ROLE_LABELS: Record<BusinessRole, string> = {
  administrator: "Administrator",
  executive: "Geschäftsführung",
  "sales-director": "Vertriebsleitung",
  "team-lead": "Teamleitung",
  "sales-representative": "Handelsvertretung",
  backoffice: "Backoffice",
};

export const VISIBILITY_SCOPE_LABELS = {
  self: "Nur eigener Bereich",
  team: "Eigenes Team",
  area: "Zugeordneter Bereich",
  organization: "Gesamtes Unternehmen",
  custom: "Individuelle Auswahl",
} as const;

export type StaffOperationalMetrics = {
  user: ManagementUser;
  status: OperationalStatus;
  activeObjects: number;
  drafts: number;
  online: number;
  portalErrors: number;
  staleObjects: number;
  dueActions: number;
  dueRenewals: number;
  lastObjectUpdateAt?: string;
  lastActivityAt?: string;
};

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysSince(value: string | undefined, now: Date): number {
  const at = timestamp(value);
  if (!at) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}

export function descendantUnitIds(
  units: OrganizationUnit[],
  rootIds: Iterable<string>,
): Set<string> {
  const visible = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (unit.parentId && visible.has(unit.parentId) && !visible.has(unit.id)) {
        visible.add(unit.id);
        changed = true;
      }
    }
  }
  return visible;
}

function reportingUserIds(users: ManagementUser[], managerId: string): Set<string> {
  const visible = new Set<string>([managerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const user of users) {
      if (
        user.managerUserId
        && visible.has(user.managerUserId)
        && !visible.has(user.id)
      ) {
        visible.add(user.id);
        changed = true;
      }
    }
  }
  return visible;
}

export function visibleUserIds(
  management: ManagementState,
  actorId: string,
): Set<string> {
  const actor = management.users.find((user) => user.id === actorId && user.active);
  if (!actor) return new Set();
  if (
    actor.role === "admin"
    || actor.visibilityScope === "organization"
    || actor.businessRole === "administrator"
    || actor.businessRole === "executive"
  ) {
    return new Set(management.users.filter((user) => user.active).map((user) => user.id));
  }
  if (actor.visibilityScope === "self") return new Set([actor.id]);
  if (actor.visibilityScope === "custom") {
    return new Set([
      actor.id,
      ...actor.customVisibleUserIds.filter((id) => (
        management.users.some((user) => user.id === id && user.active)
      )),
    ]);
  }

  const reporting = reportingUserIds(management.users, actor.id);
  const unitIds = actor.visibilityScope === "area"
    ? descendantUnitIds(management.organizationUnits, actor.organizationUnitIds)
    : new Set(actor.organizationUnitIds);
  for (const user of management.users) {
    if (
      user.active
      && user.organizationUnitIds.some((unitId) => unitIds.has(unitId))
    ) {
      reporting.add(user.id);
    }
  }
  return reporting;
}

export function leadershipAccess(user: ManagementUser | undefined): boolean {
  return Boolean(
    user
    && (
      user.role === "admin"
      || user.businessRole === "administrator"
      || user.businessRole === "executive"
      || user.businessRole === "sales-director"
      || user.businessRole === "team-lead"
    )
  );
}

export function canReassignObjects(user: ManagementUser | undefined): boolean {
  return Boolean(
    user
    && user.role !== "viewer"
    && (
      leadershipAccess(user)
      || user.businessRole === "backoffice"
    )
  );
}

export function resolveActor(
  management: ManagementState | undefined,
  identity: { id?: string; email?: string; role?: string },
): ManagementUser | undefined {
  if (!management) return undefined;
  const email = identity.email?.trim().toLowerCase();
  return management.users.find((user) => (
    user.active
    && (
      (identity.id && user.id === identity.id)
      || (email && user.email.trim().toLowerCase() === email)
    )
  )) ?? (
    identity.role === "admin"
      ? management.users.find((user) => user.role === "admin" && user.active)
      : undefined
  );
}

export function listingVisibleToUser(
  listing: GeneratedListing,
  allowedUserIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    listing.management?.assignedUserId
    && allowedUserIds.has(listing.management.assignedUserId)
  );
}

function visibleFolderIds(
  management: ManagementState,
  actorId: string,
): Set<string> {
  return new Set(management.fileFolders
    .filter((folder) => (
      folder.scope === "templates"
      || folder.scope === "public"
      || folder.ownerUserId === actorId
      || folder.accessUserIds.includes(actorId)
    ))
    .map((folder) => folder.id));
}

function relevantUnits(
  management: ManagementState,
  allowedUsers: ReadonlySet<string>,
): OrganizationUnit[] {
  if (allowedUsers.size === management.users.filter((user) => user.active).length) {
    return management.organizationUnits;
  }
  const ids = new Set(
    management.users
      .filter((user) => allowedUsers.has(user.id))
      .flatMap((user) => user.organizationUnitIds),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of management.organizationUnits) {
      if (ids.has(unit.id) && unit.parentId && !ids.has(unit.parentId)) {
        ids.add(unit.parentId);
        changed = true;
      }
    }
  }
  return management.organizationUnits.filter((unit) => ids.has(unit.id));
}

export function filterStudioStateForActor(
  state: StudioState,
  actor: ManagementUser,
): StudioState {
  if (!state.management) return state;
  const management = state.management;
  const allowedUsers = visibleUserIds(management, actor.id);
  const projects = state.projects
    .map((project) => ({
      ...project,
      listings: project.listings.filter((listing) => (
        listingVisibleToUser(listing, allowedUsers)
      )),
    }))
    .filter((project) => project.listings.length > 0);
  const visibleProjectIds = new Set(projects.map((project) => project.id));
  const visibleListingIds = new Set(projects.flatMap((project) => (
    project.listings.map((listing) => listing.id)
  )));
  const visibleExternalIds = new Set(projects.flatMap((project) => (
    project.listings.map((listing) => listing.externalId)
  )));
  const folderIds = visibleFolderIds(management, actor.id);
  const filteredManagement: ManagementState = {
    ...management,
    currentUserId: actor.id,
    users: management.users.filter((user) => allowedUsers.has(user.id)),
    organizationUnits: relevantUnits(management, allowedUsers),
    auditLog: management.auditLog.filter((entry) => (
      allowedUsers.has(entry.userId)
      || (entry.targetType === "listing" && visibleListingIds.has(entry.targetId))
    )),
    importReports: management.importReports
      .map((report) => ({
        ...report,
        events: report.events.filter((event) => visibleExternalIds.has(event.externalId)),
      }))
      .filter((report) => report.events.length > 0),
    fileFolders: management.fileFolders.filter((folder) => folderIds.has(folder.id)),
    files: management.files.filter((file) => folderIds.has(file.folderId)),
  };
  const totalSyncRun = state.totalSyncRun
    ? {
        ...state.totalSyncRun,
        tasks: state.totalSyncRun.tasks.filter((task) => visibleProjectIds.has(task.projectId)),
      }
    : undefined;
  const uploadRunHistory = state.uploadRunHistory?.map((entry) => ({
    ...entry,
    listings: entry.listings.filter((listing) => visibleProjectIds.has(listing.projectId)),
  })).filter((entry) => entry.listings.length > 0);
  return {
    ...state,
    projects,
    management: filteredManagement,
    totalSyncRun: totalSyncRun?.tasks.length ? totalSyncRun : undefined,
    uploadRunHistory,
  };
}

export function mergeScopedStudioState(
  submitted: StudioState,
  current: StudioState,
  actor: ManagementUser,
): StudioState {
  if (!current.management || !submitted.management) return current;
  const allowedUsers = visibleUserIds(current.management, actor.id);
  const submittedProjects = new Map(submitted.projects.map((project) => [project.id, project]));
  const projects: ProjectInput[] = current.projects.flatMap((project) => {
    const submittedProject = submittedProjects.get(project.id);
    const currentListingIds = new Set(project.listings.map((listing) => listing.id));
    const submittedListings = new Map(
      (submittedProject?.listings ?? []).map((listing) => [listing.id, listing]),
    );
    const hiddenListings = project.listings.filter((listing) => (
      !listingVisibleToUser(listing, allowedUsers)
    ));
    const visibleListings = project.listings
      .filter((listing) => listingVisibleToUser(listing, allowedUsers))
      .flatMap((listing) => {
        const updated = submittedListings.get(listing.id);
        if (!updated) return [];
        return [listingVisibleToUser(updated, allowedUsers) ? updated : listing];
      });
    for (const listing of submittedProject?.listings ?? []) {
      if (
        !currentListingIds.has(listing.id)
        && listingVisibleToUser(listing, allowedUsers)
      ) {
        visibleListings.push(listing);
      }
    }
    if (!submittedProject && hiddenListings.length === 0) return [];
    const base = submittedProject && hiddenListings.length === 0
      ? submittedProject
      : project;
    return [{ ...base, listings: [...hiddenListings, ...visibleListings] }];
  });
  const currentProjectIds = new Set(current.projects.map((project) => project.id));
  for (const project of submitted.projects) {
    if (
      !currentProjectIds.has(project.id)
      && project.listings.length > 0
      && project.listings.every((listing) => listingVisibleToUser(listing, allowedUsers))
    ) {
      projects.push(project);
    }
  }

  const currentFolderIds = visibleFolderIds(current.management, actor.id);
  const hiddenFolders = current.management.fileFolders.filter((folder) => (
    !currentFolderIds.has(folder.id)
  ));
  const hiddenFiles = current.management.files.filter((file) => (
    !currentFolderIds.has(file.folderId)
  ));
  const canManageSharedFiles = actor.businessRole === "backoffice";
  const currentAuditIds = new Set(current.management.auditLog.map((entry) => entry.id));
  const appendedAuditEntries = submitted.management.auditLog.filter((entry) => (
    !currentAuditIds.has(entry.id) && entry.userId === actor.id
  ));
  const currentReportIds = new Set(
    current.management.importReports.map((report) => report.id),
  );
  const allowedExternalIds = new Set(projects.flatMap((project) => (
    project.listings
      .filter((listing) => listingVisibleToUser(listing, allowedUsers))
      .map((listing) => listing.externalId)
  )));
  const appendedReports = submitted.management.importReports.filter((report) => (
    !currentReportIds.has(report.id)
    && report.events.every((event) => allowedExternalIds.has(event.externalId))
  ));
  const management: ManagementState = {
    ...submitted.management,
    currentUserId: actor.id,
    users: current.management.users,
    organizationUnits: current.management.organizationUnits,
    escalationRules: current.management.escalationRules,
    company: current.management.company,
    portals: current.management.portals,
    auditLog: [...current.management.auditLog, ...appendedAuditEntries]
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, 1000),
    importReports: [...current.management.importReports, ...appendedReports],
    fileFolders: canManageSharedFiles
      ? [...hiddenFolders, ...submitted.management.fileFolders]
      : current.management.fileFolders,
    files: canManageSharedFiles
      ? [...hiddenFiles, ...submitted.management.files]
      : current.management.files,
  };
  const allowedProjectIds = new Set(current.projects
    .filter((project) => project.listings.some((listing) => (
      listingVisibleToUser(listing, allowedUsers)
    )))
    .map((project) => project.id));
  const currentRun = current.totalSyncRun;
  const submittedRun = submitted.totalSyncRun;
  let totalSyncRun = currentRun;
  if (!currentRun && submittedRun) {
    totalSyncRun = submittedRun.tasks.every((task) => allowedProjectIds.has(task.projectId))
      ? submittedRun
      : undefined;
  } else if (currentRun && submittedRun?.id === currentRun.id) {
    const hiddenTasks = currentRun.tasks.filter((task) => !allowedProjectIds.has(task.projectId));
    const visibleTasks = submittedRun.tasks.filter((task) => allowedProjectIds.has(task.projectId));
    totalSyncRun = {
      ...(hiddenTasks.length ? currentRun : submittedRun),
      tasks: [...hiddenTasks, ...visibleTasks],
    };
  } else if (currentRun && !submittedRun) {
    const hiddenTasks = currentRun.tasks.filter((task) => !allowedProjectIds.has(task.projectId));
    totalSyncRun = hiddenTasks.length ? { ...currentRun, tasks: hiddenTasks } : undefined;
  }

  const submittedHistory = new Map(
    (submitted.uploadRunHistory ?? []).map((entry) => [entry.id, entry]),
  );
  const uploadRunHistory = (current.uploadRunHistory ?? []).map((entry) => {
    const updated = submittedHistory.get(entry.id);
    if (!updated) return entry;
    const hiddenListings = entry.listings.filter((listing) => (
      !allowedProjectIds.has(listing.projectId)
    ));
    return {
      ...(hiddenListings.length ? entry : updated),
      listings: [
        ...hiddenListings,
        ...updated.listings.filter((listing) => allowedProjectIds.has(listing.projectId)),
      ],
    };
  });
  for (const entry of submitted.uploadRunHistory ?? []) {
    if (
      !uploadRunHistory.some((currentEntry) => currentEntry.id === entry.id)
      && entry.listings.every((listing) => allowedProjectIds.has(listing.projectId))
    ) {
      uploadRunHistory.push(entry);
    }
  }
  const canManageCatalog = actor.businessRole === "backoffice";
  return {
    ...submitted,
    houses: canManageCatalog ? submitted.houses : current.houses,
    provider: current.provider,
    promotionImages: canManageCatalog ? submitted.promotionImages : current.promotionImages,
    promotionImage: canManageCatalog ? submitted.promotionImage : current.promotionImage,
    promotionImageEnabled: canManageCatalog
      ? submitted.promotionImageEnabled
      : current.promotionImageEnabled,
    portalPublicationEnabled: current.portalPublicationEnabled,
    projects,
    management,
    totalSyncRun,
    uploadRunHistory,
  };
}

export function buildStaffOperationalMetrics(
  state: StudioState,
  now = new Date(),
): StaffOperationalMetrics[] {
  if (!state.management) return [];
  const rules = state.management.escalationRules;
  const listingRows = state.projects.flatMap((project) => (
    project.listings.flatMap((listing) => (
      listing.management ? [{ project, listing }] : []
    ))
  ));
  return state.management.users
    .filter((user) => user.active)
    .map((user) => {
      const rows = listingRows.filter(({ listing }) => (
        listing.management?.assignedUserId === user.id
        && !listing.management.archivedAt
      ));
      const portalErrors = rows.filter(({ listing }) => (
        listing.management?.portals.some((portal) => portal.status === "error")
      )).length;
      const staleObjects = rows.filter(({ listing }) => (
        daysSince(listing.management?.updatedAt, now) >= rules.staleWarningDays
      )).length;
      const criticallyStale = rows.some(({ listing }) => (
        daysSince(listing.management?.updatedAt, now) >= rules.staleCriticalDays
      ));
      const dueActions = rows.filter(({ listing }) => (
        timestamp(listing.management?.nextActionDueAt) > 0
        && timestamp(listing.management?.nextActionDueAt) <= now.getTime()
      )).length;
      const dueRenewals = new Set(rows
        .filter(({ project, listing }) => {
          const lastRenewed = timestamp(project.lastRenewedAt)
            || timestamp(project.lastTotalSyncAt)
            || timestamp(listing.uploadedAt);
          return !lastRenewed
            || now.getTime() - lastRenewed >= (7 - rules.renewalWarningDays) * 86_400_000;
        })
        .map(({ project }) => project.id)).size;
      const inactivityDays = daysSince(user.lastActiveAt, now);
      const critical = (
        (rules.portalErrorsCritical && portalErrors > 0)
        || criticallyStale
        || dueActions > 0
        || inactivityDays >= rules.inactivityCriticalDays
      );
      const attention = (
        staleObjects > 0
        || dueRenewals > 0
        || inactivityDays >= rules.inactivityWarningDays
        || rows.some(({ listing }) => listing.management?.lifecycle === "draft")
      );
      const latestUpdate = rows.reduce<string | undefined>((latest, { listing }) => (
        timestamp(listing.management?.updatedAt) > timestamp(latest)
          ? listing.management?.updatedAt
          : latest
      ), undefined);
      const status: OperationalStatus = critical
        ? "critical"
        : attention
          ? "attention"
          : "current";
      return {
        user,
        status,
        activeObjects: rows.length,
        drafts: rows.filter(({ listing }) => listing.management?.lifecycle === "draft").length,
        online: rows.filter(({ listing }) => listing.management?.lifecycle === "online").length,
        portalErrors,
        staleObjects,
        dueActions,
        dueRenewals,
        lastObjectUpdateAt: latestUpdate,
        lastActivityAt: user.lastActiveAt,
      };
    })
    .sort((left, right) => {
      const priority = { critical: 0, attention: 1, current: 2 };
      return priority[left.status] - priority[right.status]
        || left.user.name.localeCompare(right.user.name, "de");
    });
}
