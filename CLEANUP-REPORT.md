# Technischer Cleanup-Bericht · Version 0.15.0

Stand: 25. Juli 2026  
Branch: `codex/cleanup-depth-audit`

## Ausgangslage und Sicherung

Die Mac-Anwendung besitzt keine relationale Datenbank, keine Supabase-Anbindung
und keine SQL-Migrationen. Dauerhafte Daten liegen in IndexedDB sowie im lokalen
`catalog-v2`-Format aus JSON-Manifest und separat gespeicherten Bildern. Vor
allen Datenprüfungen wurde der lokale `catalog-v2`-Bestand vollständig nach
`~/Library/Application Support/Fabian-Pascal Inseratestudio/backups/pre-cleanup-20260725`
kopiert. Quelle und Sicherung besitzen denselben Manifest-Hash; jeweils 62
Bilddateien wurden gezählt.

Das Cleanup-Skript überschreibt grundsätzlich keine Eingabe. Der erste Lauf war
ein reiner Dry Run. Anschließend wurde eine separate Bereinigungskopie unter
`work/catalog-cleaned-preview-20260725.json` erzeugt und erneut geprüft.
Nach erfolgreicher Prüfung hat der lokale Helfer dieselben sicheren Regeln
atomar auf den echten Katalog angewendet. Vor dieser Migration wurde zusätzlich
eine unveränderliche Manifest-Sicherung im Katalog angelegt.

## 1. Entfernte Dateien

- `listing-groups 2.mjs`: unreferenzierte ältere 4+4-Implementierung
- `tests/listing-groups.test 2.mjs`: nicht ausgeführter Test der Altimplementierung
- `worker/index.ts`: unreferenzierter Cloudflare-Starter mit D1-/Image-Bindings
- `build/sites-vite-plugin.ts`: unreferenzierter Sites-/Drizzle-Starter ohne
  Hostingkonfiguration oder Einbindung in Vite

Vor der Entfernung wurden Quellreferenzen, Buildkonfiguration und Tests geprüft.

## 2. Zusammengeführte Funktionen

- Sperr-, Pool-, Eindeutigkeits- und Auswahlregeln für Hausrotation liegen in
  `rotation-service.mjs`.
- Statusnormalisierung und Anzeige liegen in `workflow-status.mjs`.
- Grenzwerte für Hausanzahl, Leases und Loggrößen liegen in
  `listing-rules.mjs`.
- Projektierungsstandards und Haus-Energiewerte liegen in `listing-copy.mjs`.
- Die Aktionsbildinvariante liegt in
  `enforceSinglePromotionAssignment()` in `promotion-images.mjs`.
- Upload-Job-ID, Warteschlangen-Deduplizierung und persistente Helfer-Sperre
  verwenden denselben deterministischen Jobbezug.
- Der Katalogspeicher wendet dieselbe idempotente Migration beim Helferstart
  und bei jeder eingehenden Sicherung an. Dadurch können ältere Browser-Tabs
  keine entfernten Legacyfelder erneut speichern.

## 3. Ersetzte Komponenten

- Rundlaufbasierte `nextListingGroupVariant()`-Vorschau durch gewichtete Planung
- unterschiedliche UI-/Scheduler-Sperrprüfungen durch einen Rotationsservice
- unstrukturierte, unbegrenzte Uploadlogs durch begrenztes JSONL-Logging
- nur im Browser vorhandener Doppelklickschutz durch Browser- plus Helfer-Ledger
- frei formulierte Statuswerte durch kanonische Statuswerte
- stilles Beibehalten alter Datenfelder durch versionierten, idempotenten Cleanup

## 4. Entfernte Datenbankfelder oder Tabellen

Keine: Im Projekt existieren weder Tabellen noch Supabase-/Postgres-Schema,
Indizes, Trigger oder Migrationen. Aus dem lokalen Datenmodell entfernt wurden:

- `ProjectInput.notes`
- persistentes `uploadStatus`
- `lastUsedVariantId` und `nextVariantId` in Automation und Inseratssteuerung
- die nicht mehr verwendete gruppenweite `processLease`

