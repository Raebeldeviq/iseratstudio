# Finale Portalproduktion – 27. September 2026

## Implementierter Stand

Der Release konsolidiert die vier linearen Fixes nach dem bisherigen
Produktionsstand `242e01e`:

- exakte Portal- und Objektfelder einschließlich der bestätigten
  Etagen-/Barrierefrei-Logik;
- die verbleibenden OpenImmo-Feldzuordnungen und die portalgeeignete Bauphase;
- den finalen Provisionstext und den finalen Empfehlungstext;
- die evidenzgebundene Wiederherstellung der Canary-Energiepassdaten über
  verifizierte `energy_certificate`-Facts.

Die zentrale Claim-Policy, der fail-closed OpenImmo-Export und die Trennung
zwischen projektierten Energiekennwerten und Energieausweiswerten bleiben
unverändert erhalten. Es wurden keine Portal-, FTPS-, Lösch-, Rotations- oder
Scheduler-Aktionen ausgeführt.

## Begründung des Integrationswegs

Die Git-Abstammung ist vollständig linear:

`242e01e` → `4e14fa8` → `84fdf82` → `82ebe20` → `17b50c4`

Deshalb wurde der Release-Branch per Fast-Forward auf `17b50c4` gebracht.
Separate Cherry-Picks oder parallele Implementierungen derselben Logik wären
unnötig und hätten das Risiko doppelter beziehungsweise obsoleter Änderungen
erhöht.

## Verifikation

- Gesamtsuite: 624 Tests, 623 bestanden, 0 fehlgeschlagen, 1 erwarteter
  Windows-Skip;
- fokussierte Export-, Bungalow-, Freitext-, Claim- und Energiepass-Suite:
  33/33 bestanden;
- ESLint: 0 Fehler, 0 Warnungen;
- Produktions-Build: PASS;
- read-only Claim-Scan des aktuellen lokalen Katalogs: `BLOCK = 0`,
  `REVIEW = 0`;
- lokaler OpenImmo-Smoke: 25/25 aktuelle Inserate in 6 Projektpaketen, 73
  Bilder ausschließlich im Arbeitsspeicher geladen, keine Persistenz und keine
  Übertragung.

## Hürden und Risiken

- Der historische Auftrag nennt drei Fix-Commits; zwischen `4e14fa8` und
  `82ebe20` liegt zusätzlich der notwendige Commit `84fdf82`. Er ist im
  linearen Zielstand bereits enthalten und darf nicht ausgelassen werden.
- Build und ESLint liefen im Dokumente-/iCloud-Worktree in Dateisystem-Timeouts.
  Die identische Commit- und Lockdatei-Kombination wurde deshalb zusätzlich in
  einem lokalen temporären Worktree geprüft; dort waren beide Prüfungen grün.
- Der aktuelle lokale Katalog umfasst 25 aktive Inserate. Die frühere Zahl 44
  beschreibt einen älteren Bestandszeitpunkt und wurde nicht als heutiger
  Katalogzustand angenommen.
- Die bestätigten Werte `18 kWh/(m²*a)` und `A+` bleiben ausschließlich an den
  Canary und verifizierte Energieausweis-Facts gebunden. Es existiert kein
  globales Energiepass-Fallback.
