# Objektstatus-Canary: OFFEN und Simplefield status – 28.09.2026

## Änderung

Der OpenImmo-Export setzt `zustand_angaben/verkaufstatus@stand` auf `OFFEN`. Das erfolglos getestete `user_defined_simplefield feldname="status"` mit dem Wert `NEU` wurde wieder entfernt. Ein gezielter Regressionstest prüft im finalen ZIP `OFFEN` und das Fehlen beider wirkungslosen `NEU`-Varianten.

## Begründung

`OFFEN` beschreibt den Verkaufsstand. Das sichtbare Immoprofessional-Feld „Status des Objektes“ hat intern die Kennung `status`. Zwei Canary-Transfers mit dem Simplefield befüllten dieses Feld nicht. Deshalb bleibt `NEU` ein manueller Schritt nach dem Import. Der Verkaufsstand `OFFEN` bleibt als strukturiertes OpenImmo-Feld erhalten.

## Hürden und Risiken

Die interne Formular-Kennung belegte kein Importmapping. Nach dem negativen End-to-End-Befund wurde das Simplefield entfernt. Beim Test blieb die Objektnummer `30460-900001`; die 76 Bestandsinserate wurden nicht erneut übertragen. Ohne eine konkrete Importfeld-Auskunft von Immoprofessional wird für dieses Feld nicht weiter entwickelt.

## Lokaler Testnachweis

- Gezielt ausgeführter OpenImmo-Test: 9 bestanden. Die Gesamtsuite und der Produktions-Build bestanden ebenfalls.
- ESLint für die geänderten Quelldateien: bestanden.
- Historisches Test-ZIP für den negativen Canary-Nachweis: `outputs/immoprofessional-canary-20260928/status-simplefield-test/canary-30460-900001-status-offen-simplefield-2026-09-28.zip`.
- SHA-256: `da8904c83f155ca70bb262c85bf0ed5284894ae4118ca5a511d97763a4f458f0`.
- Im ZIP liegt genau ein Objekt. Die 13 Bilddateien sind bytegleich zum zuvor übertragenen Canary; nur die beiden Statuswerte im XML sind verändert.

## Betriebsregel

`OPENIMMO_VERKAUFSTATUS = OFFEN`, `IMMOPROFESSIONAL_STATUS_NEU = MANUELL`, `STATUS_SIMPLEFIELD = ENTFERNT`.
