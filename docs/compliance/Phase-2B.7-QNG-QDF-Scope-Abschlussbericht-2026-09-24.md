# Phase 2B.7 – QNG-/QDF-Scope und finale EmpCo-Textbereinigung

Stand: 24. September 2026

## Ergebnis

Die lokale, CAS-gesicherte Phase-2B.7-Migration ist abgeschlossen. Der finale zentrale Claim-Scan umfasst 44 aktive Inserate und ergibt `BLOCK = 0`, `REVIEW = 0`. Es wurden keine Uploads, FTPS- oder Portalaktionen ausgelöst und kein Merge nach `main` vorgenommen.

## Faktenmodell

### DGNB

| Attribut | Modellierung |
| --- | --- |
| Fact-Key | `certification` |
| Fact-Wert | `DGNB-Serienzertifizierung` |
| Source | `verified_series` |
| Scope | `house_series` |
| Status | `verified` |
| Evidenz | `Verifizierte Living-Haus-Serienfreigabe: DGNB` |
| Zulässige Formulierung | `Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.` |

Die Richtlinie akzeptiert eine DGNB-Gold-, -Silber- oder -Platin-Aussage nur noch, wenn der passende strukturierte Fakt die jeweilige Stufe ausdrücklich enthält. Ein konkretes Objektzertifikat wird aus einem Serienfakt nicht abgeleitet.

### QNG

Es existiert im aktiven Katalog kein hinreichend präziser, verifizierter QNG-Serien-, Projektierungs- oder Objektfakt. Der bisherige implizite Fact `QNG-Serienmerkmal` wurde deshalb aus den zentral vererbten Living-Haus-Serienfakten entfernt und nicht durch eine neue werbliche Aussage ersetzt.

Die Policy unterstützt künftig den engen Fact-Key `qng_project_basis`, ausschließlich mit `verified_series` und `house_series`. Eine zulässige Aussage wäre nur bei einem künftigen, vollständig belegten Fakt: `Für die Hausserie ist eine verifizierte QNG-Projektierungsgrundlage dokumentiert.` Dies behauptet kein bereits erteiltes QNG des konkreten Gebäudes.

### QDF

Die Policy unterstützt QDF ausschließlich als Herstellerinformation mit `manufacturer_quality`, `verified_manufacturer`, Scope `manufacturer`, eindeutiger `manufacturerId`, `status = verified`, `verified = true` und einer konkreten Evidenzreferenz. Zulässig wäre dann nur eine Herstellerformulierung wie: `Der Hersteller erfüllt die Qualitätsanforderungen der Qualitätsgemeinschaft Deutscher Fertigbau (QDF).`

Im aktiven Katalog fehlten sowohl die verifizierte Herstellerzuordnung als auch eine konkrete Evidenzreferenz. Deshalb wurde kein QDF-Fakt persistiert und kein QDF-Text ausgegeben. Eine QDF-Zertifizierung des konkreten Hauses bleibt blockiert.

## Migration

| Freigegebene Änderung | Anzahl |
| --- | ---: |
| Entfernte QNG-Sätze in Objektbeschreibungen | 44 |
| Entfernte QNG-Titelfragmente | 8 |
| Entfernte unbelegte A++-Klauseln | 3 |
| Entfernte direkte I-KON-Kurz-Dubletten | 4 |
| Minimal ersetzter Zertifizierungssatz in `30460-4` | 1 |

Die acht QNG-Titelfragmente waren zusätzliche historische Treffer. Ihre exakte Entfernung war erforderlich, damit der verpflichtende finale Vollscan `BLOCK = 0` erreicht, ohne einen QNG-Claim umzudeuten oder neuen Werbetext zu erzeugen.

`30460-4` wurde ausschließlich in seinem Zertifizierungsteil ersetzt:

> Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen und digitale Hausbauakte. Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.

Damit bleiben die Leistungsangaben erhalten; Gold und QDF wurden mangels passender strukturierter Evidenz entfernt.

## Finalscan und Datenintegrität

| Prüfung | Ergebnis |
| --- | --- |
| Aktive Inserate | 44 |
| Betroffene Felder nach Migration | 0 |
| BLOCK | 0 |
| REVIEW | 0 |
| Zweiter Migrationslauf | 0 Änderungen, idempotent |
| Geänderte Zustandsfelder | 44 Objektbeschreibungen, 8 Überschriften |
| Unerwartete Zustandsänderungen | 0 |
| Upload-, Archiv-, Snapshot- oder Historienänderungen | 0 |

Vor der Migration bestand der ältere Phase-2B.6-Stand aus einem einzelnen fachlich zu prüfenden Rest-BLOCK. Die präzisierte Phase-2B.7-Policy klassifizierte zusätzlich 52 QNG- und 3 Zertifizierungstreffer (`BLOCK = 55`), bevor die exakt freigegebene Bereinigung ausgeführt wurde. Das ist eine strengere Erkennung desselben Textbestands, keine zusätzliche Datenmutation.

Das neue separate Backup ist byteidentisch zum Ausgangsmanifest und wiederherstellbar:

| Wert | SHA-256 |
| --- | --- |
| Ausgangsmanifest / Backup | `728e5331733c9f813a4c4cfb9726e175f11ee4e2b78322fea58879ef04793ab4` |
| Persistiertes Manifest | `31f8b76dc7b353b73308ff42ad6ad6d73ea25d45438be19f20e341595141244a` |

Backup: `phase2b-qng-qdf-scope-backups/manifest.pre-phase2b-qng-qdf-scope-2026-09-24T17-14-54.886Z.json`.

## Technische Verifikation

| Prüfung | Ergebnis |
| --- | --- |
| Node.js | `v24.19.0` |
| pnpm | `11.9.0` |
| Lockfile | unverändert (`439aa9d2de9804bc6ddd0ab4d4aea7ecd0215e005cd292199db3af0ad77d656c`) |
| Vollständige Testsuite inklusive Produktions-Build | PASS: 583 bestanden, 0 fehlgeschlagen, 1 Windows-spezifisch übersprungen |
| ESLint | PASS: 0 Fehler, 0 Warnungen |
| Phase-2B.7- und zentrale Policy-Tests | PASS |

## Implementierungsreport

Die zentrale Claim-Policy trennt nun DGNB-Serieninformation, QNG-Projektierungsgrundlage und QDF-Herstellerqualität in Faktenquelle, Scope und zulässiger Formulierung. Die neue Phase-2B.7-Migration ist deterministisch, setzt vor jeder Persistenz einen byteidentischen Backup-Punkt, prüft den genauen Scope per Compare-and-Swap und verweigert jede Erweiterung über die freigegebenen Textsegmente hinaus.

Das wesentliche Risiko lag in historischen QNG-Formulierungen, deren Kennzeichencharakter nicht durch präzise strukturierte Evidenz gedeckt war. Die sichere Lösung entfernt diese Aussagen, statt eine Aussage über eine Zertifizierung, ein Siegel oder ein nachhaltiges Gebäude zu erfinden. QDF wird bewusst nicht nachmodelliert, solange Herstellerzuordnung und Nachweis fehlen.

Kein Merge nach `main`, keine Uploads und keine Portalaktion wurden durchgeführt.
