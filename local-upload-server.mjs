import { Client } from "basic-ftp";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { Readable } from "node:stream";
import appPackage from "./package.json" with { type: "json" };
import { generateAiImageCaptions, generateAiListing, validateOpenAiApiKey } from "./ai-text-service.mjs";
import {
  clearCredentialVault,
  loadCredentialVault,
  saveCredentialVault,
} from "./credential-vault.mjs";
import {
  commitCatalogSnapshot,
  loadCatalogSnapshot,
  loadCatalogImage,
  loadCatalogManifest,
  saveCatalogSnapshot,
  saveCatalogImage,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import {
  deleteMediaLibraryDuplicateItems,
  deleteMediaLibraryImage,
  findMediaLibraryDuplicates,
  getMediaLibraryItem,
  queryMediaLibrary,
  recommendedMediaSequence,
  saveMediaLibraryImage,
} from "./media-library.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

const HOST = "127.0.0.1";
const PORT = 43182;
const MAX_BODY_BYTES = 180 * 1024 * 1024;
const MAX_CATALOG_BODY_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");
const allowedOrigins = new Set([
  "http://localhost:43181",
  "http://127.0.0.1:43181",
]);

function headers(origin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://localhost:43181",
    "Access-Control-Allow-Headers": "Content-Type, X-FPI-Filename, X-FPI-Ftp-Host, X-FPI-Ftp-User, X-FPI-Ftp-Password, X-FPI-Ftp-Path, X-FPI-Media-Filename, X-FPI-Media-Kind, X-FPI-Media-Group",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function send(response, status, payload, origin = "") {
  response.writeHead(status, headers(origin));
  response.end(JSON.stringify(payload));
}

function isGitLfsPointer(data) {
  return data.length < 1024
    && data.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1");
}

function publicMediaItem(item) {
  return {
    id: item.id,
    relativePath: item.relativePath,
    filename: item.filename,
    caption: item.caption,
    mimeType: item.mimeType,
    collection: item.collection,
    family: item.family,
    houseModel: item.houseModel,
    group: item.group,
    kind: item.kind,
    role: item.role,
    captionLocked: item.captionLocked === true,
    brandedCover: item.brandedCover === true,
    managed: item.managed === true,
    deletable: item.deletable !== false,
    imageUrl: `http://${HOST}:${PORT}/media-library/image?id=${encodeURIComponent(item.id)}`,
  };
}

function safeFilename(value) {
  const filename = String(value || "fabian-pascal-import.zip")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`;
}

function decodedHeader(request, name) {
  const value = request.headers[name];
  if (!value) return "";
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

async function mediaLibraryReferenceCount(sourceId) {
  return (await mediaLibraryReferenceCounts()).get(sourceId) || 0;
}

async function mediaLibraryReferenceCounts() {
  const catalog = await loadCatalogManifest();
  const counts = new Map();
  if (!catalog.stored || !Array.isArray(catalog.state?.houses)) return counts;
  for (const house of catalog.state.houses) {
    if (!Array.isArray(house.images)) continue;
    for (const image of house.images) {
      const sourceId = String(image?.sourceId || "");
      if (!sourceId) continue;
      counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    }
  }
  return counts;
}

async function logUpload(event, details = {}) {
  try {
    await mkdir(dirname(UPLOAD_LOG_PATH), { recursive: true });
    await appendFile(
      UPLOAD_LOG_PATH,
      `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch {
    // Ein Diagnoseprotokoll darf den eigentlichen Upload nicht blockieren.
  }
}

async function readJson(request, maximumBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("Die lokale Anfrage ist zu groß.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBytes(request, maximumBytes = MAX_IMAGE_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("Die einzelne Bilddatei ist zu groß.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveToDownloads(archive, requestedFilename) {
  const downloadsDirectory = join(homedir(), "Downloads");
  await mkdir(downloadsDirectory, { recursive: true });

  const filename = safeFilename(requestedFilename);
  const parts = parse(filename);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? filename
      : `${parts.name} (${index})${parts.ext}`;
    const candidatePath = join(downloadsDirectory, candidateName);
    let handle;
    try {
      handle = await open(candidatePath, "wx");
      await handle.writeFile(archive);
      await handle.close();
      return { filename: candidateName, path: candidatePath };
    } catch (error) {
      await handle?.close();
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Im Downloadordner konnte kein freier Dateiname gefunden werden.");
}

const server = createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  const pathname = requestUrl.pathname;
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers(origin));
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    send(response, 200, {
      ok: true,
      service: "fabian-pascal-helper",
      version: appPackage.version,
    }, origin);
    return;
  }

  const isUpload = request.method === "POST" && pathname === "/upload";
  const isBinaryUpload = request.method === "POST" && pathname === "/upload-binary";
  const isLocalSave = request.method === "POST" && pathname === "/save-package";
  const isTextGeneration = request.method === "POST" && pathname === "/generate-texts";
  const isImageCaptionGeneration = request.method === "POST" && pathname === "/generate-image-captions";
  const isOpenAiKeyValidation = request.method === "POST" && pathname === "/validate-openai-key";
  const isCredentialLoad = request.method === "GET" && pathname === "/credentials";
  const isCredentialSave = request.method === "POST" && pathname === "/credentials";
  const isCatalogLoad = request.method === "GET" && pathname === "/catalog";
  const isCatalogSave = request.method === "POST" && pathname === "/catalog";
  const isCatalogV2Start = request.method === "POST" && pathname === "/catalog-v2/start";
  const isCatalogV2ImageSave = request.method === "POST" && pathname === "/catalog-v2/image";
  const isCatalogV2Commit = request.method === "POST" && pathname === "/catalog-v2/commit";
  const isCatalogV2ManifestLoad = request.method === "GET" && pathname === "/catalog-v2/manifest";
  const isCatalogV2ImageLoad = request.method === "GET" && pathname === "/catalog-v2/image";
  const isMediaLibraryList = request.method === "GET" && pathname === "/media-library";
  const isMediaLibrarySequence = request.method === "GET" && pathname === "/media-library/sequence";
  const isMediaLibraryImage = request.method === "GET" && pathname === "/media-library/image";
  const isMediaLibraryImageSave = request.method === "POST" && pathname === "/media-library/image";
  const isMediaLibraryImageDelete = request.method === "DELETE" && pathname === "/media-library/image";
  const isMediaLibraryDuplicates = request.method === "GET" && pathname === "/media-library/duplicates";
  const isMediaLibraryDeduplicate = request.method === "POST" && pathname === "/media-library/deduplicate";
  if (!isUpload && !isBinaryUpload && !isLocalSave && !isTextGeneration && !isImageCaptionGeneration && !isOpenAiKeyValidation && !isCredentialLoad && !isCredentialSave && !isCatalogLoad && !isCatalogSave && !isCatalogV2Start && !isCatalogV2ImageSave && !isCatalogV2Commit && !isCatalogV2ManifestLoad && !isCatalogV2ImageLoad && !isMediaLibraryList && !isMediaLibrarySequence && !isMediaLibraryImage && !isMediaLibraryImageSave && !isMediaLibraryImageDelete && !isMediaLibraryDuplicates && !isMediaLibraryDeduplicate) {
    send(response, 404, { ok: false, message: "Nicht gefunden." }, origin);
    return;
  }

  if (origin && !allowedOrigins.has(origin)) {
    send(response, 403, { ok: false, message: "Diese Anwendung darf den Upload-Helfer nicht verwenden." }, origin);
    return;
  }
  if (
    (isMediaLibraryImageSave || isMediaLibraryImageDelete || isMediaLibraryDeduplicate)
    && !allowedOrigins.has(origin)
  ) {
    send(response, 403, {
      ok: false,
      message: "Medien dürfen nur direkt aus dem Inseratestudio verändert werden.",
    }, origin);
    return;
  }

  let client;
  let temporaryUploadPath = "";
  let uploadTransferStarted = false;
  let requestedTextModel = "gpt-5.6-luna";
  try {
    if (isMediaLibraryImageSave) {
      const result = await saveMediaLibraryImage({
        filename: decodedHeader(request, "x-fpi-media-filename"),
        kind: decodedHeader(request, "x-fpi-media-kind"),
        group: decodedHeader(request, "x-fpi-media-group"),
        mimeType: request.headers["content-type"],
        data: await readBytes(request),
      });
      send(response, 201, {
        ok: true,
        created: true,
        item: publicMediaItem(result.item),
        message: `„${result.item.filename}“ wurde dauerhaft in der Medienbibliothek gespeichert.`,
      }, origin);
      return;
    }

    if (isMediaLibraryImageDelete) {
      const id = String(requestUrl.searchParams.get("id") || "");
      const item = await getMediaLibraryItem(id);
      if (!item) {
        send(response, 404, {
          ok: false,
          message: "Das Bild wurde in der Medienbibliothek nicht gefunden.",
        }, origin);
        return;
      }
      const referenceCount = await mediaLibraryReferenceCount(item.id);
      const force = ["1", "true"].includes(
        String(requestUrl.searchParams.get("force") || "").toLocaleLowerCase("en-US"),
      );
      if (referenceCount > 0 && !force) {
        send(response, 409, {
          ok: false,
          requiresConfirmation: true,
          referenceCount,
          message: `Das Bild ist noch ${referenceCount}-mal einem Haustyp zugeordnet. Bereits übernommene Kopien bleiben bei einer Löschung erhalten.`,
        }, origin);
        return;
      }
      const result = await deleteMediaLibraryImage(item.id);
      send(response, 200, {
        ok: true,
        ...result,
        referenceCount,
        message: result.deletionMode === "deleted"
          ? `„${item.filename}“ wurde dauerhaft aus der Medienbibliothek gelöscht.`
          : `„${item.filename}“ wurde dauerhaft aus der Medienbibliothek ausgeblendet.`,
      }, origin);
      return;
    }

    if (isMediaLibraryDuplicates) {
      const referenceCounts = await mediaLibraryReferenceCounts();
      const result = await findMediaLibraryDuplicates({ referenceCounts });
      send(response, 200, {
        ok: true,
        groupCount: result.groupCount,
        duplicateCount: result.duplicateCount,
        affectedItemCount: result.affectedItemCount,
        redundantBytes: result.redundantBytes,
        physicallyReclaimableBytes: result.physicallyReclaimableBytes,
        groups: result.groups.map((group) => {
          const publicGroup = { ...group };
          delete publicGroup.contentHash;
          return {
            ...publicGroup,
            items: group.items.map((item) => ({
              ...publicMediaItem(item),
              bytes: item.bytes,
              referenceCount: item.referenceCount,
            })),
          };
        }),
      }, origin);
      return;
    }

    if (isMediaLibraryDeduplicate) {
      const payload = await readJson(request, 1024 * 1024);
      const deleteIds = Array.isArray(payload?.deleteIds) ? payload.deleteIds : [];
      const force = ["1", "true"].includes(
        String(requestUrl.searchParams.get("force") || "").toLocaleLowerCase("en-US"),
      );
      const referenceCounts = await mediaLibraryReferenceCounts();
      const referencedIds = [...new Set(deleteIds.map((id) => String(id || "")))]
        .filter((id) => (referenceCounts.get(id) || 0) > 0);
      if (referencedIds.length && !force) {
        send(response, 409, {
          ok: false,
          requiresConfirmation: true,
          referenceCount: referencedIds.reduce(
            (sum, id) => sum + (referenceCounts.get(id) || 0),
            0,
          ),
          message: `${referencedIds.length} ausgewählte Dubletten werden noch in Hausvorlagen verwendet. Bereits übernommene Kopien bleiben bei der Bereinigung erhalten.`,
        }, origin);
        return;
      }
      const result = await deleteMediaLibraryDuplicateItems(deleteIds, {
        force,
        referenceCounts,
      });
      send(response, 200, {
        ok: true,
        ...result,
        message: `${result.results.length} Dubletten wurden dauerhaft bereinigt. In jeder Gruppe ist ein Original erhalten geblieben.`,
      }, origin);
      return;
    }

    if (isMediaLibrarySequence) {
      const result = await recommendedMediaSequence(requestUrl.searchParams.get("coverId"));
      send(response, 200, {
        ok: true,
        warnings: result.warnings,
        priceMatch: result.priceMatch,
        items: result.items.map(publicMediaItem),
      }, origin);
      return;
    }

    if (isMediaLibraryList) {
      const result = await queryMediaLibrary({
        query: requestUrl.searchParams.get("query") || "",
        group: requestUrl.searchParams.get("group") || "",
        kind: requestUrl.searchParams.get("kind") || "",
        page: requestUrl.searchParams.get("page") || 1,
        pageSize: requestUrl.searchParams.get("pageSize") || 36,
      });
      send(response, 200, {
        ok: true,
        available: result.available,
        total: result.total,
        libraryTotal: result.libraryTotal,
        page: result.page,
        pages: result.pages,
        pageSize: result.pageSize,
        groups: result.groups,
        items: result.items.map(publicMediaItem),
      }, origin);
      return;
    }

    if (isMediaLibraryImage) {
      const item = await getMediaLibraryItem(requestUrl.searchParams.get("id"));
      if (!item) {
        send(response, 404, {
          ok: false,
          message: "Das Bild wurde in der Medienbibliothek nicht gefunden.",
        }, origin);
        return;
      }
      const fileStats = await stat(item.absolutePath);
      if (!fileStats.isFile() || fileStats.size > MAX_IMAGE_BYTES) {
        throw new Error("Das Bild ist ungültig oder größer als 100 MB.");
      }
      const data = await readFile(item.absolutePath);
      if (isGitLfsPointer(data)) {
        throw new Error("Die Bildoriginale wurden noch nicht geladen. Bitte im App-Ordner zuerst „git lfs pull“ ausführen.");
      }
      response.writeHead(200, {
        ...headers(origin),
        "Content-Type": item.mimeType,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
      });
      response.end(data);
      return;
    }

    if (isCatalogV2ManifestLoad) {
      const result = await loadCatalogManifest();
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogV2ImageLoad) {
      const result = await loadCatalogImage(requestUrl.searchParams.get("imageId"));
      response.writeHead(200, {
        ...headers(origin),
        "Content-Type": result.mimeType,
        "Content-Length": String(result.data.length),
      });
      response.end(result.data);
      return;
    }

    if (isCatalogLoad) {
      const result = await loadCatalogSnapshot();
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCredentialLoad) {
      const result = await loadCredentialVault();
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogV2ImageSave) {
      const result = await saveCatalogImage({
        sessionId: requestUrl.searchParams.get("sessionId"),
        imageId: requestUrl.searchParams.get("imageId"),
        data: await readBytes(request),
      });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isBinaryUpload) {
      const filename = safeFilename(decodedHeader(request, "x-fpi-filename"));
      const ftp = {
        host: decodedHeader(request, "x-fpi-ftp-host"),
        user: decodedHeader(request, "x-fpi-ftp-user"),
        password: decodedHeader(request, "x-fpi-ftp-password"),
        remotePath: decodedHeader(request, "x-fpi-ftp-path") || "/",
      };
      if (!ftp.host || !ftp.user || !ftp.password) {
        throw new Error("Der FTP-Zugang ist unvollständig.");
      }

      const stagingDirectory = join(dirname(UPLOAD_LOG_PATH), "upload-staging");
      await mkdir(stagingDirectory, { recursive: true });
      temporaryUploadPath = join(stagingDirectory, `${randomUUID()}.zip`);
      const handle = await open(temporaryUploadPath, "wx");
      let archiveBytes = 0;
      let nextProgressLog = 25 * 1024 * 1024;
      await logUpload("receiving-started", {
        filename,
        expectedBytes: Number(request.headers["content-length"] || 0),
        host: ftp.host,
        remotePath: ftp.remotePath,
      });
      try {
        for await (const chunk of request) {
          archiveBytes += chunk.length;
          if (archiveBytes > MAX_UPLOAD_BYTES) {
            throw new Error("Das Importpaket ist größer als 1 GB.");
          }
          await handle.write(chunk);
          if (archiveBytes >= nextProgressLog) {
            await logUpload("receiving-progress", { filename, archiveBytes });
            nextProgressLog += 25 * 1024 * 1024;
          }
        }
      } finally {
        await handle.close();
      }
      if (!archiveBytes) throw new Error("Das Importpaket ist leer.");
      await logUpload("received", { filename, archiveBytes, host: ftp.host, remotePath: ftp.remotePath });

      client = new Client(300_000);
      client.ftp.verbose = false;
      await client.access({
        host: ftp.host,
        user: ftp.user,
        password: ftp.password,
        secure: false,
      });
      if (ftp.remotePath && ftp.remotePath !== "/") await client.cd(ftp.remotePath);
      await logUpload("connected", { filename, host: ftp.host, remotePath: ftp.remotePath });
      uploadTransferStarted = true;
      await client.uploadFrom(temporaryUploadPath, filename);
      await logUpload("transferred", { filename, archiveBytes, host: ftp.host, remotePath: ftp.remotePath });
      send(response, 200, {
        ok: true,
        message: `Importpaket „${filename}“ wurde an Immoprofessional übertragen. Bitte den Importbericht und den Entwurfsstatus prüfen.`,
      }, origin);
      return;
    }

    const body = await readJson(request, isCatalogSave ? MAX_CATALOG_BODY_BYTES : MAX_BODY_BYTES);
    if (isTextGeneration && typeof body?.model === "string" && body.model.trim()) {
      requestedTextModel = body.model.trim().slice(0, 100);
    }

    if (isCatalogV2Start) {
      const result = await startCatalogSnapshot(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogV2Commit) {
      const result = await commitCatalogSnapshot(body.sessionId);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogSave) {
      const result = await saveCatalogSnapshot(body);
      send(response, 200, { ok: true, stored: true, ...result }, origin);
      return;
    }

    if (isCredentialSave) {
      if (body.clear === true) {
        await clearCredentialVault();
        send(response, 200, { ok: true, stored: false }, origin);
      } else {
        await saveCredentialVault(body.credentials);
        send(response, 200, { ok: true, stored: true }, origin);
      }
      return;
    }

    if (isTextGeneration) {
      const result = await generateAiListing(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isImageCaptionGeneration) {
      const result = await generateAiImageCaptions(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isOpenAiKeyValidation) {
      const result = await validateOpenAiApiKey(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (!body.archiveBase64) throw new Error("Das Importpaket ist unvollständig.");
    const archive = Buffer.from(String(body.archiveBase64), "base64");
    if (!archive.length || archive.length > MAX_BODY_BYTES) {
      throw new Error("Das Importpaket ist leer oder zu groß.");
    }

    if (isLocalSave) {
      const saved = await saveToDownloads(archive, body.filename);
      send(response, 200, {
        ok: true,
        filename: saved.filename,
        path: saved.path,
        message: `Importpaket „${saved.filename}“ wurde im Downloadordner gespeichert.`,
      }, origin);
      return;
    }

    const ftp = body.ftp ?? {};
    if (!ftp.host || !ftp.user || !ftp.password) {
      throw new Error("Der FTP-Zugang ist unvollständig.");
    }

    const filename = safeFilename(body.filename);
    const remotePath = String(ftp.remotePath || "/").trim();
    await logUpload("started", {
      filename,
      archiveBytes: archive.length,
      host: String(ftp.host),
      remotePath,
    });

    client = new Client(45_000);
    client.ftp.verbose = false;
    await client.access({
      host: String(ftp.host),
      user: String(ftp.user),
      password: String(ftp.password),
      secure: false,
    });

    if (remotePath && remotePath !== "/") await client.cd(remotePath);
    await logUpload("connected", { filename, host: String(ftp.host), remotePath });
    uploadTransferStarted = true;
    await client.uploadFrom(Readable.from(archive), filename);
    await logUpload("transferred", { filename, archiveBytes: archive.length, host: String(ftp.host), remotePath });
    send(response, 200, {
      ok: true,
      message: `Importpaket „${filename}“ wurde an Immoprofessional übertragen. Bitte den Importbericht und den Entwurfsstatus prüfen.`,
    }, origin);
  } catch (error) {
    const status = error && typeof error === "object" && "httpStatus" in error
      ? Number(error.httpStatus) || 400
      : 400;
    if (isUpload || isBinaryUpload) {
      await logUpload("failed", {
        message: error instanceof Error ? error.message.slice(0, 500) : "Upload fehlgeschlagen.",
      });
    }
    send(response, status, {
      ok: false,
      message: error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      ...(isTextGeneration
        ? {
          model: error && typeof error === "object" && typeof error.model === "string"
            ? error.model
            : requestedTextModel,
          usage: {
            inputTokens: error && typeof error === "object"
              ? Math.max(0, Math.floor(Number(error.usage?.inputTokens) || 0))
              : 0,
            outputTokens: error && typeof error === "object"
              ? Math.max(0, Math.floor(Number(error.usage?.outputTokens) || 0))
              : 0,
            requestCount: error && typeof error === "object"
              ? Math.max(0, Math.floor(Number(error.usage?.requestCount) || 0))
              : 0,
          },
        }
        : {}),
      ...((isUpload || isBinaryUpload)
        ? { outcome: uploadTransferStarted ? "unknown" : "failed" }
        : {}),
    }, origin);
  } finally {
    client?.close();
    if (temporaryUploadPath) await rm(temporaryUploadPath, { force: true }).catch(() => undefined);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fabian&Pascal Helfer: http://${HOST}:${PORT}`);
});
