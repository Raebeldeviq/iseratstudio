# Zwei-USP-Titelarchitektur – Implementierungsbericht

## Kurzreport

Automatisch erzeugte Inserattitel folgen jetzt einer festen, deterministischen
Struktur:

```
[emotionaler Einstieg] in [Ort]: [Wohnfläche] m², [Zimmer] Zimmer – [USP 1] & [USP 2]
```

Der Einstieg wird ausschließlich aus einem zentralen, sachlich unbedenklichen
Pool gewählt. Ort, Wohnfläche und Zimmer stammen ausschließlich aus Projekt-
und Hausdaten. Die USPs werden nur dann ausgegeben, wenn je USP ein passender,
strukturierter und freigegebener Fakt vorhanden ist.

Aktuell freigegebene Titel-USPs:

| Priorität | USP | Faktenbasis |
| --- | --- | --- |
| 1 | `QNG-Siegel garantiert` | `qng_guarantee`, `verified_series`, Projekt-Scope, Status `guaranteed` |
| 2 | `DGNB-Serienzertifizierung` | verifizierter Living-Haus-Serienfakt |
| 3 | `I-KON-Technikpaket` | verifizierter Paketfakt beim exakten I-KON-Paketmarker |

Die Paar-Auswahl verwendet stabile Hashes und gewichtete, nicht redundante
Kombinationen: QNG + DGNB, QNG + I-KON sowie DGNB + I-KON. Der I-KON-Claim
wird durch einen eigenen Paketfakt belegt; Wärmepumpe oder einzelne
Paketkomponenten werden deshalb nicht zusätzlich als redundanter Titel-USP
verwendet.

Die Read-only-Vorschau berichtet pro aktivem Inserat bisherigen Titel,
vorgeschlagenen Titel, Einstieg, beide USPs mit Evidenz, Länge und
Claim-Validator-Ergebnis. Zusätzlich liefert sie die Verteilung aller drei
Variationsebenen. Sie ändert weder Katalog noch Inserate.

## Begründung

Die Titelarchitektur verbindet Wiedererkennbarkeit mit nachvollziehbarer
Variation. Die gewichtete Auswahl stellt die höher priorisierten Fakten
häufiger heraus, ohne den gesamten Bestand auf eine identische Kombination zu
reduzieren. Die Policy validiert QNG als garantierten zukünftigen Status,
DGNB ausschließlich als Serien-Zertifizierung und I-KON ausschließlich bei
verifiziertem Paketmarker.

Bei Überschreitung des 220-Zeichen-Limits wählt die Logik zuerst einen kürzeren
Einstieg und entfernt erst danach den niedriger priorisierten zweiten USP. Es
werden keine Wörter oder Claims abgeschnitten.

## Hürden und Risiken

- Eine QNG-Garantie ist keine individuelle Objektzertifizierung. Der Titel
  bleibt bei `QNG-Siegel garantiert`; `QNG-zertifiziert` bleibt blockiert.
- Der I-KON-Paketmarker ist kein Freibrief für freie Technikwerbung. Nur der
  zentral definierte Paket-USP ist im Titel zulässig und nur mit passendem
  Paketfakt.
- Festpreis, Bauherrenversicherung, Förderungen und 30-Jahre-Garantie werden
  nicht aus historischen Werbetexten abgeleitet. Ohne separat verifizierte
  Fakten verbleiben sie außerhalb des USP-Pools.
- Bestehende Inserattitel und Objektbeschreibungen werden durch diese Arbeit
  nicht migriert. Eine spätere Übernahme erfordert eine separate Freigabe.
