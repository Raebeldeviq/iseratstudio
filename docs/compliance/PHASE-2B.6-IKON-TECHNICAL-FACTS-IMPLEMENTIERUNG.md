# Phase 2B.6 – I-KON-Technikfakten: Implementierung

**Stand:** 24. September 2026  
**Branch:** `fix/uwg-phase2b-ikon-technical-facts-20260924`

## Kurzreport

Die zentrale Claim-Policy enthält jetzt vier voneinander unabhängige,
verifizierte Fakten für das technische Living-Haus-/I-KON-Paket:
Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage. Der neue
Scope `technical_package` bindet diese Fakten ausschließlich an den expliziten
Hausvorlagenmarker `livinghaus-ikon-standard`.

Die Phase-2B.6-Migration prüft den freigegebenen Bestand vollständig, erstellt
ein separates, bytegleiches Backup und ersetzt nur exakte, zuvor geprüfte
Techniksegmente. Sie setzt 18 Paketmarker, ersetzt I-KON- und
Heizung/Lüftungs-Segmente durch zentrale Sachinformationen und ändert in sieben
Überschriften ausschließlich `Wärmepumpe und Komfortlüftung` zu
`Wärmepumpe und Lüftungsanlage`. Der Zertifizierungssatz ist ausdrücklich
geschützt und bleibt ein `HUMAN_DECISION`-Fall.

## Fachliche Modellierung

| Fact-Key | sourceKind | Scope | Status | Nachweis | Freigegebene technische Bezeichnung |
| --- | --- | --- | --- | --- | --- |
| `photovoltaic` | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Photovoltaikanlage | Photovoltaikanlage |
| `battery_storage` | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Batteriespeicher | Batteriespeicher |
| `heat_pump` | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Wärmepumpe | Wärmepumpe |
| `ventilation` | `optional_package` | `technical_package` | `verified` | Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Lüftungsanlage | Lüftungsanlage |

`optional_package` ist der bereits vorhandene maschinenlesbare Pakettyp. Er
bedeutet hier nicht, dass der Text eine optionale Ausstattung behauptet: Die
Fakten werden nur bei der konkret gesetzten Paketkennung geerbt und selbst mit
`status=verified` und `verified=true` gespeichert.

## Technischer Ansatz

- Die zentrale Policy normalisiert Paketkennungen intern und verwirft
  paketbezogene deklarierte Fakten, wenn ihr Marker nicht zum Hauskontext passt.
- Die Textfunktion erzeugt nur zwei deterministische Sätze aus den tatsächlich
  angeforderten Fakten: den Vier-Komponenten-Satz und den Satz für Wärmepumpe
  und Lüftungsanlage.
- Eine strengere Textprüfung verhindert, dass der generische Lüftungsfakt eine
  `Komfortlüftung` oder der generische Wärmepumpenfakt eine
  `Luft-Wasser-Wärmepumpe` freigibt.
- Die Migration arbeitet mit präzisen Text-/Hash-Vorbedingungen, einer
  CAS-gesicherten Katalogpersistenz, Integritätsvergleich und einem zweiten,
  idempotenten Lauf.
- Neue oder importierte Hausvorlagen erhalten keinen Paketmarker automatisch.
  Eine spätere Nutzung setzt eine separate fachliche Verifikation des konkreten
  Paketbezugs voraus.

## Begründung

Ein technischer Paket-Scope ist fachlich präziser als ein künstlicher
Serien-Scope: Die Freigabe gilt nicht global für Living Haus und nicht für eine
beliebige Hausvorlage. Die getrennten Fakten verhindern zugleich, dass einzelne
Komponenten zu einer pauschalen Umwelt-, Kosten- oder Effizienzaussage
zusammengezogen werden.

## Hürden und Schutzmaßnahmen

- Die bestehenden aktiven Vorlagen hatten nur den allgemeinen
  `useStandardPackage`-Marker. Die Migration akzeptiert deshalb ausschließlich
  die exakt 18 in den 44 aktiven I-KON-Kontexten verwendeten Vorlagen und
  schreibt keinen Marker an Fremdhäuser.
- Ein unveränderter QNG-Seriensatz wurde in der Nachvalidierung zunächst ohne
  Serienkontext geprüft. Die Prüfung verwendet nun denselben Living-Haus-
  Serienkontext wie der zentrale Scanner; daraus entsteht keine neue
  Textfreigabe.
- Der gemischte DGNB-/QDF-/Leistungsumfangssatz bleibt unverändert, weil sein
  Gold-, QDF- und Leistungsumfangsteil nicht einzeln strukturiert belegt ist.

## Tests

Die neuen Tests decken Faktenvererbung, Fremdhaus-Sperre, unabhängige Fakten,
exakte Technikbezeichnungen, fehlende Umweltfreigabe, Titel-Scope,
Integrität, Backup-Wiederherstellbarkeit und Idempotenz ab. Zusätzlich läuft
der reale Vorher-/Nachher-Scan mit den freigegebenen Bestandszahlen fail-closed.
