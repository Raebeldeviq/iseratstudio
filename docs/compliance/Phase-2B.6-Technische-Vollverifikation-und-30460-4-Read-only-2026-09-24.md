# Phase 2B.6 – Technische Vollverifikation und Read-only-Prüfung 30460-4

**Stand:** 24. September 2026  
**Branch:** `fix/uwg-phase2b-ikon-technical-facts-20260924`  
**Modus:** ausschließlich Toolchain-Verifikation und Read-only-Analyse. Es
wurden keine Katalog-, Inserat-, Paketmarker-, Text-, Archiv-, Snapshot- oder
Uploaddaten geändert.

## Technische Verifikation

| Prüfpunkt | Ergebnis |
| --- | --- |
| Projektvorgabe Node | `>=22.13.0` (`package.json`) |
| Verwendete Node-Version | `v24.19.0` aus der Codex-Projektlaufzeit |
| Projektvorgabe pnpm | `11.9.0` (`packageManager`) |
| Verwendete pnpm-Version | `11.9.0`, über Corepack ohne Projektdateiänderung wiederhergestellt |
| Lockfile | unverändert, `lockfileVersion: '9.0'` |
| Dependency-, Build-, Lint- oder Toolchain-Änderung im Phase-2B.6-Diff | keine |
| Phase-2B.6-Tests unter Node 24 | PASS, 4/4 |
| zentrale Claim-Policy-Tests unter Node 24 | PASS, 14/14 |
| Produktions-Build | FAIL außerhalb von Phase 2B.6: `react/jsx-runtime` liefert für Vinext keinen Export `jsx` |
| vollständige Testsuite | FAIL in ihrem ersten, vorgeschalteten Build-Schritt aus demselben Grund |
| ESLint | FAIL außerhalb von Phase 2B.6: `ERR_INVALID_PACKAGE_CONFIG` in der vorhandenen ESLint-Paketinstallation |

Der Produktions-Build und ESLint wurden mit derselben Node-24-Laufzeit im
unveränderten, lockfile-identischen Referenzarbeitsstand wiederholt. Beide
Fehler sind dort bytegleich reproduzierbar. Sie werden daher weder aus den
Phase-2B.6-Änderungen abgeleitet noch innerhalb dieses Auftrags repariert.

Gegenüber Phase 2B.5 enthält der Branch ausschließlich die I-KON-
Technikfakten, Paket-/Scope-Modellierung, Migration, Tests und Dokumentation.
`package.json`, `pnpm-lock.yaml`, ESLint-, TypeScript- und Build-Konfiguration
sind unverändert. `main` bleibt unverändert.

## Phase-2B.6-Stand

| Kennzahl | Wert |
| --- | ---: |
| BLOCK vor Phase 2B.6 | 119 |
| BLOCK aktuell | 1 |
| aktive Inserate | 44 |
| I-KON-Technik | 0 |
| Heizung/Lüftung | 0 |
| Techniküberschriften | 0 |
| neue Mutation in diesem Nachauftrag | 0 |

## 30460-4 – vollständiger Kontext

**Vorhergehender Absatz:**

> Für die digitale Organisation des Bauprojekts steht das Living Haus
> Bau-Cockpit für Termine, Unterlagen und Kommunikation zur Verfügung. Das
> I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe
> und Lüftungsanlage. Das I-KON-Technikpaket umfasst Wärmepumpe und
> Lüftungsanlage. Der geplante Energiebedarf liegt bei 18 kWh pro Quadratmeter
> und Jahr; die geplante Energieeffizienzklasse ist A++. Für die zugehörige
> Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt. Die
> Energiekennwerte werden abschließend gemäß konkreter Planung und Energieausweis
> bestimmt.

**Problematischer Satz:**

> Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem
> Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung,
> Bauversicherungen, digitale Hausbauakte sowie DGNB-Serienzertifizierung in
> Gold und QDF-Zertifizierung.

Der vollständige Absatz enthält danach nur noch Garantie-/Vertragsbedingungen;
es folgt kein weiterer Absatz.

## Teilclaims und Evidenz

| Teilclaim | Strukturierte Evidenz | Bewertung |
| --- | --- | --- |
| DGNB-Serienzertifizierung | Zentraler Serienfakt: `verified_series`, `house_series`, `verified`, Wert `DGNB-Serienzertifizierung`, Evidenzreferenz `Verifizierte Living-Haus-Serienfreigabe: DGNB` | als allgemeine Serienaussage gedeckt |
| Zusatz „in Gold“ | keine; der Fact-Wert enthält ausdrücklich keine Gold-Stufe | nicht gedeckt |
| QDF-Zertifizierung | keine strukturierte Serien-, Produkt-, Haus- oder Projektinformation | nicht gedeckt |
| Bauantragsplanung | keine strukturierte Evidenz | historischer Freitext |
| Bodengutachten | keine strukturierte Evidenz | historischer Freitext |
| zwei Tage Ausstattungsberatung | keine strukturierte Evidenz | historischer Freitext |
| Bauversicherungen | keine strukturierte Evidenz | historischer Freitext |
| digitale Hausbauakte | keine strukturierte Evidenz | historischer Freitext |

Am Inserat, der Hausvorlage und dem Projekt sind keine deklarierten
`listingFacts` oder `complianceFacts` hinterlegt. Der gesamte Katalog enthält
keinen strukturierten QDF-, DGNB-Gold- oder gleichwertigen Fakt. Historischer
Freitext und die bloße Bezugnahme auf eine Leistungsbeschreibung wurden nicht
als Evidenz gewertet.

Die frühere Zertifizierungsbereinigung behandelt `DGNB-Gold` bereits explizit
als nicht freigegebene Bezeichnung und ersetzt sie nur durch
`DGNB-Serienzertifizierung`. Gold ist daher bewusst nicht modelliert. Dass der
aktuelle Scanner nur einen Zertifizierungs-BLOCK ausweist, ist keine Evidenz für
die Gold-Stufe: Die vorliegende Prüfung bewertet ihre faktische Deckung
unabhängig davon.

## Entscheidungsvorschlag – nicht ausgeführt

**Empfohlene Maßnahmeklasse:** `SAFE_SENTENCE_REPLACEMENT`

Der ganze gemischte Satz kann ausschließlich durch die bereits zentrale,
deterministische Serien-Sachinformation ersetzt werden. Damit bleibt nur der
belegte Serienfakt erhalten; Gold, QDF und die nicht strukturierten
Leistungsangaben werden nicht übernommen.

| Vorher | Spätere, separat zu genehmigende Fassung |
| --- | --- |
| Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen, digitale Hausbauakte sowie DGNB-Serienzertifizierung in Gold und QDF-Zertifizierung. | Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung. |

Dieser Vorschlag ist nicht persistiert. Die Produktdaten, 30460-4, `main` und
alle Uploadwege bleiben unverändert.
