# Inseratestudio – Reparatur- und Fortsetzungsstand

Stand: 14. September 2026. **Noch keine vollständige Betriebsfreigabe.**

## Ergebnis

Die Hauptursache der Katalogbeschädigung wurde im Code behoben: UI-Projektionen reduzierten vollständige Lifecycle-Datensätze, führten dieselben IDs doppelt und ließen historische Quellen weg. Ein Ladefehler konnte anschließend die Speicherung des initialen leeren Zustands freigeben. Diese Pfade sind korrigiert; persistente CAS-Sicherung, atomarer Commit und Schutz bestätigter Lifecycle-Felder sind ergänzt.

Die produktive interne Datenbereinigung wurde nach Backup und unveränderter Eingangsprüfung durchgeführt. Sie hat **keine externen Mutationen** ausgeführt:

- 115 doppelte Einträge entfernt; vollständige Datensätze erhalten.
- 84 eindeutig belegte historische Löschstatus intern wiederhergestellt.
- Ergebnis: 255 eindeutige Inseratsdatensätze, davon 171 `published`, 84 `deleted`.
- 50 fehlende Originaldatensätze und ein historisch dokumentierter vorhandener Ausnahmefall bleiben ungeklärt. Sie wurden weder erfunden noch extern gelöscht.
- Katalogrevision 1; `catalogRepairReview.automaticProductionAllowed=false`.
- Katalog-Speicherzeit nach Reparatur: `2026-09-14T16:49:17.735Z`.

## Sicherer aktueller Betrieb

- Rotation `off`, Production-DELETE `off`, Portalexport `off`.
- Bisheriger Helper kontrolliert angehalten; keine Listener auf 43181/43182 bei letzter Prüfung.
- Noch kein neuer Release installiert und keine produktive Automatik gestartet.
- Der alte Desktopknopf wurde zum Schutz des bereinigten Katalogs reversibel in `Fabian-Pascal Inseratestudio.app.deaktiviert` umbenannt. Er ist nicht gelöscht. Sein alter Inhalt verweist auf die historische Arbeitskopie und darf nicht wieder aktiviert werden, bevor der geprüfte Starter installiert ist.
- Unabhängige Grundstücks-Automationen wurden nicht aktiviert oder geändert.

## Codeänderungen auf isoliertem Fix-Branch

Verzeichnis: `/Users/pascalfrohlich/Documents/Inseratestudio/system-repair-20260914`

Branch: `codex/system-repair-20260914`

Basis: `020090494b5c41b193c54682fbf100df9478cd2e`, exakt der vorgefundenen installierten Release-Quelle entsprechend. Nicht das veraltete Remote-main. Keine Änderungen an main, kein Push und noch kein Reparatur-Commit. Fremde Arbeitskopien wurden unverändert gelassen.

Geänderte Komponenten:

- `app/InseratStudio.tsx`, `listing-catalog-view.mjs`: Historie erhalten, Dubletten/Identitätskonflikte abweisen, keine Speicherung nach Ladefehlern, KI-Textgenerierung nur für Entwürfe, Prüfhinweis.
- `catalog-store.mjs`: persistenter exklusiver Commit-Claim, erneute CAS-Prüfung, atomarer Manifesttausch, keine konkurrierende Bildbereinigung, Schutz von Browser-Rückschreibungen.
- `catalog-snapshot-selection.mjs`: reparierter Gerätekatalog vor altem Browsercache.
- `catalog-lifecycle-repair.mjs`: reine Planungsfunktion mit bestehender Löschprovenienz, validierter Kampagne und originalem manuellem Bestandsbeleg. Kein Provideraufruf.
- `listing-rotation-scheduler-service.mjs`, `listing-rotation-production-delete.mjs`, `local-upload-server.mjs`: zusätzliche Produktionssperre bei ungeklärtem Reparaturstatus.
- `plot-sync-service.mjs`, `app/components/PlotManagement.tsx`, `app/types.ts`: sichtbare persistente Pause des separaten Helper-Abgleichs; fehlende/defekte Einstellung bedeutet pausiert.
- `desktop-launcher.mjs`, `Start-Fabian-Pascal-Inseratestudio.command`, `helper-runtime-stage.mjs`: Start nur installierter Release-LaunchAgents, kein Katalog-Bootstrap und kein Working-Directory-Helper; optional vorgebaute UI mit React-Abhängigkeiten im Release.
- Zieltests sowie README und CHANGELOG ergänzt.

## Prüfungen

