# Exakte Portalfelder und Canary – 26. September 2026

## Report

- Die Etagenzahl und Barrierefreiheit werden zentral aus einer festen Liste der
  vier freigegebenen Bungalowmodelle abgeleitet: SOL 82, SOL 101, SOL 107 und
  SOL 110. Diese Modelle erhalten eine Etage und `barrierefrei=true`; alle
  anderen Modelle erhalten zwei Etagen und `barrierefrei=false`.
- Die OpenImmo-Ausgabe für Ausstattungsqualität, Befeuerungsart und Energietyp
  wurde an die Struktur von OpenImmo 1.2.7d angepasst. Exportiert werden
  `GEHOBEN`, Luft-Wärmepumpe sowie ausschließlich KfW 40.
- Der globale Provisionstext wird im strukturierten OpenImmo-Feld
  `courtage_hinweis` ausgegeben. Das strukturierte Feld
  `provisionspflichtig=false` bleibt unverändert.
- Der globale Empfehlungstext wurde wortgleich auf die freigegebene Fassung
  aktualisiert. Provision und Empfehlung werden beim Export unabhängig von
  älteren gespeicherten Fassungen aus der zentralen Standardquelle aufgelöst.
- Das reguläre Energieausweisfeld bleibt leer. A++ wird weiterhin nur als
  projektierter Planungswert im getrennten Freitextfeld übertragen.
- Heizungsart, Bodenbelag, Anmerkung, AGB, Objekttextlogik,
  Zuhause-Darlehen-Absatz und CTA wurden nicht geändert.

## Begründung

Die Portalwerte werden an einer zentralen Stelle normalisiert und unmittelbar
in die vorgesehenen OpenImmo-Felder geschrieben. Dadurch gelten dieselben
Regeln für neue, regenerierte und bestehende Inserate, ohne einzelne Objekte
manuell zu verändern. Die Modellzuordnung verwendet die bereits vorhandene
Living-Haus-Modellerkennung und eine explizite Allowlist; weitere Häuser werden
nicht als Bungalow abgeleitet.

## Hürden und Risiken

- Der frühere Export verwendete für mehrere OpenImmo-Felder eine nicht zum
  Schema passende Element- oder Attributform. Empfänger konnten diese Werte
  daher ignorieren, obwohl das Paket technisch angenommen wurde.
- `provisionspflichtig=false` und ein erläuternder `courtage_hinweis` werden
  bewusst gemeinsam übertragen: Der Hinweis grenzt die Grundstücksprovision
  von der provisionsfreien Hausplanung/Bauträgerleistung ab.
- Eine erfolgreiche FTPS-Übertragung bestätigt nur die Dateiübertragung. Die
  tatsächliche Darstellung in Immoprofessional wird gemäß Auftrag nach dem
  Canary-Upload ausschließlich durch den Nutzer geprüft.
