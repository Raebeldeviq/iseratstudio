import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const WORKSPACE_ID = "primary";

export const workspaceUsers = sqliteTable("workspace_users", {
  id: text("id").primaryKey().notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastActiveAt: text("last_active_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("workspace_users_email_idx").on(table.email),
  check(
    "workspace_users_role_check",
    sql`${table.role} IN ('admin', 'editor', 'viewer')`,
  ),
]);

export const workspaceState = sqliteTable("workspace_state", {
  id: text("id").primaryKey().notNull(),
  revision: integer("revision").notNull().default(1),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => workspaceUsers.id),
});

export const workspaceBackups = sqliteTable("workspace_backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  revision: integer("revision").notNull(),
  stateJson: text("state_json").notNull(),
  savedAt: text("saved_at").notNull(),
  savedBy: text("saved_by").notNull(),
}, (table) => [
  index("workspace_backups_workspace_idx").on(table.workspaceId, table.revision),
]);

export const cloudFiles = sqliteTable("cloud_files", {
  storageKey: text("storage_key").primaryKey().notNull(),
  fingerprint: text("fingerprint").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => workspaceUsers.id),
}, (table) => [
  index("cloud_files_fingerprint_idx").on(table.fingerprint),
]);

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS workspace_users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_users_email_idx
    ON workspace_users (email)`,
  `CREATE TABLE IF NOT EXISTS workspace_state (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    FOREIGN KEY (updated_by) REFERENCES workspace_users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    saved_by TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_backups_workspace_idx
    ON workspace_backups (workspace_id, revision DESC)`,
  `CREATE TABLE IF NOT EXISTS cloud_files (
    storage_key TEXT PRIMARY KEY NOT NULL,
    fingerprint TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES workspace_users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS cloud_files_fingerprint_idx
    ON cloud_files (fingerprint)`,
] as const;
