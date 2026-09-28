# Objektstatus-Canary: OFFEN und Simplefield status – 28.09.2026

## Änderung

Der OpenImmo-Export setzt `zustand_angaben/verkaufstatus@stand` auf `OFFEN`. Zusätzlich schreibt er in `zustand_angaben` das Testfeld `user_defined_simplefield feldname="status"` mit dem Wert `NEU`. Ein gezielter Regressionstest prüft beide Werte im finalen ZIP und schließt `verkaufstatus@stand="NEU"` aus.

## Begründung

`OFFEN` beschreibt den Verkaufsstand. Das sichtbare Immoprofessional-Feld „Status des Objektes“ hat intern die Kennung `status`; das Simplefield prüft einmalig, ob der Importer diese Kennung übernimmt. Die Codeänderung bleibt bis zur Rückmeldung zum Canary auf diesem Fix-Branch und wird nicht in die laufende Produktion integriert.

## Hürden und Risiken

Die interne Formular-Kennung belegt noch kein Importmapping. Erst die Sichtprüfung nach dem einmaligen Canary-Import entscheidet, ob das Simplefield übernommen oder wieder entfernt wird. Beim Test bleibt die Objektnummer `30460-900001`; alle vier Portalhaken waren vor dem erneuten Import aus. Die 76 Bestandsinserate werden nicht erneut übertragen.

## Lokaler Testnachweis

- Gezielt ausgeführter OpenImmo-Test: 9 bestanden.
- ESLint für die geänderten Quelldateien: bestanden.
- Test-ZIP: `outputs/immoprofessional-canary-20260928/status-simplefield-test/canary-30460-900001-status-offen-simplefield-2026-09-28.zip`.
- SHA-256: `da8904c83f155ca70bb262c85bf0ed5284894ae4118ca5a511d97763a4f458f0`.
- Im ZIP liegt genau ein Objekt. Die 13 Bilddateien sind bytegleich zum zuvor übertragenen Canary; nur die beiden Statuswerte im XML sind verändert.
- Der Produktions-Build konnte in dieser isolierten Arbeitskopie wegen Schreibschutz am verknüpften `node_modules/.vite-temp` nicht starten. Das ist keine Aussage über die Buildfähigkeit des Codes.
