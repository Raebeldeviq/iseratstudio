# Phase 2B.4 – Abschlussbericht Read-only-Analyse Objektbeschreibungen

**Stand:** 24. September 2026  
**Branch:** `audit/uwg-phase2b-description-analysis-20260924`  
**Arbeitsmodus:** ausschließlich read-only; keine Katalog-, Inserat-,
Snapshot-, Archiv-, Upload-, OpenImmo-, FTPS- oder Portalmutation.

## Bestand verifiziert

| Kennzahl | Ergebnis |
| --- | ---: |
| Aktive Inserate | 44 |
| Betroffene Felder gesamt | 51 |
| BLOCK-Treffer gesamt | 288 |
| Betroffene Objektbeschreibungen | 44 |
| BLOCK-Treffer in Objektbeschreibungen | 274 |
| Unveränderte Techniküberschriften | 7 |
| BLOCK-Treffer in Techniküberschriften | 14 |

Der Scanner bricht mit `PHASE2B_DESCRIPTION_AUDIT_SCOPE_MISMATCH` ab, wenn
eine dieser Sollzahlen abweicht.

## Satz- und Absatzanalyse

Alle 44 Beschreibungen wurden im Speicher entlang ihrer vorhandenen
Absatzstruktur in Überschriften und Sätze segmentiert. Jeder der 274
Beschreibungstreffer ist genau einem der 136 problematischen Segmente
zugeordnet. Der JSON-Modus des Analysewerkzeugs enthält je Segment die
Inserat-ID, externe ID, Absatznummer, den unveränderten Satztext,
Claim-Kategorien, BLOCK-Anzahl, Herkunftseinschätzung und Maßnahmenklasse.

`DETERMINISTISCHER_GENERATOR_INFERIERT` bedeutet ausschließlich eine aus
mindestens drei gleichartigen Vorkommen abgeleitete Wiederholung. Es ist kein
Nachweis einer gespeicherten historischen Quelle und wird deshalb nicht als
Freigabe für eine Mutation verwendet.

## Cluster

| Cluster | Segmente / Inserate | BLOCK | Claim-Kategorie bzw. Ursache | Beispiel | Empfohlene Behandlung |
| --- | ---: | ---: | --- | --- | --- |
| `EFFIZIENZHAUS_QNG_BAUSTEIN` | 44 / 44 | 128 | `MIXED` | „Das Haus ist als Effizienzhaus 40 QNG konzipiert und auf einen niedrigen Energieverbrauch ausgerichtet.“ | `SAFE_FACT_REPLACEMENT`: nur durch das verifizierte QNG-Serienmerkmal; ein projektierter Energiebedarf nur, wenn er im jeweiligen Faktenmodell strukturiert hinterlegt ist. |
| `I_KON_TECHNIK_BAUSTEIN` | 44 / 44 | 88 | `UNVERIFIED_TECHNICAL` | „Das Konzept verbindet eine moderne Gebäudehülle mit zeitgemäßer Haustechnik, Photovoltaikanlage und Batteriespeicher.“ | `HUMAN_DECISION`: konkrete Technik wird nirgends durch zulässige strukturierte Fakten vollständig belegt. |
| `I_KON_UMWELT_HEADLINE` | 40 / 40 | 40 | `GENERIC_ENVIRONMENTAL` | „Energieeffizientes I-KON-Konzept“ | `SAFE_REMOVE`: reine Umwelt-/Marketingüberschrift ohne Sachinformation. |
| `HEIZUNG_LUEFTUNG_BAUSTEIN` | 6 / 4 | 16 | `UNVERIFIED_TECHNICAL` | „Die geplante Fußbodenheizung mit Luft-Wasser-Wärmepumpe nutzt Umweltwärme und Strom.“ | `HUMAN_DECISION`: Wärmepumpe und Komfortlüftung sind nicht durch ausreichende strukturierte Nachweise abgedeckt. |
| `ENERGIEKENNWERT_BAUSTEIN` | 1 / 1 | 1 | `UNVERIFIED_TECHNICAL` | „Der geplante Energiebedarf liegt bei 18 kWh/(m²·a), die geplante Energieeffizienzklasse ist A++.“ | `SAFE_PARTIAL_REMOVE`: den verifizierten projektierten Energiebedarf beibehalten; die Energieeffizienzklasse abtrennen. |
| `ZERTIFIZIERUNG_BAUSTEIN` | 1 / 1 | 1 | `CERTIFICATION_SCOPE` | „… DGNB-Serienzertifizierung in Gold und QDF-Zertifizierung.“ | `HUMAN_DECISION`: Zertifizierungsangaben sind mit Leistungsangaben in einem Satz verbunden. |

