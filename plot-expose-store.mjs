import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { extractPlotFieldsFromPdf } from "./plot-pdf-extractor.mjs";

export const MAX_PLOT_EXPOSE_BYTES = 30 * 1024 * 1024;
const ROOT = join(APPLICATION_DATA_DIRECTORY, "plot-exposes");

function directories(rootDirectory = ROOT) {
  const root = resolve(rootDirectory);
  return { root, pending: join(root, ".pending"), archive: join(root, ".archive") };
}

function safePart(value, fallback) {
  const result = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 100);
  return result || fallback;
}

function safePdfFilename(value) {
  const name = safePart(basename(String(value || "Expose.pdf")), "Expose.pdf");
  return name.toLocaleLowerCase("de-DE").endsWith(".pdf") ? name : `${name}.pdf`;
}

function resolvedReference(reference, { allowPending = false, rootDirectory = ROOT } = {}) {
  const value = String(reference || "").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.split("/").includes("..") || !value.toLowerCase().endsWith(".pdf")) {
    throw new Error("Die Exposé-Referenz ist ungültig.");
  }
  if (!allowPending && value.startsWith(".pending/")) throw new Error("Das Exposé wurde noch nicht gespeichert.");
  const { root } = directories(rootDirectory);
  const absolute = resolve(root, value);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error("Die Exposé-Referenz liegt außerhalb des geschützten Ablagebereichs.");
  }
  return { value, absolute };
}

function relativeReference(absolute, rootDirectory = ROOT) {
  return relative(directories(rootDirectory).root, absolute).split(sep).join("/");
}

async function validatePdf(data, filename) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_PLOT_EXPOSE_BYTES) {
    throw new Error("Das Exposé ist leer oder größer als 30 MB.");
  }
  if (!String(filename || "").toLocaleLowerCase("de-DE").endsWith(".pdf")) {
    throw new Error("Bitte ausschließlich eine PDF-Datei auswählen.");
  }
  if (!data.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("Die ausgewählte Datei ist keine gültige PDF-Datei.");
  }
}

export async function analyzePlotExpose({ data, filename }, options = {}) {
  await validatePdf(data, filename);
  const { root, pending } = directories(options.rootDirectory);
  await mkdir(pending, { recursive: true });
  const pendingPath = join(pending, `${randomUUID()}.pdf`);
  const handle = await open(pendingPath, "wx", 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  try {
    const result = await extractPlotFieldsFromPdf(data);
    return {
      temporaryReference: relativeReference(pendingPath, root),
      filename: safePdfFilename(filename),
      pageCount: result.pageCount,
      fields: result.fields,
    };
  } catch (error) {
    await archivePlotExpose(relativeReference(pendingPath, root), { allowPending: true, rootDirectory: root }).catch(() => undefined);
    throw new Error(`Das PDF konnte nicht ausgelesen werden: ${error instanceof Error ? error.message : "unbekannter Fehler"}`);
  }
}

export async function commitPlotExpose({ temporaryReference, plotId, filename }, options = {}) {
  const { root } = directories(options.rootDirectory);
  const source = resolvedReference(temporaryReference, { allowPending: true, rootDirectory: root });
  if (!source.value.startsWith(".pending/")) throw new Error("Die temporäre Exposé-Referenz ist ungültig.");
  const fileStats = await stat(source.absolute);
  if (!fileStats.isFile() || fileStats.size > MAX_PLOT_EXPOSE_BYTES) throw new Error("Das temporäre Exposé ist ungültig.");
  const directory = join(root, safePart(plotId, "plot"));
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${randomUUID()}-${safePdfFilename(filename)}`);
  await rename(source.absolute, target);
  return {
    reference: relativeReference(target, root),
    filename: safePdfFilename(filename),
    uploadedAt: new Date().toISOString(),
  };
}

export async function readPlotExpose(reference, options = {}) {
  const target = resolvedReference(reference, { rootDirectory: options.rootDirectory });
  const fileStats = await stat(target.absolute);
  if (!fileStats.isFile() || fileStats.size > MAX_PLOT_EXPOSE_BYTES) throw new Error("Das Exposé ist ungültig oder zu groß.");
  return { data: await readFile(target.absolute), filename: basename(target.absolute) };
}

export async function archivePlotExpose(reference, options = {}) {
  const { archive } = directories(options.rootDirectory);
  const target = resolvedReference(reference, { allowPending: options.allowPending === true, rootDirectory: options.rootDirectory });
  const fileStats = await stat(target.absolute);
  if (!fileStats.isFile()) throw new Error("Das Exposé wurde nicht gefunden.");
  await mkdir(archive, { recursive: true });
  const archived = join(archive, `${Date.now()}-${randomUUID()}-${basename(target.absolute)}`);
  await rename(target.absolute, archived);
  return { archived: true };
}
