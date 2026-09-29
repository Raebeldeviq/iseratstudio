# Inseratsmanager: Objektnummernsuche und kompakte Karten

## Änderung

- Ein Suchfeld filtert die vorhandene Inseratsliste sofort nach vollständiger oder teilweiser Objektnummer.
- Bei genau einem Treffer öffnet sich dessen Karte automatisch. Bei mehreren Treffern bleiben die Karten kompakt und lassen sich einzeln öffnen.
- Die kompakte Zeile zeigt Objektnummer, Hausvariante, Adresse, Status mit Health Score sowie vorhandenen Premium- und Löschschutz.
- Die bisherige Detailansicht und sämtliche Steuerfelder bleiben unverändert hinter dem Aufklappen erhalten. Die Grundstücksgruppierung arbeitet mit den sichtbaren Treffern weiter.

## Ansatz

Die Suche filtert nur die bereits im Inseratsmanager geladenen Katalogeinträge. Offen/geschlossen ist reiner UI-Zustand und wird nicht in Inseratsdaten gespeichert. Das verhindert Änderungen an Scheduler, Rotation, Upload, Premium- und Batchlogik.

## Hürden und Risiken

- Mehrere Inserate können denselben Nummernteil enthalten. Deshalb öffnet die Suche nur bei genau einem Treffer automatisch; sonst wählt Pascal die Karte selbst.
- Leere oder noch nicht hochgeladene Objektnummern sind über die Nummernsuche nicht auffindbar, bleiben aber in der normalen Übersicht sichtbar.
- Auf kleinen Bildschirmen verteilt sich die kompakte Zeile über mehrere Zeilen; alle Detailfelder bleiben zugänglich.

## Prüfung

- Fokussierte Such-, Manager- und Katalogtests bestanden.
- Gesamtsuite: 660 bestanden, 1 übersprungen, 0 fehlgeschlagen. ESLint und Produktions-Build bestanden.
