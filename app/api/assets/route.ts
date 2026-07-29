import { getCloudDatabase, getCloudFiles } from "../../../db";
import { WORKSPACE_ID } from "../../../db/schema";
import type { StudioState } from "../../types";
import { normalizeStudioManagementState } from "../../lib/management";
import {
  filterStudioStateForActor,
  resolveActor,
} from "../../lib/organization";
import {
  requireWorkspaceSession,
  routeErrorResponse,
  WorkspaceHttpError,
} from "../../lib/server/workspace-auth";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const KEY_PATTERN = /^assets\/[a-f0-9]{64}$/;

function assetKeys(state: StudioState): Set<string> {
  return new Set([
    ...state.houses.flatMap((house) => house.images),
    ...(state.promotionImages ?? []),
    ...(state.promotionImage ? [state.promotionImage] : []),
    ...state.projects.flatMap((project) => (
      project.listings.flatMap((listing) => listing.management?.media ?? [])
    )),
    ...(state.management?.files ?? []),
  ].flatMap((item) => item.storageKey ? [item.storageKey] : []));
}

function safeFilename(value: string | null): string {
  if (!value) return "Datei";
  try {
    return decodeURIComponent(value).slice(0, 240) || "Datei";
  } catch {
    return "Datei";
  }
}

function hexDigest(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(request: Request) {
  try {
    const session = await requireWorkspaceSession();
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!KEY_PATTERN.test(key)) {
      throw new WorkspaceHttpError(400, "Ungültiger Dateischlüssel.");
    }
    const database = await getCloudDatabase();
    const workspace = await database
      .prepare("SELECT state_json FROM workspace_state WHERE id = ?")
      .bind(WORKSPACE_ID)
      .first<{ state_json: string }>();
    if (workspace) {
      const fullState = normalizeStudioManagementState(
        JSON.parse(workspace.state_json) as StudioState,
      );
      const actor = resolveActor(fullState.management, session);
      if (!actor) {
        throw new WorkspaceHttpError(403, "Kein Zugriff auf diese Datei.");
      }
      const visibleState = filterStudioStateForActor(fullState, actor);
      if (!assetKeys(visibleState).has(key)) {
        throw new WorkspaceHttpError(403, "Diese Datei gehört nicht zu deinem sichtbaren Bereich.");
      }
    }

    const object = await (await getCloudFiles()).get(key);
    if (!object) throw new WorkspaceHttpError(404, "Datei nicht gefunden.");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(object.body, { headers });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireWorkspaceSession();
    if (session.role === "viewer") {
      throw new WorkspaceHttpError(403, "Mit Leserechten können keine Dateien gespeichert werden.");
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_FILE_BYTES) {
      throw new WorkspaceHttpError(413, "Eine Datei darf höchstens 25 MB groß sein.");
    }
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
      throw new WorkspaceHttpError(413, "Die Datei ist leer oder größer als 25 MB.");
    }

    const fingerprint = hexDigest(await crypto.subtle.digest("SHA-256", bytes));
    const expected = request.headers.get("x-asset-fingerprint");
    if (expected && expected !== fingerprint) {
      throw new WorkspaceHttpError(400, "Die Datei konnte nicht eindeutig geprüft werden.");
    }

    const key = `assets/${fingerprint}`;
    const mimeType = request.headers.get("content-type") || "application/octet-stream";
    const filename = safeFilename(request.headers.get("x-asset-name"));
    const files = await getCloudFiles();
    if (!await files.head(key)) {
      await files.put(key, bytes, {
        httpMetadata: { contentType: mimeType },
        customMetadata: {
          filename: encodeURIComponent(filename),
          uploadedBy: session.id,
        },
      });
    }

    const now = new Date().toISOString();
    await (await getCloudDatabase())
      .prepare(
        `INSERT INTO cloud_files
          (storage_key, fingerprint, filename, mime_type, size, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(storage_key) DO NOTHING`,
      )
      .bind(key, fingerprint, filename, mimeType, bytes.byteLength, now, session.id)
      .run();

    return Response.json({
      asset: {
        storageKey: key,
        fingerprint,
        filename,
        mimeType,
        size: bytes.byteLength,
      },
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
