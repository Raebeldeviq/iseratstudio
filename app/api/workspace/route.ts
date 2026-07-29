import type { StudioState } from "../../types";
import { getCloudDatabase } from "../../../db";
import { WORKSPACE_ID } from "../../../db/schema";
import {
  requireWorkspaceSession,
  routeErrorResponse,
  synchronizeWorkspaceUsers,
  WorkspaceHttpError,
} from "../../lib/server/workspace-auth";

type WorkspaceRow = {
  revision: number;
  state_json: string;
  updated_at: string;
  updated_by: string;
};

type WorkspacePayload = {
  state?: StudioState;
  baseRevision?: number;
  force?: boolean;
};

function validStudioState(value: unknown): value is StudioState {
  const state = value as Partial<StudioState> | null;
  return Boolean(
    state
    && state.version === 1
    && Array.isArray(state.houses)
    && Array.isArray(state.projects),
  );
}

function parseState(row: WorkspaceRow | null): StudioState | null {
  if (!row) return null;
  const state = JSON.parse(row.state_json) as unknown;
  if (!validStudioState(state)) {
    throw new WorkspaceHttpError(500, "Der zentrale Arbeitsstand ist beschädigt.");
  }
  return state;
}

function preserveAdminSections(
  submitted: StudioState,
  current: StudioState | null,
): StudioState {
  if (!current?.management || !submitted.management) return submitted;
  return {
    ...submitted,
    management: {
      ...submitted.management,
      users: current.management.users,
      company: current.management.company,
    },
  };
}

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    const database = await getCloudDatabase();
    const row = await database
      .prepare(
        `SELECT revision, state_json, updated_at, updated_by
         FROM workspace_state
         WHERE id = ?`,
      )
      .bind(WORKSPACE_ID)
      .first<WorkspaceRow>();

    return Response.json({
      session,
      workspace: row
        ? {
            revision: row.revision,
            state: parseState(row),
            savedAt: row.updated_at,
            savedBy: row.updated_by,
          }
        : null,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireWorkspaceSession();
    if (session.role === "viewer") {
      throw new WorkspaceHttpError(403, "Mit Leserechten kann der Arbeitsstand nicht verändert werden.");
    }

    const payload = await request.json() as WorkspacePayload;
    if (!validStudioState(payload.state)) {
      throw new WorkspaceHttpError(400, "Der übermittelte Arbeitsstand ist ungültig.");
    }

    const database = await getCloudDatabase();
    const currentRow = await database
      .prepare(
        `SELECT revision, state_json, updated_at, updated_by
         FROM workspace_state
         WHERE id = ?`,
      )
      .bind(WORKSPACE_ID)
      .first<WorkspaceRow>();
    const currentState = parseState(currentRow);
    const baseRevision = Number.isInteger(payload.baseRevision)
      ? Number(payload.baseRevision)
      : 0;

    if (currentRow && !payload.force && baseRevision !== currentRow.revision) {
      return Response.json({
        error: "Der Arbeitsstand wurde inzwischen auf einem anderen Gerät geändert.",
        conflict: {
          revision: currentRow.revision,
          state: currentState,
          savedAt: currentRow.updated_at,
        },
      }, { status: 409 });
    }

    const state = session.role === "admin"
      ? payload.state
      : preserveAdminSections(payload.state, currentState);
    await synchronizeWorkspaceUsers(state, session);

    const now = new Date().toISOString();
    const nextRevision = (currentRow?.revision ?? 0) + 1;
    const stateJson = JSON.stringify(state);
    const statements = [];

    if (currentRow) {
      statements.push(
        database
          .prepare(
            `INSERT INTO workspace_backups
              (workspace_id, revision, state_json, saved_at, saved_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            WORKSPACE_ID,
            currentRow.revision,
            currentRow.state_json,
            currentRow.updated_at,
            currentRow.updated_by,
          ),
      );
      statements.push(payload.force
        ? database
            .prepare(
              `UPDATE workspace_state
               SET revision = ?, state_json = ?, updated_at = ?, updated_by = ?
               WHERE id = ?`,
            )
            .bind(nextRevision, stateJson, now, session.id, WORKSPACE_ID)
        : database
            .prepare(
              `UPDATE workspace_state
               SET revision = ?, state_json = ?, updated_at = ?, updated_by = ?
               WHERE id = ? AND revision = ?`,
            )
            .bind(
              nextRevision,
              stateJson,
              now,
              session.id,
              WORKSPACE_ID,
              currentRow.revision,
            ));
    } else {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO workspace_state
              (id, revision, state_json, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(WORKSPACE_ID, nextRevision, stateJson, now, session.id),
      );
    }
    statements.push(
      database.prepare(
        `DELETE FROM workspace_backups
         WHERE workspace_id = ?
           AND id NOT IN (
             SELECT id FROM workspace_backups
             WHERE workspace_id = ?
             ORDER BY revision DESC
             LIMIT 25
           )`,
      ).bind(WORKSPACE_ID, WORKSPACE_ID),
    );
    const results = await database.batch(statements);
    const writeIndex = currentRow ? 1 : 0;
    if (Number(results[writeIndex]?.meta.changes ?? 0) !== 1) {
      const latest = await database
        .prepare(
          `SELECT revision, state_json, updated_at, updated_by
           FROM workspace_state
           WHERE id = ?`,
        )
        .bind(WORKSPACE_ID)
        .first<WorkspaceRow>();
      return Response.json({
        error: "Der Arbeitsstand wurde inzwischen auf einem anderen Gerät geändert.",
        conflict: latest
          ? {
              revision: latest.revision,
              state: parseState(latest),
              savedAt: latest.updated_at,
            }
          : null,
      }, { status: 409 });
    }

    return Response.json({
      session,
      workspace: {
        revision: nextRevision,
        state,
        savedAt: now,
        savedBy: session.id,
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
