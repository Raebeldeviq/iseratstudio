# Verbleibende Portalfelder – 26.09.2026

## Implementierung

- `anzahl_etagen` wird mit der zentralen Bungalowzuordnung im laut
  OpenImmo-1.2.7d-Schema korrekten Container `geo` ausgegeben. Die vier
  freigegebenen SOL-/Solution-Bungalows erhalten `1`, alle übrigen Modelle `2`.
- Der Anbieterblock enthält die für OpenImmo 1.2.7d erforderliche
  `openimmo_anid`; dafür wird die bestehende Anbieternummer verwendet.
- Numerische XML-Werte verwenden den schemaerforderlichen Dezimalpunkt; die
  technische Verwaltung enthält die erforderliche `objektnr_extern`.
- Die bestehende CHANGE-Aktion und `stand_vom` werden in den von OpenImmo
  1.2.7d vorgesehenen Formen ohne Fremdattribut beziehungsweise als Datum
  ausgegeben.
- Die strukturierte Immoprofessional-Bauphase wird zentral über das interne
  Importfeld `data104` mit dem Enumwert `HausInPlanung` übertragen. Der
  bestehende OpenImmo-Objektzustand `PROJEKTIERT` bleibt unverändert.
- Der feste HEUN-Finanz-Empfehlungstext wird über das Immoprofessional-
  Importfeld `allgemein2` übertragen. Die wirkungslose Zuordnung über den
  sichtbaren Feldtitel wurde entfernt.

## Begründung

Die Korrektur bleibt im bestehenden OpenImmo-Exportpfad. Sie ergänzt keinen
zweiten Upload- oder Normalisierungsweg. Standardfelder werden schemakonform
positioniert; die beiden Immoprofessional-spezifischen Zielfelder verwenden
zentral definierte Importkennungen und deren strukturierte Ausprägung.

## Ursache und Risiken

- Die Etagenzahl stand im falschen XML-Container `flaechen`; OpenImmo 1.2.7d
  definiert sie unter `geo`. Immoprofessional übernahm sie deshalb nicht.
- `zustand_art=PROJEKTIERT` befüllt den Objektzustand, aber nicht zuverlässig
  die getrennte Portal-Bauphase. Dafür fehlte der portalinterne Enumwert.
- Der sichtbare Titel „Freier Textblock für Empfehlungen“ wurde als Name eines
  benutzerdefinierten Feldes übertragen. Immoprofessional erwartet für dieses
  Bestandsfeld jedoch seine interne Kennung `allgemein2` und ließ den Alttext
  daher unverändert.
- Die internen Immoprofessional-Feldkennungen sind portalspezifisch. Ihre
  Verwendung ist deshalb bewusst auf den zentralen Exportadapter begrenzt und
  durch XML-Regressionsprüfungen abgesichert.
