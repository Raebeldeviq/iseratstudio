# Lokaler Grundstücksmonitor

## Verbindliche Arbeitsdatei

`~/Library/Application Support/Fabian-Pascal Inseratestudio/inputs/KI_Grundstuecke.xlsx`

Das Blatt `Suchgebiet` enthält genau 50 eindeutige aktive PLZ. `Grundstücke` ist die Arbeitsliste. Exposés liegen daneben in `Exposes`, Sicherungen in `Backups`, Protokolle in `Logs` und historische Eingabe-JSONs in `Grundstuecksmonitor/Runs`.

Die Skripte liegen in `~/Developer/Inseratestudio`. Weder Excel noch Exposés, Protokolle oder Abhängigkeiten werden aus iCloud nachgeladen. Dokumente, Schreibtisch, iCloud und CloudStorage sind als Monitor-Datenpfade gesperrt; auch symbolische Verknüpfungen dorthin werden abgewiesen. Alte Cloud-Dateien sind keine aktive Quelle.

## Unverändernde Prüfung

Im lokalen Projekt:

```sh
./Grundstuecksmonitor/run_monitor.command --preflight
node plot-inquiry-cli.mjs preview
```

Beide Aufrufe lesen ausschließlich. Sie prüfen den Datei-Hash vor und nach dem Lesen. `preview` simuliert einen Katalogabgleich und die Anfragewarteschlange im Speicher, ohne Katalog, Freigaben, Locks oder Historie zu schreiben. Importfehler wegen fehlender vollständiger Anschriften bleiben sichtbar; sie werden nicht durch die Pfadumstellung aufgehoben.

Der Monitor-Launcher verwendet die installierte lokale Codex-Node-Laufzeit und die dortige Artifact-Tool-Bibliothek. `Grundstuecksmonitor/node_modules` zeigt bei dieser Installation auf `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`. Fehlt diese Abhängigkeit, stoppt der Launcher ohne Netzinstallation.

## Späterer freigegebener Schreibdurchlauf

Nur nach erfolgreicher Vorprüfung und ausschließlich mit geprüfter Eingabe gemäß `run_input.schema.json`:

```sh
./Grundstuecksmonitor/run_monitor.command --input "/vollständiger/lokaler/Pfad/zum/Lauf.json"
```

Dieser Aufruf kann die lokale Excel und Sicherungen aktualisieren sowie explizit angegebene öffentliche Exposé-URLs abrufen. Er wurde bei der lokalen Migration **nicht gegen Produktionsdaten ausgeführt**. Der Monitor aktiviert weder Inseratrotation noch Portalexport. Codex-Automationen bleiben separat pausiert, bis der Nutzer sie ausdrücklich freigibt.

## Überarbeitung vom 16.10.2026

Der Nutzer hat Umsetzung und Wiederaufnahme dieses Monitors freigegeben. Die bisherige Pause wird erst durch die tatsächliche Installation und Aktualisierung der bestehenden Automation ersetzt. Andere Automationen bleiben unberührt.

Neue lesende Aufrufe: `./Grundstuecksmonitor/run_monitor.command --plan` und `./Grundstuecksmonitor/run_monitor.command --input /lokaler/pfad/lauf.json --dry-run`.

- Alle aktiven Quellen kommen aus dem Excel-Register. Erfolgreiche, fehlende, übersprungene, blockierte, fehlerhafte und unbelegte Prüfungen werden getrennt gezählt. Dynamische Quellen brauchen einen Nachweis für jede aktive PLZ.
- Neue Angebote benötigen aktuelle Detailbelege, vollständige Adresse, identifizierten Anbieter, belegten Angebotszweck, Bodenrichtwert/Lageart und Bebaubarkeitsnachweis. Fehlende Nachweise landen mit konkretem nächsten Schritt in der bestehenden Prüfliste. Der Monitor gibt keine baurechtliche Zusicherung.
- Ungeprüfter Bestand und manuelle Notizen bleiben erhalten. Alte „Neu“-Werte altern beim Lauf korrekt. Aktualität und fachliche Prüfung sind getrennt sichtbar; Synchronisation erneuert keinen Prüfzeitpunkt.
- Erledigte Prüffälle bleiben als abgeschlossene Historie erhalten. Das PLZ-Blatt wird aus Bestand und aktuellen Belegen neu berechnet. Preisänderungen stehen mit vorherigem/neuem Preis im strukturierten Laufreport.
- Der Katalogimport überspringt Monitorzeilen ohne vollständige aktuelle Nachweise. Altdaten ohne Monitor-Metadaten behalten ihren bisherigen manuellen Importpfad. Bestehenden Adressschutz erhalten.
- Vor atomarem Excel-Ersatz wird der Originalhash erneut geprüft. Gleichzeitige manuelle Änderungen stoppen den Commit. Sicherungen und Logs haben kollisionsfreie Namen. Quellenlücken ergeben ausdrücklich einen Teilstand.

