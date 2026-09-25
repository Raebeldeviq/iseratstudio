# Fixed Listing Copy Migration – 25.09.2026

## Report

Die Migrationslogik überführt ausschließlich die fünf zentralen statischen Inseratfelder `Ausstattung`, `Sonstiges`, `Provision`, `Anmerkung` und `Empfehlung` in den versionierten Standard. Für den freigegebenen Produktionsumfang sind exakt 44 aktive Inserate und damit exakt 220 Feldänderungen erforderlich. Die Allgemeinen Geschäftsbedingungen bleiben unverändert.

Vor einer Persistenz prüft die Migration die vollständige Read-only-Klassifikation, den Faktennachweis des Ausstattungstextes, die exakte 44×5-Änderungsmenge und das Fehlen manueller Abweichungen. Sie erzeugt einen byte-identischen lokalen Manifest-Backup, prüft dessen Wiederherstellbarkeit, schreibt über einen CAS-geschützten atomaren Snapshot und verifiziert danach Feldintegrität, den vollständigen Phase-2B-Claim-Scan (BLOCK 0 / REVIEW 0) sowie Idempotenz.

## Begründung

Die Anbindung an die vorhandene Snapshot-Speicherung garantiert, dass ein paralleler Katalogwechsel den Lauf stoppt und dass ein fehlendes Bild einen Commit verhindert. Die eigenständige Vergleichsprüfung reduziert den Nachher-Zustand nur um die ausdrücklich erlaubten Textwerte, Quellenmarker und die Standardversion. Jede andere semantische Differenz führt zu einem Fehler.

## Hürden und Risiken

Historische Katalogdatensätze besitzen keine Herkunftsmarker. Deshalb ist eine Migration ausschließlich für exakte, eingefrorene frühere Systemstandards zulässig; unbekannter Freitext oder ein expliziter manueller Ursprung stoppt den Lauf. Die Migration hat keinen Upload-, FTPS-, OpenImmo- oder KI-Pfad. Sie darf erst nach der erneuten Produktions-Bestandsprüfung ausgeführt werden und schreibt weder Titel noch Beschreibung, Lage, Projektierungswerte oder andere Katalogobjekte.
