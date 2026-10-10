// Separate local session/connectivity failures from an actual Excel read failure.
export async function probeHelperConnection(request, hasSession = true) {
  if (!hasSession) return { online: false, message: "Die lokale Sitzung fehlt. Bitte Inseratestudio über den Startknopf auf dem Schreibtisch öffnen und diesen alten Tab schließen." };
  try {
    const response = await request("/health", { signal: AbortSignal.timeout(5000) });
    if (response.status === 401 || response.status === 403) return { online: false, message: "Die lokale Sitzung ist nicht mehr gültig. Bitte Inseratestudio über den Startknopf auf dem Schreibtisch öffnen und diesen alten Tab schließen." };
    if (!response.ok) throw new Error("Helper unavailable");
    const health = await response.json();
    if (health.ok !== true || health.service !== "fabian-pascal-helper") throw new Error("Unexpected service");
    return { online: true, message: "" };
  } catch {
    return { online: false, message: "Der lokale Helfer antwortet nicht. Bitte Inseratestudio über den Startknopf auf dem Schreibtisch öffnen und erneut prüfen." };
  }
}
