# Integration Objekttext und globale Objektfelder – 26. September 2026

## Report

- Integrationsbranch: `integration/object-copy-and-global-fields`
- Gemeinsamer Base-Commit:
  `7f2634f1c2771a746557ab9314d6663e8a4f8250`
- Integrierte Quell-Commits:
  - Objekttext: `30a48edf8e45a85436066db5adc043ea9fe42116`
  - Objektfelder: `274bc6e32e4f5e48670e94fa26d771791a5cf606`
- Beide Quell-Commits besitzen denselben unmittelbaren Eltern-Commit. Keiner
  enthielt zuvor Änderungen des anderen.
- Überschneidungen bestanden nur in `listing-copy.mjs` und
  `tests/listing-copy.test.mjs`. Git konnte beide Änderungen textuell ohne
  Konflikt verbinden. Die Zusammenführung wurde anschließend semantisch
  geprüft: Objekttext-CTA, Längen- und Inhaltsregeln sowie die globale
  Schema-5-Normalisierung sind gleichzeitig vorhanden und getestet.
- Es wurde kein produktiver Upload, keine Portalmigration und keine
  automatische Bestandsregeneration ausgeführt.

## Begründung

Die Integration wurde exakt vom gemeinsamen Produktionsstand aufgebaut und
übernimmt beide geprüften Feature-Patches einzeln. Damit lässt sich ihre
Herkunft eindeutig nachvollziehen, ohne einen Feature-Branch irrtümlich als
vollständigen Endstand zu behandeln. Die gemeinsame Vollsuite prüft zusätzlich
die Wechselwirkung zwischen dynamischer Objektbeschreibung, statischer Copy,
Katalognormalisierung, Claim-Policy und OpenImmo-Export.

## Testanzahl

Der Objektfeld-Branch enthält die Basissuite mit insgesamt 609 Tests: 608
bestanden und ein erwarteter Windows-Skip. Das Objekttext-Feature ergänzt exakt
drei Testfälle:

1. Preise und interne Varianten werden nicht an die KI-Quelle gegeben.
2. Preise und interne Varianten werden in generierten Objektbeschreibungen
   zurückgewiesen.
3. Fünf unterschiedliche Fallback-Texte werden auf Redaktion, Wortzahl und
   Compliance geprüft.

Der kombinierte Stand besitzt daher 612 Tests: 611 bestanden, 0 fehlgeschlagen
und 1 erwarteter Windows-Skip. Es wurden keine Tests entfernt.

## A++-Sonderprüfung

Das reguläre Portal-Dropdown wird im OpenImmo-Standard über
`zustand_angaben/energiepass/wertklasse` versorgt. Dieses Feld gehört zum
Energiepass und wird in der aktuellen Exportlogik nur aus einem verifizierten
oder vertraglich eingeschlossenen Fakt mit Evidenzart `ENERGY_CERTIFICATE`
gebildet.

Der vorhandene globale A++-Fakt besitzt dagegen den Status `planned` und die
Evidenzart `PROJECTED_HOUSE_ENERGY_CLASS`. Er wird deshalb getrennt als
`user_defined_simplefield` mit der eindeutigen Kennzeichnung „Planungswert,
kein individueller Energieausweis“ übertragen. OpenImmo 1.2.7d definiert kein
separates Standardfeld für eine projektierte Energieeffizienzklasse. Ob
Immoprofessional oder ImmoScout ein herstellerspezifisches, eindeutig als
projektiert bezeichnetes Feld abbilden kann, ist mit der vorhandenen
Integration nicht belegt.

Für A++ im regulären Energieklasse-Dropdown wäre ein belastbarer individueller
Energieausweis bzw. ein gleichwertiger freigegebener Evidenzdatensatz für das
konkrete Objekt erforderlich. Alternativ wären eine dokumentierte separate
Portal-Schnittstelle für Planungswerte und eine fachliche Compliance-Freigabe
nötig. Einen bloß projektierten Wert in `energiepass/wertklasse` zu schreiben,
würde die bestehenden Regeln gegen die Darstellung projektierter Werte als
vorhandener Energieausweis verletzen und erforderte eine ausdrückliche Änderung
der zentralen Policy. Eine echte getrennte, klar beschriftete Portalübertragung
könnte dagegen als evidenzgebundene Policy-Erweiterung bewertet werden.

## Verifikation

- Fokussierte Integrationssuite: 75/75 bestanden
- Fünf Objekttext-Testgenerationen: 235, 235, 256, 245 und 247 Wörter
- Claim-Scan dieser Texte: `BLOCK = 0`, `REVIEW = 0`
- Vollständige Suite: 612 Tests, 611 bestanden, 0 fehlgeschlagen,
  1 erwarteter Windows-Skip
- ESLint: 0 Fehler, 0 Warnungen
- Produktions-Build: PASS
- OpenImmo-, Schema-5-Migrations-, Normalisierungs-, Claim-Policy- und
  Creative-Payload-Tests: PASS

## Hürden und Risiken

- Eine konfliktfreie automatische Git-Zusammenführung garantiert keine
  fachlich vollständige Integration. Deshalb wurden die beiden überlappenden
  Dateien gezielt gelesen und gemeinsam getestet.
- Externe LLM-Ausgaben bleiben sprachlich variabel. Längen-, Preis-, Varianten-
  und Claim-Grenzen werden jedoch vor Verwendung validiert; der deterministische
  Fallback erfüllt dieselben Regeln.
- Der Prompt erlaubt einen kurzen Finanzierungshinweis nur bei einem konkreten,
  strukturierten und freigegebenen Finanzierungsfakt. Ein solcher dedizierter
  Fakt wird im aktuellen Faktenmodell nicht geliefert; die fünf geprüften Texte
  enthalten deshalb regelkonform keinen Finanzierungshinweis.
- Das Portal kann das Standard-Energieklasse-Dropdown weiterhin als „keine
  Angabe“ darstellen. Diese bewusste Compliance-Grenze wurde nicht gelockert.
- Bestehende veröffentlichte Inserate ändern sich erst durch einen späteren,
  separat kontrollierten CHANGE-Upload.
