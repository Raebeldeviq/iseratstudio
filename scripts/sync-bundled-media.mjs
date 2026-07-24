import { constants, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  BUNDLED_INTERIOR_LIBRARY_ROOT,
  BUNDLED_MEDIA_LIBRARY_ROOT,
  LEGACY_INTERIOR_LIBRARY_ROOT,
  LEGACY_MEDIA_LIBRARY_ROOT,
} from "../media-library.mjs";

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function syncDirectory(sourceRoot, destinationRoot) {
  const counters = { files: 0, bytes: 0 };
  async function visit(sourceDirectory, destinationDirectory) {
    await mkdir(destinationDirectory, { recursive: true });
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const source = join(sourceDirectory, entry.name);
      const destination = join(destinationDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(source, destination);
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("de-DE"))) continue;
      await copyFile(source, destination, constants.COPYFILE_FICLONE);
      counters.files += 1;
      counters.bytes += (await stat(source)).size;
    }
  }
  await visit(sourceRoot, destinationRoot);
  return counters;
}

export async function syncBundledMedia() {
  const advertisements = await syncDirectory(
    process.env.FPI_SOURCE_MEDIA_LIBRARY_ROOT || LEGACY_MEDIA_LIBRARY_ROOT,
    BUNDLED_MEDIA_LIBRARY_ROOT,
  );
  const interiors = await syncDirectory(
    process.env.FPI_SOURCE_INTERIOR_LIBRARY_ROOT || LEGACY_INTERIOR_LIBRARY_ROOT,
    BUNDLED_INTERIOR_LIBRARY_ROOT,
  );
  return {
    files: advertisements.files + interiors.files,
    bytes: advertisements.bytes + interiors.bytes,
    advertisements,
    interiors,
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const result = await syncBundledMedia();
  console.log(`Medien integriert: ${result.files} Bilder mit ${result.bytes} Bytes Originaldaten.`);
}
