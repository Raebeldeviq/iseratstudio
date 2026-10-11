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
