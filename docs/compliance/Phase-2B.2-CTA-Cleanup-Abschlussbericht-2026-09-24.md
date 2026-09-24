# Phase 2B.2 – Abschlussbericht CTA-Bereinigung

Stand: 24. September 2026, 12:12 Uhr (Europe/Berlin)

## Auftrag und Scope

Aus dem geprüften Phase-2B.1-Stand `8f371e8` wurde auf dem isolierten Branch
`fix/uwg-phase2b-cta-cleanup-20260924` ausschließlich der historisch feste,
terminale CTA aus 44 aktiven Objektbeschreibungen entfernt. Es wurde kein Text
generiert, umformuliert oder hochgeladen.

Die Vorab-Sperre war erfüllt: 69 MANUAL_REVIEW-Felder, 350 BLOCK-Treffer,
44 bytegenaue terminale CTA-Kandidaten und 25 echte manuelle Überschriften.
Die 44 Kandidaten und die 44 tatsächlichen State-Differenzen stimmen exakt
überein.

Betroffene externe Inserate: `30460-1` bis `30460-40` sowie `30460-46` bis
`30460-49`. In jedem dieser 44 Datensätze wurde ausschließlich das Feld
`Objektbeschreibung` am terminalen CTA gekürzt.

## Vorher / Nachher

| Kennzahl | vor Phase 2B.2 | nach Phase 2B.2 |
| --- | ---: | ---: |
| Aktive Inserate | 44 | 44 |
| Betroffene Inserate | 44 | 44 |
| Betroffene Felder | 69 | 69 |
| Claim-Treffer | 350 | 306 |
| BLOCK | 350 | 306 |
| REVIEW | 0 | 0 |
| CTA-Kandidaten | 44 | 0 |
| MANUAL_REVIEW-Felder | 69 | 69 |
| davon Objektbeschreibung | 44 | 44 |
| davon Überschrift, echte manuelle Prüfung | 25 | 25 |
| SAFE_DETERMINISTIC_REPLACEMENT | 0 | 0 |

Die 44 Beschreibungen bleiben im Scan als MANUAL_REVIEW sichtbar, weil sie
unabhängige Restbefunde enthalten. Das war für Phase 2B.2 zulässig: Nur der
identische historische CTA war freigegeben; kein weiterer Claim wurde verändert.

## Migration, Backup und Integrität

- Backup: `/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/phase2b-cta-cleanup-backups/manifest.pre-phase2b-cta-cleanup-2026-09-24T12-10-00.000Z.json`
- Erzeugt: `2026-09-24T12:10:00.000Z`
- Ausgangskatalog- und Backup-Hash (SHA-256): `aeffc5ff477a56067a1f8003f116f5a2b2cdf0c68055c3e3134500e419931c89`
- Backup-Größe: 1.439.703 Bytes; lesbar und als Katalogmanifest wiederherstellbar.
- Finaler Katalog-Hash (SHA-256): `fee02782c9f5741075e910889989ab156c6af95469991af261053c678e6e7784`
- Persistierter Katalogzeitpunkt: `2026-09-24T12:10:00.000Z`
- Nach Rückeinsetzen genau der 44 zuvor gesicherten Beschreibungen ist der
  vollständige Katalogzustand strukturgleich mit dem Backup.
- Die 25 geschützten MANUAL_REVIEW-Überschriften wurden vor/nach per Text und
  SHA-256 verglichen: 25 von 25 unverändert. Zusätzlich blieben alle 44
  Überschriften unverändert.
- Die 44 Phase-2B.1-Ausstattungsfelder sind weiter im freigegebenen Zustand.
- Kein Pending-Snapshot blieb zurück. Archive, Bilder, Preise, Grundstücks- und
  Hausdaten, IDs, Reihenfolgen, Energie-/DGNB-/QNG-Fakten und Upload-Historien
  gehören zur strukturgleichen Prüfung und wurden nicht verändert.
- Zweiter Lauf: 0 Änderungen, idempotent.

## Technische Abnahme

