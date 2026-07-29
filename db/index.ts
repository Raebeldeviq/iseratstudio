import { SCHEMA_STATEMENTS } from "./schema";

type CloudBindings = {
  DB?: D1Database;
  FILES?: R2Bucket;
  BOOTSTRAP_ADMIN_EMAIL?: string;
};

async function getCloudBindings(): Promise<CloudBindings> {
  const runtime = await import("cloudflare:workers");
  return runtime.env as CloudBindings;
}

export async function getCloudDatabase(): Promise<D1Database> {
  const database = (await getCloudBindings()).DB;
  if (!database) {
    throw new Error("Die zentrale Datenbank ist noch nicht mit DB verbunden.");
  }
  return database;
}

export async function getCloudFiles(): Promise<R2Bucket> {
  const files = (await getCloudBindings()).FILES;
  if (!files) {
    throw new Error("Der zentrale Dateispeicher ist noch nicht mit FILES verbunden.");
  }
  return files;
}

export async function getBootstrapAdminEmail(): Promise<string> {
  return (await getCloudBindings()).BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
}

let schemaReady: Promise<void> | null = null;

export async function ensureCloudSchema(database: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = database
      .batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}
