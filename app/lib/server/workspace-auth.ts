import { getChatGPTUser } from "../../chatgpt-auth";
import type { ManagementRole, StudioState } from "../../types";
import {
  ensureCloudSchema,
  getBootstrapAdminEmail,
  getCloudDatabase,
} from "../../../db";

export type WorkspaceSession = {
  id: string;
  email: string;
  name: string;
  role: ManagementRole;
};

type WorkspaceUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: ManagementRole;
  active: number;
};

export class WorkspaceHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function authUserId(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `auth-${Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const identity = await getChatGPTUser();
  if (!identity) {
    throw new WorkspaceHttpError(
      401,
      "Bitte melde dich mit deinem persönlichen ChatGPT-Konto an.",
    );
  }

  const database = await getCloudDatabase();
  await ensureCloudSchema(database);
  const email = identity.email.trim().toLowerCase();
  let row = await database
    .prepare(
      `SELECT id, email, display_name, role, active
       FROM workspace_users
       WHERE email = ?`,
    )
    .bind(email)
    .first<WorkspaceUserRow>();

  if (!row) {
    const count = await database
      .prepare("SELECT COUNT(*) AS count FROM workspace_users WHERE active = 1")
      .first<{ count: number }>();
    const bootstrapAdminEmail = await getBootstrapAdminEmail();
    if (
      Number(count?.count ?? 0) > 0
      || (bootstrapAdminEmail && bootstrapAdminEmail !== email)
    ) {
      throw new WorkspaceHttpError(
        403,
        "Dieses Konto ist für Inserate Studio noch nicht freigeschaltet. Ein Administrator kann deine E-Mail unter Benutzer hinterlegen.",
      );
    }

    const id = await authUserId(email);
    await database
      .prepare(
        `INSERT INTO workspace_users
          (id, email, display_name, role, active, created_at, last_active_at)
         VALUES (?, ?, ?, 'admin', 1, ?, ?)`,
      )
      .bind(id, email, identity.displayName, new Date().toISOString(), new Date().toISOString())
      .run();
    row = {
      id,
      email,
      display_name: identity.displayName,
      role: "admin",
      active: 1,
    };
  }

  if (!row.active) {
    throw new WorkspaceHttpError(403, "Dieses Benutzerkonto ist deaktiviert.");
  }

  const name = identity.fullName?.trim() || row.display_name || identity.displayName;
  await database
    .prepare(
      `UPDATE workspace_users
       SET display_name = ?, last_active_at = ?
       WHERE id = ?`,
    )
    .bind(name, new Date().toISOString(), row.id)
    .run();

  return {
    id: row.id,
    email: row.email,
    name,
    role: row.role,
  };
}

export async function synchronizeWorkspaceUsers(
  state: StudioState,
  actor: WorkspaceSession,
): Promise<void> {
  if (actor.role !== "admin") return;
  const users = (state.management?.users ?? [])
    .filter((user) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim()))
    .map((user) => ({
      ...user,
      email: user.email.trim().toLowerCase(),
      name: user.name.trim() || user.email.trim().toLowerCase(),
    }));

  const activeAdmins = users.filter((user) => user.active && user.role === "admin");
  if (!activeAdmins.length) {
    throw new WorkspaceHttpError(
      400,
      "Mindestens ein aktiver Administrator mit gültiger E-Mail muss erhalten bleiben.",
    );
  }
  const actorEntry = users.find((user) => user.email === actor.email);
  if (!actorEntry?.active) {
    throw new WorkspaceHttpError(
      400,
      "Das eigene angemeldete Konto kann nicht deaktiviert oder entfernt werden.",
    );
  }

  const database = await getCloudDatabase();
  const now = new Date().toISOString();
  const statements = await Promise.all(users.map(async (user) => (
    database
      .prepare(
        `INSERT INTO workspace_users
          (id, email, display_name, role, active, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           display_name = excluded.display_name,
           role = excluded.role,
           active = excluded.active`,
      )
      .bind(
        await authUserId(user.email),
        user.email,
        user.name,
        user.role,
        user.active ? 1 : 0,
        user.createdAt || now,
        user.lastActiveAt || now,
      )
  )));
  const invitedEmails = new Set(users.map((user) => user.email));
  const existing = await database
    .prepare("SELECT email FROM workspace_users")
    .all<{ email: string }>();
  for (const row of existing.results) {
    if (row.email !== actor.email && !invitedEmails.has(row.email)) {
      statements.push(
        database
          .prepare("UPDATE workspace_users SET active = 0 WHERE email = ?")
          .bind(row.email),
      );
    }
  }
  if (statements.length) await database.batch(statements);
}

export function routeErrorResponse(error: unknown): Response {
  if (error instanceof WorkspaceHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unbekannter Serverfehler";
  return Response.json({ error: message }, { status: 500 });
}
