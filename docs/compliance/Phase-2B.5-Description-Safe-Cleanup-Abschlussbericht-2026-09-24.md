# Phase 2B.5 – Abschlussbericht deterministische Teilbereinigung

**Stand:** 24. September 2026
**Branch:** `fix/uwg-phase2b-description-safe-cleanup-20260924`
**Ausführung:** einmalig lokal, ohne KI, Upload, OpenImmo-Erzeugung, FTPS,
Portalaktion oder Änderung an `main`.

## Vorher / Nachher

| Kennzahl | Vorher | Nachher |
| --- | ---: | ---: |
| Aktive Inserate | 44 | 44 |
| Betroffene Felder | 51 | 51 |
| BLOCK-Treffer gesamt | 288 | 119 |
| REVIEW-Treffer gesamt | 0 | 0 |
| Beschreibung-BLOCK-Treffer | 274 | 105 |
| Techniküberschrift-BLOCK-Treffer | 14 | 14 |
| I-KON-Umweltheadline | 40 | 0 |
| Effizienzhaus-/QNG-Baustein | 44 | 0 |
| Energieeffizienzklasse `A++` im freigegebenen Einzelfall | 1 | 0 |

Die Reduktion beträgt 169 Beschreibung-BLOCK-Treffer. Die verbleibenden 105
Beschreibungstreffer und 14 Techniküberschrift-Treffer sind ausschließlich
geschützte `HUMAN_DECISION`-Fälle.

## Durchgeführte Migration

| Freigegebene Behandlung | Segmente | Betroffene Beschreibungen | Umsetzung |
| --- | ---: | ---: | --- |
| `SAFE_REMOVE` | 40 | 40 | Exakte `I_KON_UMWELT_HEADLINE`-Zeile entfernt; nur angrenzende Leerzeilen minimal normalisiert. |
| `SAFE_FACT_REPLACEMENT` | 44 | 44 | Jeder Effizienzhaus-/QNG-Werbesatz durch die zentrale Serien-Sachinformation „Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt.“ ersetzt. |
| `SAFE_PARTIAL_REMOVE` | 1 | 1 | Die unbelegte Klasse `A++` entfernt; der verifizierte Hausvorlagen-Planungswert wird als zentrale, neutrale Endenergiebedarfsangabe ausgegeben. |

Es wurden genau 85 Segmente in 44 Objektbeschreibungsfeldern geändert. Jede
QNG-Ersetzung erforderte den passenden Serienfakt mit
`sourceKind=verified_series`, `scope=house_series`, `status=verified`,
`verified=true` und Evidenzreferenz. Der Energiekennwert erforderte den
strukturierten Projektierungswert der konkreten Hausvorlage. Es wurde keine
Marketingformulierung erzeugt.

## Backup und Datenintegrität

| Prüfpunkt | Ergebnis |
| --- | --- |
| Ausgangsmanifest | `/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/catalog-v2/manifest.json` |
| Separates Backup | `/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/phase2b-description-safe-cleanup-backups/manifest.pre-phase2b-description-safe-cleanup-2026-09-24T12-53-11.694Z.json` |
| Ausgangs-SHA-256 / Backup-SHA-256 | `e52b381f6d7ef1e2445331855771d22b4c51db96f9688c3640b03cf37aec6231` |
| Backup-Größe | 1.429.819 Bytes |
| Backup-Zeitpunkt | 2026-09-24T12:53:11.694Z |
| Wiederherstellbarkeit | verifiziert |
| Finales Manifest | SHA-256 `4bd86fa9c7b951c20f9531d2ce37ea657e3ac7d2536880500fe68a8d74170499`, 1.427.487 Bytes, `savedAt` 2026-09-24T12:53:11.694Z |
| Idempotenz | zweiter Lauf: 0 Änderungen |

Vor und nach dem Speichern wurde der vollständige Katalog verglichen. Nach
Rücksetzen der 44 geplanten Beschreibungsfelder auf ihren Vorzustand ist der
Katalog byte- und strukturgleich. Die 51 geschützten Satzsegmente wurden über
exakten Text und Hash geprüft. Dadurch sind weder Überschriften noch sonstige
Felder, Inserate, Häuser, Projekte, Bilder, Archive oder Uploaddaten verändert
worden. Die bestehende Pending-Sicherung vom 22. September wurde nicht
angefasst; die Phase-2B.5-Persistenz hinterließ keine neue Pending-Sicherung.

## Verbleibende HUMAN_DECISION-Gruppen

| Gruppe | Vorkommen / Inserate | BLOCK | Vorhandene Daten | Fehlende Evidenz und notwendige Entscheidung |
| --- | ---: | ---: | --- | --- |
| `I_KON_TECHNIK_BAUSTEIN` | 44 / 44 | 88 | Keine für Photovoltaik, Batteriespeicher und die Gesamtaussage ausreichenden freigegebenen Fakten. | Fachlich entscheiden: Passage löschen oder ausschließlich mit objektbezogenen, verifizierten Technikfakten neu freigeben. |
| `HEIZUNG_LUEFTUNG_BAUSTEIN` | 6 / 4 | 16 | Lediglich historische Heizungsangaben; keine ausreichende strukturierte Lüftungs-Evidenz. | Objektbezogene Planungs-/Vertragsnachweise für Wärmepumpe und Komfortlüftung bereitstellen oder Passagen entfernen. |
| `ZERTIFIZIERUNG_BAUSTEIN` | 1 / 1 | 1 | DGNB-Serienfakt vorhanden, aber kein Nachweis für die weitergehende Gold-/QDF-/Leistungsbeschreibung im gemeinsamen Satz. | Zertifizierung und Leistungsumfang fachlich trennen und je Aussage belegbar freigeben. |
| Techniküberschriften | 7 / 7 | 14 | Keine ausreichende strukturierte Evidenz für Wärmepumpe und Komfortlüftung. | Pro Inserat eine belastbare Evidenz liefern oder die Überschrift nach separater Freigabe ändern. |

Alle genannten Gruppen blieben vollständig unverändert.

## Technische Verifikation

- Neue isolierte Migrationstests: erfolgreich.
- Vollständige Testsuite: **574 bestanden**, **1 plattformbedingt übersprungen**, **0 Fehler**.
- ESLint: erfolgreich.
- Produktions-Build: erfolgreich.
- Finaler Read-only-Scan: 119 BLOCK, 0 REVIEW; der Rest-Scope besteht nur aus
  den drei obigen Beschreibungclustern und den sieben unveränderten
  Techniküberschriften.

## Abschluss

Phase 2B.5 ist abgeschlossen. Keine HUMAN_DECISION-Passage, keine
Techniküberschrift und kein nicht freigegebenes Feld wurde verändert. Es gab
keinen Upload, keine Portalaktion und keinen Merge nach `main`. Phase 2B.6
wurde nicht begonnen.
