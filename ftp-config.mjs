export const IMMOPROFESSIONAL_FTPS_HOST = "server22.immoprofessional.eu";

const LEGACY_LIVINGHAUS_HOSTS = new Set([
  "fabianraebel.livinghaus.info",
  "pascalfroehlich.livinghaus.info",
]);

export function normalizeFtpHost(value) {
  const host = String(value || "").trim().replace(/\.$/, "").toLocaleLowerCase("de-DE");
  if (!host || LEGACY_LIVINGHAUS_HOSTS.has(host)) return IMMOPROFESSIONAL_FTPS_HOST;
  return host;
}