Die vier häufigsten Bausteine erklären 272 der 274 Beschreibungstreffer. Die
beiden Einzelfälle erklären die restlichen zwei Treffer.

## Maßnahmenverteilung

| Maßnahme | Anzahl Sätze / Segmente |
| --- | ---: |
| `SAFE_REMOVE` | 40 |
| `SAFE_PARTIAL_REMOVE` | 1 |
| `SAFE_FACT_REPLACEMENT` | 44 |
| `REWRITE_SENTENCE` | 0 |
| `REWRITE_PARAGRAPH` | 0 |
| `HUMAN_DECISION` | 51 |

## Inseratverteilung

| Ergebnis | Anzahl Inserate |
| --- | ---: |
| `DETERMINISTICALLY_FIXABLE` | 0 |
| `PARTIAL_REWRITE_REQUIRED` | 0 |
| `HUMAN_DECISION_REQUIRED` | 44 |

Kein Feld ist insgesamt deterministisch freigabefähig, weil jede der 44
Beschreibungen mindestens eine nicht belegte Technikpassage enthält. Das ist
eine bewusst konservative Entscheidung: Die Wiederholung eines Altbausteins
belegt nicht dessen sachliche Unrichtigkeit, aber auch nicht seine Wahrheit.

## Sieben Techniküberschriften

Die sieben Überschriften mit insgesamt 14 BLOCK-Treffern wurden weder geändert
noch in die Beschreibungsmigration einbezogen. Sie betreffen Wärmepumpe und
Komfortlüftung. In den vorhandenen strukturierten Fakten steht dafür keine
ausreichende, objektbezogene Evidenz zur Verfügung. Status: vollständig
`HUMAN_DECISION`.

## Empfehlung für Phase 2B.5 – nur Plan, nicht ausgeführt

1. Vor jeder möglichen Migration dieselben sieben Bestandskennzahlen prüfen
   und bei jeder Abweichung abbrechen.
2. Nach separater Freigabe die 40 exakt erkannten
   `I_KON_UMWELT_HEADLINE`-Überschriften atomar und mit Vorher-Backup
   entfernen.
3. Nach separater Freigabe die 44
   `EFFIZIENZHAUS_QNG_BAUSTEIN`-Sätze ausschließlich durch eine neutrale,
   bereits freigegebene Aussage zum QNG-Serienmerkmal ersetzen. Projektierte
   Energiebedarfswerte dürfen nur fallbezogen aus dem strukturierten
   Faktenmodell ergänzt werden.
4. Die 44 I-KON-Technikpassagen, sechs Heizungs-/Lüftungspassagen und den
   Zertifizierungssatz erst nach fachlicher Entscheidung behandeln. Der eine
   Energiekennwertsatz kann danach isoliert geprüft und teilgekürzt werden.
5. Erst nach einem ausdrücklich beauftragten Migrationsschritt vollständige
   Regressionstests, Lint, Produktions-Build, unveränderte Snapshot-/Archiv-
   und Uploaddaten sowie Idempotenz nachweisen.

## Implementierung, Begründung, Risiken

Das neue Analysemodul arbeitet ohne Schreibpfad: Es nutzt die bestehende
Phase-2A-Policy und nur freigegebene strukturierte Fakten, normalisiert
wiederkehrende Sätze deterministisch und erzeugt weder Neutext noch
Produktdaten.

Die zentrale Hürde sind Altbausteine mit konkreten Technikversprechen. Sie
können zwar als wiederkehrend erkannt werden, aber aus der Wiederholung allein
folgt keine hinreichende strukturelle Evidenz. Deshalb bleiben sie bewusst bei
`HUMAN_DECISION`; Legacy-Defaults und alte Werbetexte wurden nicht verwendet.

## Abschluss

Phase 2B.4 ist abgeschlossen. Es wurde keine Objektbeschreibung und keine
Techniküberschrift geändert. Phase 2B.5 wurde nicht gestartet und es erfolgte
kein Merge nach `main`.
