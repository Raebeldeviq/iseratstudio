# Manuelle Bestandskorrektur – 11.10.2026

## Report

- Im bestehenden Inseratsmanager: „Bestand korrigieren“, Kennzeichnung „Nicht im Portal vorhanden / Duplikat“ und Rücknahme mit Bestätigung der Objektnummer.
- Sichtbarer Status „HISTORISCH / NICHT IM PORTAL“, Korrekturgrund, Zeitpunkt und vollständiger Korrekturverlauf. Suche nach Objektnummer bleibt verfügbar.
- Gesondertes Metadatum am Inserat; ursprünglicher Status, Objektnummer, Transferbelege, Uploadhistorie und gespeicherte Steuerung bleiben erhalten.
- Die Lösch-Ampel und die reguläre Batchbestätigung berücksichtigen ausschließlich nicht korrigierte Einträge. Korrekturen erzeugen keine Nachschubplätze und bestätigen keinen Poolabschluss.
- Historische Einträge sind für neue Uploads und Nummern-Neuplanung gesperrt. Rücknahme stellt die Berücksichtigung gemäß dem unveränderten ursprünglichen Status wieder her.
- Helfer speichert atomar mit Katalog- und Korrekturrevision. Normales Browser-Speichern darf die Korrektur weder erfinden noch überschreiben.
- Vorhandene Route `/delete-batches/confirm` in die Helfer-Routenfreigabe aufgenommen; ihr Handler war bereits vorhanden, aber über HTTP nicht erreichbar.

## Begründung

Ein separates, rücknehmbares Kennzeichen unterscheidet eine Bestandskorrektur von einer tatsächlichen Portallöschung. Die Batchdaten bleiben erhalten; ihre aktive Darstellung wird anhand von Projekt-ID, Inserats-ID und Objektnummer gefiltert. Dadurch erzeugt die Korrektur weder Löschbelege noch Guthaben für die Nachschubautomatik. Der gespeicherte Verlauf erklärt spätere Rücknahmen.

## Eindeutig freigegebener aktueller Fall

Grundstück: Fritz-Zubeil-Straße 23A, Potsdam-Babelsberg.
Projekt-ID: `6523f7e6-e835-4272-9ba9-ee5bd516ea95`.
Grundlage ist die ausdrückliche Bestandsangabe des Nutzers, keine automatisch abgeleitete Portalbestätigung.

| Objektnummer | Inserats-ID | Vorgesehene Bestandskorrektur |
| --- | --- | --- |
| 30460-003015 | 67d10191-0fa6-4ea4-9878-252d633866f4 | Historisch / nicht im Portal |
| 30460-003016 | f12e90fa-2694-4bb3-9f0a-1ab6ede2affc | Historisch / nicht im Portal |
| 30460-003017 | e8c0b31e-4341-4af0-b5f6-2812fa59f871 | Historisch / nicht im Portal |
| 30460-003018 | 8175cee8-21b5-4aa3-8501-36043669909a | Historisch / nicht im Portal |

Unverändert zu erhalten: `30460-002007`, `30460-003007`, `30460-004007`, `30460-005001`. Keine pauschale Bereinigung von Batch 002 oder Batch 003.

## Hürden und Risiken

- Alte Browserzustände dürfen die Korrektur nicht zurückschreiben. Serverseitige Revisionsprüfung und geschützte Korrekturmetadaten verhindern dies; bei Konflikten muss die Ansicht neu geladen werden.
- Eine korrigierte Position im aktuellen Poolzyklus zählt nicht als Portallöschung. Ein solcher Zyklus bleibt für die automatische Rotation gesperrt.
- Rücknahme nach einer zwischenzeitlichen regulären Batchbestätigung öffnet nur die zuvor korrigierten Positionen gemäß ihrem ursprünglichen Status. Bereits bestätigte Löschungen und ihre Plätze bleiben bestehen.
- Produktive Korrekturen erfolgen erst nach Sicherung des Katalogs und Prüfung aller acht Identitäten. Anschließend werden die vier realen Objekte, Uploadhistorie, Nachschubdaten und Grundstücke auf unveränderten Inhalt geprüft.
- Keine Portal-, FTPS- oder Uploadaktion gehört zur Korrektur.

## Verifikation

- Fokussierte Regressionen: 38 Tests zu Korrektur, Rücknahme, Batchbestätigung, Nachschub, Poolabschluss, Persistenz und UI-Darstellung.
- Exakter Fritz-Zubeil-Fall einschließlich Erhalt von Batch 002 als Regression abgedeckt.
- Gesamtsuite: 745 bestanden, 1 übersprungen, 0 fehlgeschlagen (746 insgesamt). ESLint und Produktions-Build erfolgreich.

## Ergänzung: acht ausdrücklich freigegebene Reset-Archiv-Einträge

Die Abschlussprüfung fand zusätzlich acht aktive Batchverweise auf das Reset-Archiv `411bfe23-8a0e-4c23-ac33-54ac4c6e1df7`. Der Nutzer hat ihre Bestandskorrektur gesondert freigegeben:

- `30460-001001`, `30460-001002`
- `30460-002001`, `30460-002002`
- `30460-003001`, `30460-003002`
- `30460-004001`, `30460-004002`

Die Korrekturaktion unterstützt deshalb zusätzlich die genaue Archiv-ID. Die Archiv-Inserate erhalten ausschließlich Korrekturmetadaten; ursprüngliche Inseratsdaten, Archivzeitpunkt und Batchbelege bleiben erhalten. Zugehörige Reset-Archive erscheinen im bestehenden Inseratsmanager und sind über die vorhandene Objektnummernsuche erreichbar. Die Korrektur ist dort rücknehmbar; normale Bearbeitungs- und Uploadaktionen bleiben für Reset-Archive gesperrt.

Zusätzliche Regression prüft Archivkorrektur, falsche Archiv-ID, Rücknahme, unveränderte Stammdaten und Ausschluss aus der Löschbestätigung ohne Nachschubgutschrift. Fokussierte Prüfung: 39 bestanden.

Abschlussprüfung der Ergänzung: Gesamtsuite 746 bestanden, 1 übersprungen, 0 fehlgeschlagen (747 insgesamt); ESLint und Produktions-Build erfolgreich. Bestehende Quelltext-Prüfungen des globalen Inseratsmanagers wurden auf die nun explizite gemeinsame Quelle aus aktuellen Inseraten und Reset-Archiven angepasst; die Grundstücksauswahl schränkt den Manager weiterhin nicht ein.