- Vollständige Testsuite: 566 bestanden, 0 fehlgeschlagen, 1 plattformbedingter Test übersprungen.
- ESLint: fehlerfrei.
- Produktions-Build: erfolgreich.
- Die Migrationsroutine enthält keinen Generator-, Upload-, FTPS-, OpenImmo- oder Portalpfad.

## Read-only-Entscheidungstabelle: 25 echte MANUAL_REVIEW-Felder

Alle folgenden Datensätze wurden nur gelesen. „Vollständiger relevanter Absatz"
ist hier die vollständige Überschrift. Es wurde keine der vorgeschlagenen
Maßnahmen ausgeführt.

### Zertifizierung: REPLACE_WITH_FACT nach Scope-Freigabe (10)

Vorhandene technische Sachinformation: verifizierte Living-Haus-Serienfreigabe
für DGNB. Sie erlaubt nicht die Objektbehauptung „DGNB-Gold". Eine spätere
Ersetzung darf deshalb ausschließlich eine freigegebene, serienbezogene
Sachinformation ohne Gold- oder Objektversprechen verwenden.

| Externe ID | Interne ID | Feld / vollständiger relevanter Absatz | Problematische Passage | Kategorie / BLOCK | Empfohlene Maßnahme |
| --- | --- | --- | --- | --- | --- |
| 30460-46 | 10cf6bad-d842-484b-9dc3-d1c434320878 | Überschrift: Dein sicheres Zuhause in Berlin-Zehlendorf: 230 m², 7 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-49 | afd0beea-f465-4b22-99fc-83ee7f74c24d | Überschrift: Dein zukunftsstarkes Zuhause in Berlin-Zehlendorf: 110 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-2 | f9e96fd4-6141-40ce-994a-1f94174f42ab | Überschrift: Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-4 | 33cd334e-e0e4-4ce2-8218-fe6a8d48484f | Überschrift: Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 153 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-5 | 0ec2a5ae-0452-4a0a-b43f-b51b39169cc9 | Überschrift: Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 107 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-8 | 8aef3218-5ab6-411a-8890-2e067314b9b5 | Überschrift: Dein sicheres Zuhause in Kloster Lehnin-Damsdorf: 131 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-13 | efcff8ba-ddc4-4749-9460-8f9d682bcef7 | Überschrift: Dein sicheres Zuhause in Potsdam-Drewitz: 165 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-20 | b5ba5079-0620-4e29-ba6a-4f679f57724a | Überschrift: Dein sicheres Zuhause in Potsdam-Stern: 135 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-25 | b472b538-dc4b-4fd8-a0cd-b07d7eccef39 | Überschrift: Dein sicheres Zuhause in Neustadt: 106 m², 4 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |
| 30460-35 | 579bc711-7b7b-4190-8bbc-ee02f672b436 | Überschrift: Dein sicheres Zuhause in Wenzlow: 164 m², 5 Zimmer, DGNB-Gold und 30 Jahre Garantie! | DGNB-Gold | UNVERIFIED_CERTIFICATION / 1 | REPLACE_WITH_FACT |

Problemgrund für alle zehn Fälle: Zertifizierung, Serienfreigabe,
Planungsstatus und konkretes Objekt dürfen nicht gleichgesetzt werden.

### Nachhaltigkeitskennzeichen: REPLACE_WITH_FACT nach Scope-Freigabe (8)

Vorhandene technische Sachinformation: verifizierte Living-Haus-Serienfreigabe
für QNG. Die Überschriften behaupten jedoch QNG-Potenzial für das konkrete
Objekt. Eine spätere Ersetzung muss den Serien- und Objekt-Scope trennen.

