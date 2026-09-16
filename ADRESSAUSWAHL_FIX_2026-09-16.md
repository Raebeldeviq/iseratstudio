# Öffentliche Anschriften in der Grundstücksauswahl

## Änderung

- Die normale Auswahl zeigt nur aktive Grundstücke mit öffentlicher Straße, fünfstelliger PLZ und Ort. Unbekannte/ausdrücklich nicht öffentliche Anschriften erscheinen im separaten Bereich „Müssen geprüft werden“ mit gesperrter Checkbox.
- Dieselbe Prüfung schützt Einzel-, Mehrfach- und gespeicherte Auswahl sowie den Fallback auf ältere Projekte. Im Prüfbereich gibt es keinen Löschknopf.
- Öffentliche Straßen ohne bestätigte Hausnummer, insbesondere der vereinbarte Platzhalter `0`, bleiben auswählbar und werden ausdrücklich gekennzeichnet. Der Hinweis ersetzt keine Adressprüfung vor Veröffentlichung.
- Die Zählung vorhandener Inserate und die komplette Bestandsliste im Inseratsmanager bleiben unabhängig von der neuen Auswahlprüfung.

## Begründung

Die Excel ist nicht der gespeicherte Inseratskatalog. Das Verschieben einer Excel-Zeile in einen Prüfreiter darf keinen bestehenden Online-Datensatz löschen. Deshalb wird die Eignung ausschließlich für die UI-Auswahl abgeleitet, ohne Grundstücke zu archivieren oder Projekte, Inserate, Scheduler und Veröffentlichungshistorie umzuschreiben. Die Prüfung verlangt keine Mitgliedschaft in der aktuellen Excel.

## Sicherheitsgrenzen und Risiken

- Kein Katalogimport, kein externer Aufruf und keine Bestandslöschung durch diesen Fix.
- Bestehende veröffentlichte Inserate bleiben auch bei fehlender aktueller Excel-Zeile vollständig erhalten.
- Die Heuristik erkennt typische maskierte/nicht öffentliche Anschriften; sie beweist weder aktuelle Verfügbarkeit noch rechtliche Bebaubarkeit eines Grundstücks.
- Keine Änderung an Hintergrundrotation, Production-DELETE, Portalexport oder fachlichen Freigaben. Pausierte Modi bleiben pausiert.
- Vorhandene Excel-/Monitor-Arbeiten im selben Arbeitsverzeichnis bleiben separat und werden nicht ungeprüft in einen Release übernommen.

## Tests

Regressionstests prüfen unbekannte Anschriften, fehlende PLZ/Orte, inaktive Datensätze, Hausnummer `0`, gespeicherte und Mehrfachauswahl, den Legacy-Fallback, unveränderte veröffentlichte Inserate und die gerenderte Grundstücksauswahl. Ein Render-Test verwendet ausschließlich synthetische Daten und löst keine Helper-Anfragen aus.

### Ergebnis vom 16. September 2026

- 13 gezielte Tests bestanden.
- Vollständige Suite: 554 Tests, 553 bestanden, 0 Fehler, 1 plattformspezifischer Test übersprungen.
- TypeScript, ESLint, Produktionsbuild und `git diff --check`: erfolgreich.
- Read-only Simulation am vorhandenen Katalog: 118 aktive Grundstücke, davon 66 auswählbar und 52 Prüffälle. Fünf Prüffälle sind mit bestehenden Projekten verknüpft; keine dieser Verknüpfungen wird gelöscht.
- 171 veröffentlichte Inserate bleiben im Katalog erhalten. Der Katalog war nach der Simulation bytegleich.
- Arbeitsbranch: `codex/plot-address-selection-guard-20260916`. Die installierte Runtime wurde durch Implementierung/Tests nicht geändert; die Übernahme und ein kontrollierter Neustart wurden separat zur Freigabe gestellt.
