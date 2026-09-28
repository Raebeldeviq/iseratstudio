# Finale Nutzen-Titel und Vorbereitung des Portal-Canary – 28.09.2026

## Änderung und Begründung

Die Titelwahl bevorzugt bei belegter Living-Haus-Evidenz Festpreisgarantie, Bauversicherungen und die auf die tragende Holzkonstruktion begrenzte 30-jährige Garantie. Ein belegtes Bau-Cockpit oder I-KON-Paket kann gelegentlich die Nutzenrichtung bestimmen; der zweite USP bleibt dann ein direkt verständlicher Kundenvorteil. Die DGNB-Serienzertifizierung bleibt im Faktenpool, erscheint bei verfügbaren direkten Vorteilen aber nicht als Titelaufzählung. Die Auswahl ist weiterhin deterministisch, verwendet höchstens zwei freigegebene Fakten und ändert keine vorhandenen Inserattexte.

Die belegte Ortsauflösung aus dem vorherigen Feature-Commit bleibt unverändert: Marketingtitel verwenden Ort und Stadtteil zusammen, das OpenImmo-XML enthält `geo/ort` und `geo/regionaler_zusatz` getrennt. Amtliche Ortsnamen werden nur anhand der ausdrücklich freigegebenen Zuordnungen aufgelöst.

## Prüfung

- Gesamtsuite: 645 bestanden, 0 fehlgeschlagen, 1 übersprungen.
- ESLint und Produktions-Build bestanden.
- Read-only Neuberechnung der Titel für 80 im lokalen Katalog erfasste Inserate: 0 Claim-Blocks, 7 verschiedene Nutzen-Einstiege, 10 Titel mit einem technischen Begriff.
- OpenImmo-Orts- und Energie-ZIP-Tests sind in der Gesamtsuite enthalten.

## Immoprofessional: Safe-Path noch offen

Die lokalen Betriebsmodi für Rotation und Portalexport stehen auf `off`. Diese Modi steuern ausschließlich das Inseratestudio. Sie belegen nicht, wie Immoprofessional einen importierten Datensatz behandelt. Die im Portal sichtbare Option „Objekt beim Speichern übertragen“ stand bei einem zuvor nur lesend geprüften Objekt auf `ja`; die Portale wurden dort über objektspezifische Checkboxen ausgewählt. Weder ein Importprofil ohne Weitergabe noch ein verlässlicher Importvertrag für diese Checkboxen ist nachgewiesen. Die Herstellerdokumentation beschreibt den OpenImmo-Import und gesonderte Portalexporte, aber keinen verifizierten Import-Schalter für „nur intern anlegen“ oder „nur ImmobilienScout24 aktivieren“.

Deshalb wurde kein Canary hochgeladen und keine Portalcheckbox verändert. Ein kontrollierter Import wird erst möglich, wenn für einen reservierten Testdatensatz vorab nachweisbar ist, dass alle Portalziele aus bleiben und „Objekt beim Speichern übertragen“ keine Weitergabe auslöst. Dies erfordert eine bestätigte Immoprofessional-Konfiguration oder eine belastbare Herstellerauskunft. Das lokale Canary-Paket ist nur eine vorbereitete Datei; sein XML beweist keine Portalwirkung.

## Hürden und Risiken

- `verkaufstatus@stand=NEU` und `energiepass/epart=BEDARF` sind im XML belegt. Die Übernahme in die beiden sichtbaren Immoprofessional-Felder ist weiterhin offen.
- Eine objektspezifische IS24-Aktivierung per OpenImmo-Import ist nicht dokumentiert. Ein Haken könnte eine kostenpflichtige Veröffentlichung auslösen; dies wurde nicht ausprobiert.
- Vor einem späteren Import muss die Canary-Objektnummer zusätzlich direkt in Immoprofessional auf Nichtvorhandensein geprüft werden. Die lokale Kollisionprüfung allein genügt dafür nicht.

## Herstellerquellen

- https://www.immoprofessional.com/de/immobilienwebseite-schnittstellen/
- https://www.immoprofessional.com/de/immobilienwebseite-schnittstellen/immowelt-inserieren/
- https://www.immoprofessional.com/de/