Tests: `node --test tests/plot-monitor-policy.test.mjs tests/plot-excel-sync.test.mjs tests/plot-inquiry-workflow.test.mjs tests/plot-local-paths.test.mjs tests/plot-search-area.test.mjs` sowie `node Grundstuecksmonitor/integration-test.mjs`. Der Integrationstest verwendet synthetische temporäre Daten und prüft Export, Wiederholung, Prüffälle, Sicherungen und geschützte Notizen.

Der neue Auftrag in [AUTOMATION_PROMPT.md](AUTOMATION_PROMPT.md) ist vorbereitet; er ist kein Aktivierungsnachweis.

### Installation und offene Punkte

Branch: `codex/fix/grundstuecksmonitor-20261016`. Die bisher unversionierte lokale Monitorfassung wurde als separater Basiscommit erhalten; Produktionsmedien und Zugangsdaten wurden nicht übernommen.

Die laufende App ist neuer als der ursprüngliche Monitor-Checkout. `catalog-store.mjs`, `data-integrity.mjs` und `plot-records.mjs` unterscheiden sich. Den kleinen Importfilter daher in den aktuellen App-Entwicklungsstand integrieren und regulär veröffentlichen. Keine vollständige alte Helper-Runtime über die installierte App kopieren.

In der ausführenden Lisa-Sitzung sind der ursprüngliche Projektordner und Application Support schreibgeschützt. Die Codex-App-Schnittstellen melden `MCP error -32000: Codex app tool request failed`. Produktive Installation, echter Katalogimport und Aktivierung bleiben deshalb offen, bis eine Sitzung mit beschreibbarem Inseratestudio-Projekt und funktionierender App-Anbindung verfügbar ist. Die Nutzerfreigabe liegt bereits vor; keine erneute fachliche Bestätigung erforderlich.

Risiken: Zugriffsblockaden, gecachte Portalstände, fehlende BRW-/Adress-/Bebaubarkeitsnachweise und unterschiedliche App-Versionen. Diese Zustände werden als offen oder Teilstand ausgewiesen.

## Historische Umsetzung und Grenzen

- Die bestehende Monitorlogik wurde lokal übernommen, statt ein zweites Cloud-/Local-Synchronisationssystem einzuführen.
- Der Anfrageworkflow erhält seine bestehenden Anbieter-, Rechts-, Freigabe-, Claim- und Deduplizierungsprüfungen. Ein kleiner Adapter erhält dessen Anbieter-/Adressnachweise unabhängig vom kleineren Anwendungsschema.
- `read-excel-file` 9 verlangt den Blattnamen als separates Argument. Der lokale Anfrage-Preview berücksichtigt diese Schnittstelle.
- Die lokale Datei ist kein Ersatz für ein Backup. Quellenrecherche, E-Mail und Immobilienportale benötigen weiterhin Internet; nur die Dateiablage und Skript-Ausführung sind cloudunabhängig.

## Produktive Integration auf aktuellem Stand

Die Installation erfolgt aus `/Users/pascalfrohlich/Developer/Inseratestudio-monitor-20261016`, Branch `codex/grundstuecksmonitor-production-20261016`, auf Basis des installierten Commits d4e75ad. Quellenmonitor und Helper-Import werden aus diesem Projekt ausgeführt. Der Originalcheckout bleibt auf seinem dedizierten Monitorbranch mit erhaltenen vorherigen Änderungen.

`node plot-monitor-helper-cli.mjs preview` liest im tatsächlich laufenden Helper. `node plot-monitor-helper-cli.mjs import /lokaler/pfad/vorschau.json` importiert mit dem zuvor ausgegebenen Vorschau-Token. Der Import ist gesondert autorisiert und schaltet keinen alten Excel-Zeitplan frei. Fehlende vollständige Nachweise ergeben null neue Importe und schützen den bestehenden Katalog.
