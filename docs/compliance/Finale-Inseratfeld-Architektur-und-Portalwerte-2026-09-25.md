# Finale Inseratfeld-Architektur und Portalwerte

## Report

Dieses Feature trennt die Inserattexte in zwei klar abgegrenzte Gruppen:

- dynamisch: `Objektbeschreibung` und `Lage`; sie können auf ausdrücklichen Nutzerwunsch neu erzeugt werden;
- statisch: `Ausstattung`, `Sonstiges`, `Provision`, `Anmerkung`, `Allgemeine Geschäftsbedingungen` und `Freier Textblock für Empfehlungen`.

Neue Inserate erhalten die versionierten zentralen Standardtexte. Jedes statische Feld speichert zusätzlich seinen Ursprung (`standard` oder `manual`) und kann einzeln nach Bestätigung auf den aktuellen Standard zurückgesetzt werden. Ein manueller Wert wird weder durch KI-Generierung, Rotation, App-Start, Normalisierung noch OpenImmo-Export ersetzt.

Die sechs Textblöcke werden separat in OpenImmo abgebildet. Insbesondere bleibt der Empfehlungsblock ein eigenes `user_defined_simplefield` und wird nicht mit `Sonstiges` zusammengeführt.

Für projektierte Living-Haus-Inserate gilt im Export:

- keine strukturierte `heizungsart` (Immoprofessional: keine Angabe);
- Befeuerung: Wärmepumpe;
- Energietypen: KFW40 und KFW55;
- Energieklasse: A++ als Projektierungswert, niemals als vorliegender Energieausweis;
- provisionspflichtig: `false`.

Ein später vorliegender Energieausweis behält bei Energiebedarf und Energieklasse Vorrang.

## Begründung

Ein expliziter Feldursprung ist belastbarer als eine reine Texterkennung: Er verhindert, dass ein tatsächlich manuell bearbeiteter Text bei künftigen Standardupdates überschrieben wird. Stringvergleiche werden ausschließlich für die Read-only-Einordnung alter, noch unmarkierter Bestandsdaten gegen explizit eingefrorene frühere Systemstandards verwendet.

Der zentrale Ausstattungstext bleibt der Claim-Policy unterworfen. Eine Ausnahme für den Wortlaut allein gibt es nicht: Der Export lässt ihn nur zu, wenn alle darin verwendeten Living-Haus- und I-KON-Fakten strukturiert belegt sind. Abweichende manuelle Texte werden gespeichert, aber bei einem BLOCK nicht exportiert.

Die historische Phase-2B-Bereinigung verwendet weiterhin ihre damals freigegebenen Ersatztexte. Neue Mastertexte können damit weder einen abgeschlossenen Migrationsnachweis noch dessen idempotente Tests nachträglich verändern.

## Hürden und Risiken

- Die 44 aktiven Bestandsinserate besitzen noch keine persistierten Ursprungmarker für die neu getrennten statischen Felder. Der Read-only-Plan akzeptiert deshalb nur bytegleich bekannte frühere zentrale Standards als `STANDARD_REPLACE_SAFE`; jeder andere Wert bliebe `MANUAL_DIFFERENCE`.
- Portalwerte sind Exportmapping, keine rückwirkende Portalmutation. Die Vorschau zeigt gespeicherte Quellwerte und Zielzustand, führt aber keinen Import oder Upload aus.
- Der lange Mastertext enthält technische und DGNB-bezogene Aussagen. Fehlende I-KON- oder Serienfakten führen bewusst zu einem Export-BLOCK statt zu einer stillen Textänderung.

## Read-only-Bestandsergebnis vom 25.09.2026

- aktive Inserate: 44
- Mastertext-Claim-Checks: 44 PASS, 0 BLOCK
- `Ausstattung`, `Sonstiges`, `Provision`, `Anmerkung`, `Empfehlung`: je 44 `STANDARD_REPLACE_SAFE`
- `Allgemeine Geschäftsbedingungen`: 44 `ALREADY_CORRECT`
- `MANUAL_DIFFERENCE`: 0
- mögliche spätere, feldgenaue Standardmigrationen: 220

Es wurde keine Bestandsmigration, kein Katalogschreiben, kein Upload und keine Portalaktion ausgeführt.

## Technische Abnahme

- vollständige Testsuite: 603 bestanden, 0 fehlgeschlagen, 1 Windows-spezifischer Skip;
- ESLint: 0 Fehler, 0 Warnungen;
- Produktions-Build: PASS;
- lokaler OpenImmo-Smoke-Test: PASS für alle 44 aktiven Inserate in 11 Projektpaketen. Die 73 lokalen Bilddateien wurden ausschließlich in den Arbeitsspeicher geladen; es wurden weder ZIP-Dateien noch XML-Dateien persistiert oder übertragen.
