# Globale Objektfelder für Immoprofessional/OpenImmo – 26. September 2026

## Report

- Die zentrale Projektierungsnormalisierung setzt für bestehende und künftige
  Inserate einheitlich `GEHOBEN`, Baujahr `2027`, `PROJEKTIERT`, verfügbar ab
  `2027`, Wärmepumpe, KFW40, KFW55, den projektierten Wert `A++` und
  `provisionspflichtig = false`.
- Der Katalog erhält Daten-Schema 5. Beim kanonischen Laden werden bestehende
  Inserate deterministisch auf diese globalen Projektierungswerte normalisiert;
  die Katalogmigration bleibt backup- und idempotenzgesichert.
- Der OpenImmo-Export schreibt Baujahr und Verfügbarkeit aus der zentralen
  Projektierung, lässt `heizungsart` weiterhin weg und exportiert bei
  Provisionsfreiheit keinen `courtage_hinweis`.
- Wärmepumpe und KFW40/KFW55 werden weiterhin ausschließlich aus den bereits
  freigegebenen, evidenzgebundenen Claim-Policy-Fakten exportiert. Persistierte
  Projektierungswerte ersetzen diese Freigabe nicht.
- `A++` bleibt als „Projektierte Energieeffizienzklasse – Planungswert, kein
  individueller Energieausweis“ gekennzeichnet. Es wird nicht in
  `energiepass/wertklasse` geschrieben.
- Es wurde kein Upload, keine Portaländerung und keine produktive
  Katalogmigration ausgeführt.

## Begründung

Die globale Vorgabe liegt in der bereits zentral genutzten
`IMMOPROFESSIONAL_DEFAULTS`-/Normalisierungslogik. Dadurch greifen dieselben
Werte bei Neuanlage, Rotation, Bestandsbereinigung und Export, ohne
portalabhängige Parallelkonfiguration einzuführen. Das explizite Daten-Schema 5
macht die Bestandsnormalisierung nachvollziehbar und sorgt vor einer realen
Migration für den vorhandenen Katalogbackup.

`verfuegbar_ab` ist im offiziellen OpenImmo-1.2.7d-Schema als freies Textfeld
unter `verwaltung_objekt` definiert; der Wert `2027` ist deshalb zulässig. Das
Feld `wertklasse` gehört dagegen zum Energiepass. Ein projektiertes A++ dort
einzutragen, würde den vorhandenen Schutz gegen einen nicht belegten
individuellen Energieausweis umgehen. Die bestehende Claim-Policy bleibt daher
unverändert und fail-closed.

## Hürden und Risiken

- Immoprofessional/ImmoScout kann die projektierte A++-Freitextangabe anzeigen,
  wird damit aber voraussichtlich nicht das Standard-Dropdown „Energieklasse“
  befüllen. Das exakte Portalbild ist ohne belegten Energieausweis oder ein
  dokumentiertes separates Hersteller-Mapping fachlich nicht sicher erzwingbar.
- Bereits veröffentlichte Inserate ändern sich extern erst nach einem separat
  kontrollierten CHANGE-Upload. Diese Änderung löst selbst keinen Upload aus.
- Manuelle Provisionstexte bleiben im Katalog erhalten, werden bei
  `provisionspflichtig = false` aber nicht mehr als Courtage-Hinweis exportiert.
- Baujahr `2027` und Verfügbarkeit `2027` sind bewusst globale Portalwerte und
  übersteuern abweichende Legacy-Projektierungswerte. Die fachliche Gültigkeit
  dieser globalen Vorgabe muss vor jedem späteren Jahreswechsel erneut geprüft
  werden.

## Verifikation

- Produktions-Build: PASS
- Gesamtsuite: 609 Tests, 608 bestanden, 0 fehlgeschlagen, 1 Windows-Skip
- ESLint: 0 Fehler, 0 Warnungen
- Gezielte Objektfeld-, Katalogmigrations-, OpenImmo-, Claim-Policy- und
  Creative-Payload-Tests: PASS
- Offizielles OpenImmo-1.2.7d-Schema: Position und Datentyp von
  `verfuegbar_ab`, `zustand_art=PROJEKTIERT` und `energiepass/wertklasse`
  geprüft
