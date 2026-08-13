export const IMMOPROFESSIONAL_FTPS_HOST = "server22.immoprofessional.eu";
// Zugangsnamen werden nicht in den Quellcode eingebettet. Die App lädt einen
// vorhandenen Wert aus dem macOS-Schlüsselbund oder fordert ihn lokal an.
export const IMMOPROFESSIONAL_DEFAULT_USERNAME = "";

const LEGACY_LIVINGHAUS_HOSTS = new Set([
  "fabianraebel.livinghaus.info",
  "pascalfroehlich.livinghaus.info",
]);

export function normalizeFtpHost(value) {
  const host = String(value || "").trim().replace(/\.$/, "").toLocaleLowerCase("de-DE");
  if (!host || LEGACY_LIVINGHAUS_HOSTS.has(host)) return IMMOPROFESSIONAL_FTPS_HOST;
  return host;
}