Die weiterhin benötigte inseratsbezogene `processLease` bleibt bestehen.

## 5. Gefundene Dubletten

Der reale Katalog enthielt keine doppelten:

- Projekt-IDs oder normalisierten Adressen
- Haus-IDs oder Haus-Signaturen
- Inserats-IDs oder Objektnummern
- Aktionsbild-IDs, -Namen oder -Zuordnungen
- Uploadereignisse oder Steuerdatensätze
- Bilddatei-Hashes

Der Code enthielt eine vollständige alte 4+4-Dateikopie samt ungenutztem Test;
diese wurde entfernt.

## 6. Bereinigte Daten

Die separat erzeugte Bereinigungskopie und der anschließend migrierte
Produktivkatalog enthalten:

- 54 entfernte Legacy-Felder `notes`
- acht deaktivierte, aber nicht gelöschte Hauszuordnungen oberhalb der
  verbindlichen Vierergrenze in zwei Altgruppen
- kanonisch normalisierte Statuswerte
- entfernte alte Round-Robin-Felder und gruppenweite Leases

Es wurden keine Häuser, Grundstücke, Inserate, Bilder, Historien oder
produktiven Zuordnungen gelöscht.

## 7. Sicherungen

- vollständige lokale Katalogsicherung vor dem Cleanup
- identischer Manifest-Hash zwischen Quelle und Sicherung
- identische Zahl von 62 Bilddateien
- bereinigte Vorschau als neue Datei; kein Überschreiben der Sicherung
- zusätzliche atomare Manifest-Sicherung
  `catalog-v2/backups/manifest.pre-schema-2.json`
- nach vollständiger Aktionsbildsicherung 72 eindeutige referenzierte
  Bilddateien, ohne fehlende oder unreferenzierte Datei

## 8. Vereinheitlichte Statuswerte

- `draft`
- `prepared`
- `scheduled`
- `processing`
- `published`
- `blocked`
- `failed`
- `archived`
- `deleted`

Legacywerte werden beim Laden normalisiert; die deutsche Benutzeranzeige liegt
separat vom gespeicherten Status.

## 9. Zentrale Services und Konfigurationen

- `workflow-status.mjs`: Statusmodell und Legacy-Migration
- `listing-rules.mjs`: fachliche Grenzwerte
- `listing-copy.mjs`: unveränderliche Projektierungsstandards
- `rotation-service.mjs`: zentrale Hausrotation und Sperrprüfung
- `data-integrity.mjs`: Audit und idempotente sichere Migration
- `upload-job-ledger.mjs`: persistente Job-ID, Lease und Erfolgszustand
- `structured-log.mjs`: begrenztes, redigiertes JSONL-Protokoll
- `promotion-images.mjs`: genau eine aktuelle Aktionsbildzuordnung
- `catalog-store.mjs`: atomare Migration und vollständige Sicherung aller
  Aktionsbilder

## 10. Durchgeführte Tests

- einzelne und mehrere Projektierungen sowie Excel-Import
- gewichtete Verteilung mit 4, 10, 15 und 20 Häusern
- 20 aufeinanderfolgende Rotationen ohne doppelte aktive Häuser oder direkte
  Wiederholung der vorherigen Kombination
- manuelle Ersatzauswahl und Dublettensperre
- Premium-, manuelle, Archiv- und Prozesssperren
- täglicher Scheduler, Adresslimit und 2.000-Inserate-Skalierung
- Sammel-Upload mit isolierten Fehlern
- paralleler und wiederholter Start derselben Upload-Job-ID
- Wiederanlauf nach abgelaufenem oder fehlgeschlagenem Job
- genau eine aktuelle Aktionsbildzuordnung je Grundstück
- Dry Run, sichere Migration und erneute idempotente Ausführung
- serverseitige Altbestandsmigration mit Wiederanlaufsicherung
- vollständige Speicherung mehrerer Aktionsbilder
- Erhalt widersprüchlicher oder nur variantenreferenzierter Bestandsdaten
- strukturierte Logs ohne sensitive Schlüssel oder typische Geheimniswerte
- Excel-Importvorlage visuell und fachlich ohne Hinweisfeld
- Syntaxprüfung, Produktions-Build, Gesamttests und Browser-Dry-Run
- `pnpm audit --prod` ohne bekannte Sicherheitslücke

