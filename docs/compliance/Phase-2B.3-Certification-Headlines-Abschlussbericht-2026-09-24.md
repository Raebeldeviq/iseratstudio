# Phase 2B.3 – Abschlussbericht DGNB-/QNG-Überschriften

Stand: 24. September 2026, Ausführung 12:45 UTC

## Scope und Ergebnis

Auf dem isolierten Branch `fix/uwg-phase2b-certification-headlines-20260924`
wurden ausschließlich 18 vorhandene Überschriften minimal verändert:

- 10-mal `DGNB-Gold` → `DGNB-Serienzertifizierung`
- 8-mal `QNG-Potenzial` → `QNG-Serienmerkmal`

Die Ersatzwerte sind exakt die bereits im zentralen Faktenmodell hinterlegten
Living-Haus-Serienfaktwerte. Für jede vollständige resultierende Überschrift
bestätigte die Phase-2A-Policy den Faktenkontext `verified_series`,
`house_series`, `verified` und die zugehörige Evidenzreferenz.

## Migration

- Backup: `/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/phase2b-certification-headline-cleanup-backups/manifest.pre-phase2b-certification-headline-cleanup-2026-09-24T12-45-00.000Z.json`
- Ausgangskatalog- und Backup-Hash (SHA-256): `fee02782c9f5741075e910889989ab156c6af95469991af261053c678e6e7784`
- Backup-Größe: 1.429.627 Bytes; lesbar und als Katalogmanifest wiederherstellbar.
- Finaler Katalog-Hash (SHA-256): `e52b381f6d7ef1e2445331855771d22b4c51db96f9688c3640b03cf37aec6231`
- Persistierter Katalogzeitpunkt: `2026-09-24T12:45:00.000Z`
- Exakt 18 Überschriften geändert. Nach Rückeinsetzen dieser 18
  Ausgangsüberschriften ist der vollständige Katalogzustand strukturgleich mit
  dem Backup.
- Zweiter Lauf: 0 Änderungen, idempotent.

## DGNB: 10 Überschriften

Faktenkontext aller zehn Ersetzungen: `certification`, Wert
`DGNB-Serienzertifizierung`, `sourceKind=verified_series`,
`scope=house_series`, `status=verified`, Evidenz „Verifizierte
Living-Haus-Serienfreigabe: DGNB“. Die Ersetzung behauptet kein individuelles
Objektzertifikat und keine Gold-Zertifizierung.

| Externe ID | Vorher | Nachher |
| --- | --- | --- |
| 30460-46 | Dein sicheres Zuhause in Berlin-Zehlendorf: 230 m², 7 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Berlin-Zehlendorf: 230 m², 7 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-49 | Dein zukunftsstarkes Zuhause in Berlin-Zehlendorf: 110 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein zukunftsstarkes Zuhause in Berlin-Zehlendorf: 110 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-2 | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-4 | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 153 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 153 m², 5 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-5 | Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 107 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 107 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-8 | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-13 | Dein sicheres Zuhause in Potsdam-Drewitz: 165 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Potsdam-Drewitz: 165 m², 5 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-20 | Dein sicheres Zuhause in Potsdam-Stern: 135 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Potsdam-Stern: 135 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-25 | Dein sicheres Zuhause in Neustadt: 106 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Neustadt: 106 m², 4 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |
| 30460-35 | Dein sicheres Zuhause in Wenzlow: 164 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | Dein sicheres Zuhause in Wenzlow: 164 m², 5 Zimmer, DGNB-Serienzertifizierung und 30 Jahre Garantie! |

## QNG: 8 Überschriften

Faktenkontext aller acht Ersetzungen: `sustainability_label`, Wert
`QNG-Serienmerkmal`, `sourceKind=verified_series`, `scope=house_series`,
`status=verified`, Evidenz „Verifizierte Living-Haus-Serienfreigabe: QNG“.
Die Ersetzung behauptet weder eine individuelle QNG-Zertifizierung noch eine
Förderzusage oder eine allgemeine Umweltwirkung.

