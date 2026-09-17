# Grundstücksauswahl nach eigenem PLZ-Gebiet

## Änderung

- Zwei getrennte Bereiche: „Im eigenen PLZ-Gebiet“ oben, „Außerhalb des eigenen PLZ-Gebiets“ darunter.
- Beide behalten die bestehende Bundesland-/Landkreis-Unterteilung. Standard ist aufsteigende PLZ-Sortierung; Gruppen werden nach ihrer kleinsten PLZ geordnet.
- Maßgeblich sind ausschließlich die aktiven PLZ aus dem Blatt `Suchgebiet` der konfigurierten lokalen Grundstücksliste.
- Grundstücke außerhalb bleiben manuell anlegbar, bearbeitbar und bei gültiger öffentlicher Anschrift auswählbar.
- Die bestehenden Adressprüfungen gelten unverändert. Nicht öffentliche Anschriften bleiben im Prüfbereich.
- Bestehende Online-Inserate werden weder entfernt noch verändert; Gebietszuordnung ist reine Darstellung.

## Technischer Ansatz und Begründung

Der vorhandene lokale Sync-Status liefert zusätzlich eine ausschließlich lesend ermittelte Gebietsliste. Dafür wird ein unveränderlicher Byte-Snapshot der Excel gelesen, ohne Excel-Synchronisation oder Katalogmutation auszulösen. Auch bei pausierter Synchronisation ist der Gebietsabgleich verfügbar. Die Oberfläche partitioniert die bereits gefilterten Grundstücke anhand exakter fünfstelliger PLZ und nutzt anschließend ihre bisherigen Gruppierungen und Auswahlprüfungen.

Fehlende/ungültige Konfiguration sowie ein nicht erreichbarer Helper ergeben ausdrücklich „Gebietszuordnung nicht verfügbar“, niemals eine pauschale Zuordnung nach außerhalb. Eine neue Gebietsliste verändert nur die Darstellung, keine Publikationsfreigaben.

## Hürden und Risiken

- `read-excel-file` 9.3.4 erwartet den Blattnamen als zweites Argument. Ein Optionsobjekt mit `sheet` liest irrtümlich das erste Blatt. Ein synthetischer Zwei-Blatt-Integrationstest sichert den tatsächlichen Bibliotheksvertrag ab.
- Doppelte aktive PLZ, unklare Aktivwerte, ungültige PLZ und eine leere aktive Liste werden nicht geraten, sondern als nicht zuordenbar behandelt.
- Ohne Helper wird kein veralteter Gebietsstand verwendet. Die Liste wird beim vorhandenen Statusabruf erneut gelesen; kein zusätzlicher Timer oder Scheduler.
- Fremde Änderungen des Grundstücksmonitors, README und CHANGELOG gehören ausdrücklich nicht zu diesem Stand.
- macOS-System-Git ist durch die ausstehende Xcode-Lizenz blockiert. Verwendet wurde das vorhandene gebündelte Git, ohne Lizenzannahme oder globale Konfigurationsänderung.

## Prüfung

- 21 gezielte Tests: Gebietszuordnung, echte XLSX-Blattauswahl, Adressauswahl, Status und UI-Rendering bestanden.
- Vollständiger Arbeitsbaum-Testlauf: 564 Tests, 563 bestanden, 1 plattformbedingt übersprungen, 0 Fehler.
- TypeScript, ESLint und Produktionsbuild erfolgreich.
- Read-only Echtabgleich: 50 aktive PLZ; 118 aktive Grundstücke, davon 66 auswählbar. Davon 28 innerhalb und 38 außerhalb; 52 bleiben im Adressprüfbereich.
- Excel und Katalog vor/nach dem Abgleich per SHA-256 unverändert.
- Keine Rotation, kein Upload, kein DELETE, kein Portalexport ausgelöst.