Ein produktiver FTPS-Upload wurde bewusst nicht als Test ausgelöst, um kein
echtes Inserat zu verändern.

## 11. Verbleibende Risiken

- Zehn Steuerdatensätze werden nur noch von Varianten-Snapshots referenziert.
  Sie bleiben erhalten, bis ihre fachliche Historienfunktion bestätigt ist.
- Ohne Immoprofessional-Lese-/Löschschnittstelle kann die App weder externen
  Portalstatus beweisen noch sicher automatisch löschen.
- Nach einem Prozessabbruch exakt zwischen erfolgreichem FTPS-Transfer und
  lokalem Erfolgscommit bleibt ein externer Abgleich erforderlich. Der
  deterministische Dateiname reduziert das Risiko, ersetzt aber keine
  serverseitige Idempotenzbestätigung.
- Die lokale JSON-/IndexedDB-Ablage besitzt keine Datenbankindizes. Regeln sind
  in Anwendung und Helfer abgesichert, nicht durch SQL-Constraints.
- Mehrere neuere Paketstände wurden erkannt, aber ohne Sicherheitsbefund nicht
  blind eingespielt, da insbesondere Vinext, Vite, ESLint, TypeScript und Node-
  Typen größere Kompatibilitätssprünge enthalten.

## 12. Bewusst nicht gelöschte Punkte

- zehn variantenreferenzierte Steuerdatensätze
- sämtliche Varianten-Snapshots und Historien
- alle 18 Hausvorlagen und die nach vollständiger Aktionsbildsicherung 72
  tatsächlich referenzierten Bilddateien
- Aktionsbild-Nutzungshistorie
- Upload- und Schedulerhistorie innerhalb der zentralen Größenlimits
- bestehende Benutzerwerte in Projektierungsfeldern
- aktuelle Paketversionen ohne Sicherheitswarnung

## 13. Empfohlene nächste Optimierungen

1. Eine dokumentierte Immoprofessional-API für Lesen, Statusbestätigung und
   Löschen anbinden.
2. Vor einer Mehrbenutzer-/Cloudversion Supabase-Migrationen mit eindeutigen
   Indizes für Objektnummer, aktive Job-ID und genau eine aktuelle
   Aktionsbildzuordnung je Grundstück entwerfen.
3. Die zehn variantenreferenzierten Steuerdatensätze nach fachlicher Freigabe
   entweder dauerhaft als Historie kennzeichnen oder migrieren.
4. Abhängigkeiten in einer separaten Upgrade-Branch gruppenweise aktualisieren
   und jeden Stackwechsel mit Build- und Browsertests absichern.
5. Für FTPS einen serverseitig bestätigten Importbeleg beziehungsweise eine
   abrufbare externe Job-ID speichern, sobald Immoprofessional dies anbietet.

## Kurzklassifikation

### Sicher bereinigt

- Legacy-Hinweisfeld und alte Round-Robin-Zustände
- überzählige aktive Hauszuordnungen oberhalb der Vierergrenze
- unreferenzierte Starter- und Dateikopien
- begrenzte und redigierte Logs

### Technisch zusammengeführt

- Statusmodell
- Projektierungsstandards
- Hausrotation und Sperrprüfung
- Aktionsbildinvariante
- Upload-Idempotenz und Joblocking

### Nur markiert, noch nicht gelöscht

- zehn variantenreferenzierte Steuerdatensätze
- potenzielle spätere SQL-/Supabase-Constraints
- verfügbare, aber nicht sicherheitskritische Paketupdates

### Offene Risiken

- fehlende externe Lösch-/Status-API
- fehlende serverseitige FTPS-Idempotenzbestätigung
- lokale statt relationale Datenhaltung