| Externe ID | Vorher | Nachher |
| --- | --- | --- |
| 30460-3 | Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 144 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 144 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-14 | Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 101 m², 3 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 101 m², 3 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-15 | Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 153 m², 6 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 153 m², 6 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-23 | Dein zukunftsstarkes Zuhause in Werder (Havel), Phöben: 167 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Werder (Havel), Phöben: 167 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-26 | Dein zukunftsstarkes Zuhause in Neustadt: 142 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Neustadt: 142 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-27 | Dein zukunftsstarkes Zuhause in Neustadt: 164 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Neustadt: 164 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-29 | Dein sicheres Zuhause in Werder: 167 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein sicheres Zuhause in Werder: 167 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |
| 30460-38 | Dein zukunftsstarkes Zuhause in Groß Glienicke: 164 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | Dein zukunftsstarkes Zuhause in Groß Glienicke: 164 m², 5 Zimmer, QNG-Serienmerkmal und 18 Monate Festpreis! |

## Finalscan

| Kennzahl | vorher | nachher |
| --- | ---: | ---: |
| Aktive Inserate | 44 | 44 |
| Betroffene Felder | 69 | 51 |
| Claim-Treffer | 306 | 288 |
| BLOCK | 306 | 288 |
| REVIEW | 0 | 0 |
| MANUAL_REVIEW-Felder | 69 | 51 |
| DGNB-Problemüberschriften | 10 | 0 |
| QNG-Problemüberschriften | 8 | 0 |
| Technik-HUMAN_DECISION-Überschriften | 7 | 7 |
| Technik-Claim-Treffer | 14 | 14 |

Die 18 Zertifizierungs-/Kennzeichen-BLOCKs wurden beseitigt. Die verbleibenden
288 BLOCK-Treffer betreffen unveränderte individuelle Objektbeschreibungen und
die sieben Techniküberschriften.

## Read-only-Technikprüfung: Wärmepumpe und Komfortlüftung

Betroffene externe Inserate: `30460-1`, `30460-30`, `30460-31`, `30460-32`,
`30460-36`, `30460-37`, `30460-39`.

| Prüfpunkt | Ergebnis |
| --- | --- |
| Fachliche Quelle | Keine belastbare, strukturierte Quelle für Wärmepumpe oder Komfortlüftung vorhanden. |
| Hausvorlagen | Sieben Vorlagen führen das alte Freitext-Attribut „Fußbodenheizung mit Luft-Wasser-Wärmepumpe“; Komfortlüftung wird dort nicht technisch belegt. |
| Faktenmodell | Keine `listingFacts`/`complianceFacts` mit `key=heat_pump` oder `key=ventilation`; `collectListingFacts` liefert für beide Keys 0 Fakten. |
| Seriengültigkeit | Nein, nicht verifizierbar. Ein alter Vorlagen- oder globaler Defaulttext genügt ausdrücklich nicht. |
| Empfohlene Faktmodellierung | Derzeit keine Anlage eines Fakteneintrags. Erst nach belastbarem Seriennachweis: `sourceKind=verified_series`, `scope=house_series`, `status=verified`, `verified=true`, separate technische Bezeichnungen für Wärmepumpe und Lüftungsanlage sowie eine konkrete Evidenzreferenz. |
| Empfohlene spätere Überschriftenbehandlung | HUMAN_DECISION; keine Löschung, keine Ersetzung und keine automatische Migration bis zu einer separaten Freigabe. |

## Datenintegrität und Abnahme

- Die sieben Techniküberschriften wurden per Text und SHA-256 vor/nach geprüft:
  7 von 7 unverändert.
- Die 44 Phase-2B.1-Ausstattungsfelder bleiben im freigegebenen Zustand.
- Die 44 Phase-2B.2-CTA-Entfernungen bleiben bestehen; 0 historische CTA-Vorkommen.
- Keine anderen Textfelder, Preise, Flächen, Grundstücks-/Hausdaten, IDs, Bilder,
  Reihenfolgen, Energiekennwerte, Fakten, Archive, Snapshots oder Upload-Historien
  wurden verändert. Kein Pending-Snapshot verblieb.
- Vollständige Testsuite: 569 bestanden, 0 fehlgeschlagen, 1 plattformbedingter
  Test übersprungen.
- ESLint: fehlerfrei. Produktions-Build: erfolgreich.
- Keine Uploads, keine FTPS-/OpenImmo- oder Portalaktion.

## Stopp

Die sieben Technikfälle bleiben unverändert. Es wurde keine weitere
Textbereinigung, kein Upload, kein Merge nach `main` und keine Phase 2B.4
begonnen.
