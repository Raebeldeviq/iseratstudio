import type {
  OperationalStatus,
  OrganizationUnit,
  StudioState,
} from "../types";
import {
  buildStaffOperationalMetrics,
  descendantUnitIds,
} from "./organization.ts";
import {
  legacyUserId,
  projectResponsibleUserId,
} from "./responsibility.ts";

export type ExecutiveEmployeeRow = {
  userId: string;
  name: string;
  status: OperationalStatus;
  unitNames: string[];
  activeObjects: number;
  onlineObjects: number;
  portalErrors: number;
  dueActions: number;
  staleObjects: number;
  uploads30Days: number;
  successfulOperations30Days: number;
  failedOperations30Days: number;
  successRate: number;
  completedAppointments30Days: number;
};

export type ExecutiveUnitRow = {
  unit: OrganizationUnit;
  headcount: number;
  activeObjects: number;
  onlineObjects: number;
  criticalEmployees: number;
  portalErrors: number;
  dueActions: number;
  uploads30Days: number;
  successRate: number;
};

export type ExecutiveTrendPoint = {
  key: string;
  label: string;
  uploads: number;
  failures: number;
};

export type ExecutiveReport = {
  employees: ExecutiveEmployeeRow[];
  units: ExecutiveUnitRow[];
  trend: ExecutiveTrendPoint[];
  totals: {
    headcount: number;
    activeObjects: number;
    onlineObjects: number;
    criticalEmployees: number;
    portalErrors: number;
    dueActions: number;
    uploads30Days: number;
    successRate: number;
  };
};