| Externe ID | Interne ID | Feld / vollständiger relevanter Absatz | Problematische Passage | Kategorie / BLOCK | Empfohlene Maßnahme |
| --- | --- | --- | --- | --- | --- |
| 30460-3 | 398047b3-2999-4031-879c-dbd65a1f62c3 | Überschrift: Dein zukunftsstarkes Zuhause in Kloster Lehnin-Damsdorf: 144 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-14 | eb42390a-bb2d-47d4-8eeb-3a8cf5132e75 | Überschrift: Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 101 m², 3 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-15 | a3db2f52-abf6-41c7-95e5-d5757230fce4 | Überschrift: Dein zukunftsstarkes Zuhause in Potsdam-Drewitz: 153 m², 6 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-23 | 41553b5b-6c9b-46b7-b247-23aa9df1c079 | Überschrift: Dein zukunftsstarkes Zuhause in Werder (Havel), Phöben: 167 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-26 | 20f515b3-da8c-405a-b19e-8db96754c4be | Überschrift: Dein zukunftsstarkes Zuhause in Neustadt: 142 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-27 | 3d5cd235-6d00-46d9-87a3-87d32faf40bf | Überschrift: Dein zukunftsstarkes Zuhause in Neustadt: 164 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-29 | 8a8bea5b-5c8c-48f8-a8ca-ac1874a82215 | Überschrift: Dein sicheres Zuhause in Werder: 167 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |
| 30460-38 | e6a79bd9-64aa-41ea-9b0f-7834d8644382 | Überschrift: Dein zukunftsstarkes Zuhause in Groß Glienicke: 164 m², 5 Zimmer, QNG-Potenzial und 18 Monate Festpreis! | QNG-Potenzial | UNVERIFIED_SUSTAINABILITY_LABEL / 1 | REPLACE_WITH_FACT |

Problemgrund für alle acht Fälle: Das Nachhaltigkeitskennzeichen ist nicht mit
passendem Objekt-, Projekt- oder Serien-Scope in der verwendeten Objektform
belegt.

### Technische Angaben: HUMAN_DECISION (7)

Für diese sieben Überschriften sind keine passenden verifizierten technischen
Fakten hinterlegt. Eine sachliche Ersatzformulierung wäre erst nach einer
objektbezogenen technischen Freigabe zulässig; ersatzloses Kürzen oder eine
Umschreibung wird in Phase 2B.2 nicht vorgenommen.

| Externe ID | Interne ID | Feld / vollständiger relevanter Absatz | Problematische Passage | Kategorie / BLOCK | Empfohlene Maßnahme |
| --- | --- | --- | --- | --- | --- |
| 30460-1 | f8eedb6a-431b-45da-bff1-220cd65db915 | Überschrift: Dein planbares Familienzuhause in Kloster Lehnin-Damsdorf: 142 m², 5 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-30 | f302d88c-e48b-4092-93d1-dfd0d401e6d6 | Überschrift: Dein neues Zuhause mit Sicherheit in Werder: 143 m², 5 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-31 | 7e32e4f6-9dcf-44c0-9bef-578ba24029f3 | Überschrift: Dein neues Zuhause mit Sicherheit in Werder: 101 m², 3 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-32 | 497be308-caa2-4cf8-8dd8-daded2ff2a65 | Überschrift: Dein neues Zuhause mit Sicherheit in Werder: 153 m², 6 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-36 | 8a6651a2-ccec-4f23-8925-243167db1ea1 | Überschrift: Dein neues Zuhause mit Sicherheit in Wenzlow: 167 m², 5 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-37 | 3b5488a4-ea70-4da5-adea-d3b86743db6f | Überschrift: Dein neues Zuhause mit Sicherheit in Groß Glienicke: 126 m², 4 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |
| 30460-39 | 57dc87ab-aea5-4160-bfab-5323ae863a99 | Überschrift: Dein neues Zuhause mit Sicherheit in Groß Glienicke: 135 m², 4 Zimmer, Wärmepumpe und Komfortlüftung! | Wärmepumpe; Komfortlüftung | UNVERIFIED_TECHNICAL_CLAIM / 2 | HUMAN_DECISION |

## Nicht verwendete Maßnahmeklassen

- REMOVE_SENTENCE: 0. Keine vollständige Aussage konnte ohne Informations- oder
  Gestaltungsentscheidung als entbehrlich bestätigt werden.
- REWRITE_PARAGRAPH: 0. Eine Neufassung ist nicht Teil dieser Phase und wurde
  nicht vorbereitet.

## Stopp

Die 25 Einzelentscheidungen bleiben read-only. Es wurden keine Uploads, keine
Portalaktionen und keine Phase-2B-Nachbereinigung begonnen. Der Branch wird
nicht nach `main` gemergt.
