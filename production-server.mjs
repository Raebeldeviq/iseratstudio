import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 43181;
export const PRODUCTION_HEALTH_PATH = "/__fpi_health";
export const PRODUCTION_HEALTH_BODY = "fabian-pascal-inseratestudio";

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
});

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = resolve(root, normalize(decoded));
  const normalizedRoot = `${resolve(root)}/`;
  return candidate.startsWith(normalizedRoot) ? candidate : "";
}

async function existingFile(pathname) {
  if (!pathname) return "";
  try {
    await access(pathname);
    return (await stat(pathname)).isFile() ? pathname : "";
  } catch {
    return "";
  }
}

export async function resolveStaticFile(projectRoot, pathname) {
  const roots = [join(projectRoot, "dist", "client"), join(projectRoot, "public")];
  for (const root of roots) {
    const candidate = await existingFile(safeStaticPath(root, pathname));
    if (candidate) return candidate;
  }
  return "";
}

function copyWebHeaders(source, response) {
  for (const [key, value] of source.entries()) response.setHeader(key, value);
}

async function sendWebResponse(response, webResponse) {
  response.statusCode = webResponse.status;
  response.statusMessage = webResponse.statusText;
  copyWebHeaders(webResponse.headers, response);
  if (!webResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(webResponse.body).pipe(response);
}

async function sendStaticFile(response, pathname) {
  const file = await stat(pathname);
  response.statusCode = 200;
  response.setHeader("Content-Type", CONTENT_TYPES[extname(pathname).toLowerCase()] || "application/octet-stream");
  response.setHeader("Content-Length", String(file.size));
  response.setHeader("Cache-Control", pathname.includes("/dist/client/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache");
  createReadStream(pathname).pipe(response);
}

function sendHealthResponse(response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(PRODUCTION_HEALTH_BODY);
}

function requestBody(request) {
  return request.method === "GET" || request.method === "HEAD"
    ? undefined
    : Readable.toWeb(request);
}

export function createProductionServer(options) {
  const projectRoot = resolve(options.projectRoot);
  const application = options.application;
  if (!application || typeof application.fetch !== "function") {
    throw new Error("Der gebaute Inseratestudio-Server stellt keine Fetch-Schnittstelle bereit.");
  }
  return createServer(async (request, response) => {
    try {
      const origin = `http://${request.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`;
      const url = new URL(request.url || "/", origin);
      if (request.method === "GET" && url.pathname === PRODUCTION_HEALTH_PATH) {
        sendHealthResponse(response);
        return;
      }
      const staticFile = await resolveStaticFile(projectRoot, url.pathname);
      if (staticFile) {
        await sendStaticFile(response, staticFile);
        return;
      }
      const init = {
        method: request.method,
        headers: request.headers,
        body: requestBody(request),
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { duplex: "half" }),
      };
      const webResponse = await application.fetch(new Request(url, init));
      await sendWebResponse(response, webResponse);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(error instanceof Error ? error.message : "Interner Serverfehler");
    }
  });
}

export async function startProductionServer(options = {}) {
  const projectRoot = resolve(options.projectRoot || dirname(fileURLToPath(import.meta.url)));
  const host = String(options.host || process.env.FPI_APP_HOST || DEFAULT_HOST);
  const port = Number(options.port || process.env.FPI_APP_PORT || DEFAULT_PORT);
  const serverModule = await import(pathToFileURL(join(projectRoot, "dist", "server", "ssr", "index.js")).href);
  const server = createProductionServer({ projectRoot, application: serverModule.default });
  await new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, host, () => {
      server.off("error", rejectStart);
      resolveStart();
    });
  });
  process.stdout.write(`Inseratestudio läuft auf http://${host}:${port}\n`);
  return server;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  startProductionServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
