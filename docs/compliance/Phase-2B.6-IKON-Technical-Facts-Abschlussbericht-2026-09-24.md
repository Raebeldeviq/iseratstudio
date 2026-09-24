# Phase 2B.6 – Abschlussbericht technische Serien-/Paketfakten

**Stand:** 24. September 2026  
**Branch:** `fix/uwg-phase2b-ikon-technical-facts-20260924`  
**Ausführung:** einmalig lokal, deterministisch, ohne KI, Upload,
OpenImmo-Erzeugung, FTPS- oder Portalaktion und ohne Änderung an `main`.

## Neue technische Fakten

| Fact | sourceKind | Scope | Status | Evidenz | Verwendbarer Text |
| --- | --- | --- | --- | --- | --- |
| Photovoltaik | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Photovoltaikanlage | Photovoltaikanlage |
| Batteriespeicher | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Batteriespeicher | Batteriespeicher |
| Wärmepumpe | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Wärmepumpe | Wärmepumpe |
| Lüftungsanlage | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Lüftungsanlage | Lüftungsanlage |

Die Fakten gelten ausschließlich für Hausvorlagen mit dem expliziten
I-KON-Paketmarker. Sie erlauben keine Umwelt-, Kosten-, Verbrauchs- oder
Effizienzbehauptung. Insbesondere ist weder `Komfortlüftung` noch
`Luft-Wasser-Wärmepumpe` aus dem generischen Fakt ableitbar.

## Vorher / Nachher

| Kennzahl | Vorher | Nachher |
| --- | ---: | ---: |
| Aktive Inserate | 44 | 44 |
| BLOCK gesamt | 119 | 1 |
| REVIEW | 0 | 0 |
| I-KON-Technik | 88 | 0 |
| Heizung/Lüftung | 16 | 0 |
| Techniküberschriften | 14 | 0 |
| Zertifizierung | 1 | 1 |

Durchgeführt wurden 18 Paketmarker, 50 Satzersetzungen in 44
Objektbeschreibungen und sieben minimale Überschriftenersetzungen. Die
eingesetzten Sätze sind ausschließlich:

- `Das I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage.`
- `Das I-KON-Technikpaket umfasst Wärmepumpe und Lüftungsanlage.`

## Backup und Datenintegrität

| Prüfpunkt | Ergebnis |
| --- | --- |
| Ausgangsmanifest / Backup-SHA-256 | `4bd86fa9c7b951c20f9531d2ce37ea657e3ac7d2536880500fe68a8d74170499` |
| Separates Backup | `/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/phase2b-ikon-technical-facts-backups/manifest.pre-phase2b-ikon-technical-facts-2026-09-24T15-12-21.021Z.json` |
| Backup-Größe | 1.427.487 Bytes |
| Backup-Wiederherstellbarkeit | verifiziert |
| Finales Manifest | SHA-256 `728e5331733c9f813a4c4cfb9726e175f11ee4e2b78322fea58879ef04793ab4`; `savedAt` 2026-09-24T15:12:21.021Z |
| Integritätsvergleich | nur die 18 Paketmarker sowie die freigegebenen Beschreibungs- und Überschriftenfelder verändert |
| Idempotenz | zweiter Lauf: 0 Änderungen |
| Bestehende Pending-Datei | unverändert: `manifest.549250bc-4e7e-4bff-8bd8-f38410fcf9fa.pending.json` |

Die Migration ruft keine Upload-, Archiv-, Snapshot-Migrations-,
OpenImmo- oder Portalroutine auf. Der vollständige Zustandsvergleich bestätigt,
dass außerhalb der freigegebenen Paketmarker, Beschreibungen und Überschriften
keine Katalog-, Inserat-, Haus-, Projekt-, Bild- oder sonstigen Daten verändert
wurden.

## Offener Fall

| Inserat | Feld | BLOCK | Behandlung |
| --- | --- | --- | --- |
| 30460-4 | Objektbeschreibung | `UNVERIFIED_CERTIFICATION` | Der unveränderte gemeinsame Satz enthält DGNB Gold, QDF und weitere Leistungsangaben. Ohne getrennte, strukturierte Evidenz bleibt er `HUMAN_DECISION`. |

## Verifikation

- Die neuen Phase-2B.6-Tests: **4/4 bestanden**.
- Zentrale Claim-Policy-Tests: **14/14 bestanden**.
- Realer Vorher-/Nachher-Scan, Backup-Prüfung, Persistenzprüfung und
  Idempotenzprüfung: **bestanden**.
- Vollständige Testsuite, ESLint und Produktions-Build wurden gestartet, können
  in der aktuellen lokalen Node-22.22.3-Laufzeit jedoch nicht als grün bestätigt
  werden: vorhandene Drittmodule (`jszip` und `graceful-fs`) brechen schon beim
  Laden mit inkompatiblen Paketexporten ab; ESLint meldet eine ungültige
  vorhandene Paketkonfiguration, und der Build beendet sich in dieser Umgebung
  ohne Ergebnis. Diese Fehler liegen außerhalb der Phase-2B.6-Quelldateien.

## Abschluss

Phase 2B.6 ist fachlich und datenintegritätsseitig abgeschlossen. Es erfolgte
kein Merge nach `main`, kein Upload und keine weitere Phase-2B-Bereinigung.
Der verbleibende Zertifizierungsfall wird nicht automatisiert verändert.
