# QNG-Garantie – Implementierungsbericht

## Kurzreport

Der Feature-Branch modelliert die verifizierte Living-Haus-QNG-Leistung als
zukünftigen, projektbezogenen Garantiezustand. Der zentrale Fakt lautet:

| Feld | Wert |
| --- | --- |
| Key | `qng_guarantee` |
| Source kind | `verified_series` |
| Source scope | `house_series` |
| Project scope | `project` |
| Status | `guaranteed` |
| Evidence kind | `qng_series_guarantee` |

Er wird nur bei der bestätigten Serie `livinghaus` an ein projektiertes Haus
vererbt. Die Textausgabe ist zentral festgelegt:

- Titel: `QNG-Siegel garantiert`
- Objektbeschreibung: `Für dieses projektierte Haus ist das QNG-Siegel serienmäßig garantiert.`

Die Policy trennt diesen Zustand von `planning_certificate` und `certified`.
Eine QNG-Garantie erlaubt weder `QNG-zertifiziert` noch allgemeine Umwelt-,
Klima-, Nachhaltigkeits-, Effizienz- oder Kostenbehauptungen.

Der OpenImmo-Export übernimmt die zentrale Aussage ausschließlich als
Freitext, sofern sie im Inseratstext vorhanden ist. Es wird kein XML-Feld für
eine bereits abgeschlossene individuelle Zertifizierung gesetzt.

Die neue Vorschau `qng-guaranteed-status-preview` ist rein lesend. Sie plant
Titel- und Beschreibungsergänzungen, verhindert Dubletten und markiert
abweichende bestehende QNG-Formulierungen für einen manuellen Review. Sie
persistiert keine Inserate oder Katalogdaten.

## Begründung

Die Garantie ist eine belastbare Serienleistung mit Wirkung für das konkrete
projektierte Haus, aber kein Nachweis eines bereits ausgestellten individuellen
Zertifikats. Deshalb wird sie mit Herkunft `house_series`, Ziel-Scope `project`
und Status `guaranteed` modelliert. Die zentrale Formulierung verhindert freie
Varianten und hält den zeitlichen sowie sachlichen Geltungsbereich transparent.

## Hürden und Risiken

- QNG als Siegel darf nicht in eine individuelle Zertifizierung oder eine
  allgemeine Umweltwirkung umgedeutet werden. Die Policy blockiert diese
  Ableitungen ausdrücklich.
- Eine bestehende Energieklassen-Prüfung war zu breit und konnte beliebige
  Texte mit Buchstaben `A` bis `G` als Energieklasse einstufen. Sie prüft nun
  ausschließlich vollständige Klassenwerte (`A` bis `A+++` oder `B` bis `G`).
- Bereits vorhandene abweichende QNG-Texte werden von der Read-only-Vorschau
  nicht überschrieben. Sie bleiben ein separater manueller Entscheidungsfall.
- Die 44 aktiven Inserate werden durch diesen Branch nicht verändert. Eine
  spätere Migration benötigt weiterhin einen gesonderten Auftrag.
