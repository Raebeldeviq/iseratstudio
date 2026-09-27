# Finale Portalfreitexte – 27.09.2026

## Implementierung

- Der globale feste Provisionstext bleibt im portablen OpenImmo-Feld
  `courtage_hinweis` erhalten und wird zusätzlich über die bestätigte
  Immoprofessional-Feldkennung `anklickbar` an das ausführliche Portal-Feld
  `Provision` übergeben.
- Der globale feste HEUN-Finanz-Text wird über die bestätigte Feldkennung
  `allgemein2` an `Freier Textblock für Empfehlungen` übergeben.
- Beide portalspezifischen Felder liegen als direkte Objekterweiterungen unter
  `immobilie`. Die zuvor wirkungslose Ablage des Empfehlungstextes innerhalb
  von `freitexte` wurde entfernt.
- `Anmerkung`, `Allgemeine Geschäftsbedingungen` und sämtliche strukturierten
  Portalwerte bleiben unverändert.

## Begründung

Die festen Solltexte waren in Katalog und Normalisierung bereits korrekt. Die
Abweichung entstand erst beim Import: `courtage_hinweis` befüllt nicht das
ausführliche Immoprofessional-Feld `anklickbar`; `allgemein2` wurde im falschen
OpenImmo-Kontext übergeben. Die Korrektur erfolgt deshalb ausschließlich im
zentralen OpenImmo-Adapter und baut keinen parallelen Text- oder Uploadpfad.

## Hürden und Risiken

- Die sichtbaren Portalbezeichnungen entsprechen nicht den internen
  Importkennungen.
- Portalspezifische Kennungen bleiben auf Immoprofessional beschränkt und sind
  durch XML-, Payload- und Schemaregressionstests abgesichert.
- Historische Katalogwerte bleiben gespeichert; der Export setzt ausschließlich
  die zwei ausdrücklich global festgelegten Texte durch.