- Letzter abgeschlossener Volltest: 509 Tests, **508 bestanden, 0 Fehler, 1 übersprungen**.
- TypeScript, ESLint und Produktionsbuild erfolgreich abgeschlossen.
- Danach ergänzter UI-Staging-Fixturetest und Desktopstarter-Zieltests: 4/4 bestanden.
- Wiederholte abschließende QA wurde gestartet, blockiert inzwischen aber beim Zugriff auf erneut ausgelagerte Dateien. Nicht als zusätzlich bestanden zählen.
- `git diff --check` vor der erneuten iCloud-Auslagerung ohne Fehler. Abschließende Git-Prüfung/Commit blockiert.
- Gezielter Secret-Musterscan über 13 geänderte Implementierungsdateien: keine Treffer. Kein Ersatz für einen abschließenden vollständigen Release-/Artefaktscan.
- 665 Medien aus der installierten Runtime wiederhergestellt und einzeln gegen SHA-256 und Größe der Git-LFS-Zeiger geprüft; 0 fehlende Medien zum Prüfzeitpunkt.
- Keine realen Upload-, DELETE-, Importbestätigungs- oder Portalexportaktionen als Test.

## Konkrete Blocker

1. iCloud hat selbst `.git/config`, den Basis-Commit und weitere Arbeitsdateien erneut als `dataless` ausgelagert. Git und spätere QA-Zugriffe warten auf macOS. Finder zeigte gleichzeitig eine große laufende iCloud-Warteschlange. Der Reparaturordner wurde über Finder auf **Laden und behalten** gesetzt und **Jetzt laden** angefordert. Lokale Verfügbarkeit ist noch nicht bestätigt. Auch die Finder-Bedienung lief zuletzt in einen Timeout.
2. Für 50 fehlende Originale reicht der vorhandene lokale Sicherungsbestand nicht zur vollständigen Wiederherstellung. Zusätzlich bleibt ein historischer Ausnahmefall. Hier ist ein aktueller, eindeutig zuordenbarer Providerbestand erforderlich.
3. Die letzte Browserprüfung konnte nicht fortgesetzt werden: Chrome meldete ein blockierendes Erweiterungsfenster; Immoprofessional zeigte eine Login-Seite. Kein Umgehen dieses Blockers.

## Sicherung und Nachweise

Ordner: `/Users/pascalfrohlich/Documents/Inseratestudio/repair-evidence-20260914`

- `catalog-ledgers-before.tgz`: Katalog-, Medien-, Ledger- und Log-Sicherung vor der internen Reparatur; keine Credential-Vault-/Session-Ausgabe im Bericht.
- SHA-256: `7ae6c1a4921a9471541c7fccfdfae92644a07e57af014b947b55ac1cfe19016f`.
- `source-recovery.json`: Wiederherstellung des exakten Quellbaums.
- `catalog-repair-preview.json`: Eingangsdateihashes, Vorschlag und ungeklärte Zuordnungen.
- `catalog-repair-applied.json`: tatsächlich ausgeführte interne Korrekturen und Nachzustand.

## Fortsetzen – Reihenfolge zwingend

1. Lokale Verfügbarkeit des isolierten Fix-Repos vollständig bestätigen. Keine Git-Konfiguration oder Objekte erfinden/überschreiben, keine fremden Dateien löschen.
2. Vollständige QA und Diff-/Secret-/Artefaktprüfung wiederholen. Nur abgegrenzte Reparaturdateien committen; main und Remote unverändert lassen.
3. Neue Release-Runtime aus genau diesem sauberen geprüften Commit bauen. UI und Helper müssen zusammenpassen. Ausschließlich diese LaunchAgents installieren, Port-Ownership prüfen; Modi bleiben off.
4. Desktopknopf erst dann auf den geprüften Release-Starter umstellen. Oberfläche mit dem bereinigten Gerätekatalog prüfen, Autosave-Roundtrip auf unveränderte Provenienz kontrollieren.
5. Authentifizierten Immoprofessional-Bestand ausschließlich lesend abgleichen. Die 51 Prüfpositionen auflösen. Kein erneuter DELETE aus historischem Ledger, keine synthetischen Originale, kein Blind-Retry.
6. Neues PLZ-Gebiet und Grundstücksbestand separat prüfen. Dieser Reparaturlauf hat weder alte Gebietsdaten gelöscht noch ungeprüfte Excel-/PLZ-Änderungen übernommen.
7. Erst nach vollständigem Daten-/Runtime-/Mail-/Lifecycle-Gate über die Wiederaufnahme produktiver Automatik entscheiden. Ein grüner lokaler Test allein genügt nicht.

**Bis dahin: keine Produktionsfreigabe und alten Desktopknopf nicht verwenden.**
