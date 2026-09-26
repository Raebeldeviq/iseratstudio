# Manueller Uploadstatus – fail-closed Persistenz

## 1. Implementierung

- Der lokale Upload-Helfer übernimmt einen erfolgreich abgeschlossenen manuellen FTPS-Transfer jetzt atomar in den autoritativen Gerätekatalog.
- Persistiert wird ausschließlich `transferred_pending_import` (Übertragung abgeschlossen, Importbestätigung ausstehend).
- Bei Rotationskopien bleibt der Quell-Datensatz unverändert; sein zentraler veröffentlichter Lifecycle-Kontrollstatus wird bewahrt. Die eindeutige Beziehung aus Ersatzinserat und Upload-Job wird als ausstehende Rotation gespeichert.
- Bereits abgeschlossene Upload-Jobs werden ohne erneuten Transfer idempotent mit dem Katalog abgeglichen.
- Die Oberfläche lädt nach einem Sammellauf den autoritativen Gerätekatalog neu. Sie archiviert die Quelle nicht mehr und schließt weder Haus- noch Aktionsbildrotation vorzeitig ab.

## 2. Begründung

FTPS bestätigt nur die Übertragung des OpenImmo-Pakets, nicht dessen erfolgreichen Import in Immoprofessional oder die nachgelagerte Darstellung im Portal. Deshalb darf der endgültige Statuswechsel erst durch einen belastbaren positiven Importbericht erfolgen. Die bestehende zentrale Rotationsfunktion für den Zwischenstatus wird wiederverwendet; es entsteht keine parallele Lifecycle-Logik.

## 3. Hürden und Risiken

- Der Upload-Job-Ledger und der Gerätekatalog sind getrennte persistente Speicher. Schlägt die Katalogaktualisierung nach abgeschlossenem Transfer aus, verhindert der Ledger einen Doppelupload; ein idempotenter Wiederholungsaufruf repariert ausschließlich den fehlenden Katalogstatus.
- Ein Job wird nur übernommen, wenn Projekt, Inserat, externe Objektnummer und Version exakt zum gespeicherten Inserat passen und der Ledger den abgeschlossenen Transfer belegt.
- Archivierung, Löschung, Hausrotation und Aktionsbildnutzung bleiben bis zur bestätigten Portalverarbeitung unangetastet.
- Diese Änderung führt keinen Upload, keine Löschung und keine Lockerung der Compliance- oder OpenImmo-Regeln aus.