const DAY_MS = 86_400_000;

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function weekStart(value: Date): Date {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function responsibleHistoryUserId(owner: string, responsibleUserId?: string): string {
  return responsibleUserId ?? legacyUserId(owner) ?? owner;
}

export function buildExecutiveReport(
  state: StudioState,
  now = new Date(),
): ExecutiveReport {
  if (!state.management) {
    return {
      employees: [],
      units: [],
      trend: [],
      totals: {
        headcount: 0,
        activeObjects: 0,
        onlineObjects: 0,
        criticalEmployees: 0,
        portalErrors: 0,
        dueActions: 0,
        uploads30Days: 0,
        successRate: 100,
      },
    };
  }
  const management = state.management;
  const thirtyDaysAgo = now.getTime() - 30 * DAY_MS;
  const metrics = buildStaffOperationalMetrics(state, now);
  const historyRows = (state.uploadRunHistory ?? []).flatMap((entry) => entry.listings)
    .filter((listing) => (
      timestamp(listing.uploadedAt ?? listing.lastAttemptAt) >= thirtyDaysAgo
    ));
  const projectRows = state.projects.map((project) => ({
    project,
    responsibleUserId: projectResponsibleUserId(project),
  }));

  const employees: ExecutiveEmployeeRow[] = metrics.map((metric) => {
    const userHistory = historyRows.filter((listing) => (
      responsibleHistoryUserId(listing.owner, listing.responsibleUserId) === metric.user.id
    ));
    const operations = projectRows
      .filter((row) => row.responsibleUserId === metric.user.id)
      .flatMap((row) => row.project.listings)
      .flatMap((listing) => listing.management?.portals ?? [])
      .flatMap((portal) => portal.operationLog ?? [])
      .filter((entry) => timestamp(entry.at) >= thirtyDaysAgo);
    const successfulOperations30Days = operations.filter((entry) => (
      entry.status === "succeeded" || entry.status === "confirmed"
    )).length;
    const failedOperations30Days = operations.filter((entry) => (
      entry.status === "failed"
    )).length;
    const operationTotal = successfulOperations30Days + failedOperations30Days;
    const completedAppointments30Days = projectRows
      .filter((row) => row.responsibleUserId === metric.user.id)
      .flatMap((row) => row.project.listings)
      .flatMap((listing) => listing.management?.appointments ?? [])
      .filter((appointment) => (
        appointment.status === "completed"
        && timestamp(appointment.startsAt) >= thirtyDaysAgo
      )).length;
    return {
      userId: metric.user.id,
      name: metric.user.name,
      status: metric.status,
      unitNames: management.organizationUnits
        .filter((unit) => metric.user.organizationUnitIds.includes(unit.id))
        .map((unit) => unit.name),
      activeObjects: metric.activeObjects,
      onlineObjects: metric.online,
      portalErrors: metric.portalErrors,
      dueActions: metric.dueActions + metric.dueRenewals,
      staleObjects: metric.staleObjects,
      uploads30Days: userHistory.filter((listing) => listing.status === "uploaded").length,
      successfulOperations30Days,
      failedOperations30Days,
      successRate: operationTotal
        ? Math.round((successfulOperations30Days / operationTotal) * 100)
        : 100,
      completedAppointments30Days,
    };
  });

  const units = management.organizationUnits
    .filter((unit) => unit.active)
    .map((unit): ExecutiveUnitRow => {
      const unitIds = descendantUnitIds(management.organizationUnits, [unit.id]);
      const userIds = new Set(management.users
        .filter((user) => (
          user.active
          && user.organizationUnitIds.some((unitId) => unitIds.has(unitId))
        ))
        .map((user) => user.id));
      const unitEmployees = employees.filter((employee) => userIds.has(employee.userId));
      const successful = unitEmployees.reduce(
        (sum, employee) => sum + employee.successfulOperations30Days,
        0,
      );
      const failed = unitEmployees.reduce(
        (sum, employee) => sum + employee.failedOperations30Days,
        0,
      );
      return {
        unit,
        headcount: unitEmployees.length,
        activeObjects: unitEmployees.reduce((sum, employee) => sum + employee.activeObjects, 0),
        onlineObjects: unitEmployees.reduce((sum, employee) => sum + employee.onlineObjects, 0),
        criticalEmployees: unitEmployees.filter((employee) => employee.status === "critical").length,
        portalErrors: unitEmployees.reduce((sum, employee) => sum + employee.portalErrors, 0),
        dueActions: unitEmployees.reduce((sum, employee) => sum + employee.dueActions, 0),
        uploads30Days: unitEmployees.reduce((sum, employee) => sum + employee.uploads30Days, 0),
        successRate: successful + failed
          ? Math.round((successful / (successful + failed)) * 100)
          : 100,
      };
    })
    .sort((left, right) => (
      right.criticalEmployees - left.criticalEmployees
      || right.portalErrors - left.portalErrors
      || left.unit.name.localeCompare(right.unit.name, "de")
    ));

  const currentWeek = weekStart(now);
  const trend = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(currentWeek.getTime() - (5 - index) * 7 * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const rows = (state.uploadRunHistory ?? []).flatMap((entry) => entry.listings)
      .filter((listing) => {
        const at = timestamp(listing.uploadedAt ?? listing.lastAttemptAt);
        return at >= start.getTime() && at < end.getTime();
      });
    return {
      key: start.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
      }).format(start),
      uploads: rows.filter((listing) => listing.status === "uploaded").length,
      failures: rows.filter((listing) => (
        listing.status === "failed" || listing.status === "unknown"
      )).length,
    };
  });

  const successful = employees.reduce(
    (sum, employee) => sum + employee.successfulOperations30Days,
    0,
  );
  const failed = employees.reduce(
    (sum, employee) => sum + employee.failedOperations30Days,
    0,
  );
  return {
    employees,
    units,
    trend,
    totals: {
      headcount: employees.length,
      activeObjects: employees.reduce((sum, employee) => sum + employee.activeObjects, 0),
      onlineObjects: employees.reduce((sum, employee) => sum + employee.onlineObjects, 0),
      criticalEmployees: employees.filter((employee) => employee.status === "critical").length,
      portalErrors: employees.reduce((sum, employee) => sum + employee.portalErrors, 0),
      dueActions: employees.reduce((sum, employee) => sum + employee.dueActions, 0),
      uploads30Days: employees.reduce((sum, employee) => sum + employee.uploads30Days, 0),
      successRate: successful + failed
        ? Math.round((successful / (successful + failed)) * 100)
        : 100,
    },
  };
}
