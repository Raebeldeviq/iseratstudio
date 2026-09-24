# Phase 2A – Abnahmebericht: EmpCo-/UWG-sichere Inserattexte

Stand: 23. September 2026
Branch: `fix/uwg-safe-listing-copy-20260923`

## Nachtrag Phase 2A – Serienmerkmale und Projektierungsdaten

### Kurzreport: umgesetzt

- Das Faktenmodell unterscheidet nun die Quellen `project`, `house_template`, `verified_series`, `optional_package`, `legacy_default` und `unknown`. Die maschinenlesbare Klassifikation liegt in `sourceKind`; `source` kann weiterhin die konkrete Nachweisbezeichnung tragen.
- DGNB-Serienzertifizierung und QNG-Serienmerkmal sind als explizit verifizierte Living-Haus-Serienfakten hinterlegt. Sie werden ausschließlich vererbt, wenn der aufrufende Kontext die Serie `livinghaus` bestätigt; ein beliebiger Hersteller- oder Legacy-Default reicht nicht aus.
- Der feste Endenergiebedarf der konkreten Hausvorlage wird als `house_template`-Fakt mit Status `planned` und `evidenceKind: projected_house_value` ausgegeben. Er wird immer als Planungswert formuliert, nie als bereits ausgestellter Energieausweis.
- Ein später hinterlegter, verifizierter Energieausweis (`evidenceKind: energy_certificate`) hat pro Energiekennzahl Vorrang vor dem Planungswert und wird als Energieausweis in Text und OpenImmo ausgegeben.
- Die historische Energieklasse wurde nicht automatisch freigegeben: Im Codebestand standen die voneinander abweichenden Defaults `A++` und `A+`, jedoch keine belastbare Projektierungs- oder Energieausweisquelle. Eine Klasse erscheint daher erst mit einem strukturierten Hausvorlagen- oder Energieausweisfakt.
- KI, deterministischer Generator, Rotationspfad und OpenImmo nutzen dieselbe zentrale Faktlogik. Die KI erhält die vererbten Serienfakten und den Planungswert; der endgültige Ausstattungsblock fügt die freigegebenen, neutralen Sätze zentral hinzu.

### Begründung des Ansatzes

Die Vererbung erfolgt bewusst nur über die Kombination aus verifiziertem Serienfakt und bestätigter Serienzugehörigkeit. Damit bleiben sachliche Serieninformationen nutzbar, ohne Herstellerwerbung oder Altdaten zu Objektfakten aufzuwerten. Die getrennten Energiearten verhindern zugleich, dass ein noch zu errichtendes Haus einen individuellen Energieausweis vortäuscht.

### Hürden und verbleibende Risiken

- DGNB/QNG dürfen ausschließlich als Serienmerkmal formuliert werden; sie tragen keine pauschalen Nachhaltigkeits-, Klima-, Effizienz- oder Kostenaussagen.
- Für die Energieklasse liegt im Repository keine maßgebliche fachliche Quelle vor. Bis zur strukturierten Hinterlegung bleibt sie absichtlich unterdrückt; dies ist eine Schutzmaßnahme, keine automatische Bereinigung.
- OpenImmo besitzt kein eindeutiges Feld für einen reinen Projektierungswert. Der Planwert wird deshalb als klar bezeichneter Freitext exportiert, während ausschließlich echte Energieausweisdaten in `<energiepass>` gelangen.

## Geändert

- `listing-claim-policy.mjs` ist die neue zentrale Claim-Policy. Sie klassifiziert allgemeine Umweltclaims, Scope-Überdehnungen, Zertifizierungen und Nachhaltigkeitssiegel, zukünftige Umweltleistungen, Klima-/CO₂-Claims, konkrete technische Tatsachen sowie Kosten- und Leistungsversprechen.
- Die Policy verwendet strukturierte Fakten mit `value`, `source`, `sourceKind`, `scope`, `status`, `verified`, `evidenceKind` sowie optionaler Nachweisreferenz. Legacy-Felder werden nicht zu Fakten; der fachlich bestätigte Projektierungswert der konkreten Hausvorlage und passende verifizierte Serienfakten sind eng begrenzte Ausnahmen.
- `listing-copy.mjs` erzeugt nur noch sachliche Standardtexte. Allgemeine Umwelt-, Nachhaltigkeits-, Kosten- und Leistungsversprechen sowie QNG-/DGNB-Headline-Vorteile wurden entfernt. Manuelle Texte bleiben unverändert; die Policy meldet statt sie still zu verändern.
- Der deterministische Generator, die KI-Quelle und der KI-Systemprompt verwenden nur freigegebene strukturierte Fakten. Verifizierte Serienfakten werden ausschließlich mit ihrer Serienreichweite weitergereicht.
- KI- und lokale Bildtexte werden vor Speicherung validiert. Für automatische Listingtexte führt ein BLOCK zu einem kontrollierten sachlichen Fallback.
- `buildOpenImmoXml` ist die finale, gemeinsame Exportbarriere für XML, ZIP, Download, Batch und FTPS. Ein BLOCK verhindert die Paketbildung. Der Creative-Payload-Guard verwendet dieselbe Policy erneut.
- OpenImmo-Technikmetadaten werden nicht aus globalen Defaults erzeugt. Projektierte Energiekennwerte erscheinen dort nur als Planungswert gekennzeichneter Freitext; `<energiepass>` wird ausschließlich aus einem verifizierten Energieausweis befüllt.
- Der Typ `ListingComplianceFact` dokumentiert das neue Faktenmodell ohne bestehende Katalogdaten zu migrieren.

## Alte Ursache

Die bisherigen Texte kombinierten globale Standardwerte, Hausserieninformationen und feste Werbetexte. Dadurch wurden unter anderem Wärmepumpe, PV, Effizienzstandard, QNG und DGNB als Eigenschaften des konkreten Angebots behandelt und anschließend zu Nachhaltigkeits-, Effizienz-, Kosten- oder Wertversprechen ausgeweitet. Die gleichen statischen Blöcke wurden beim Generieren, Normalisieren und Export wieder eingesetzt.

## Neue Architektur

```text
strukturierte Fakten + Quelle + Scope + Status + Evidenzart
  → verifizierte Serienvererbung bzw. Hausvorlagen-Planungswert
  → Generator / KI
  → enforceListingCopy
  → zentraler Claim-Validator
  → Speicherung neuer Generierungen
  → finaler Claim-Validator
  → OpenImmo-XML / ZIP / Download / Upload
```

Der Validator liefert für jeden Befund Feld, Textausschnitt, Position, Kategorie, Grund, Evidenzlage und Severity (`BLOCK` oder `REVIEW`). Manuelle Freitexte werden nicht umgeschrieben; ein BLOCK erscheint erst bei einer Export- oder Generierungsentscheidung.

## Testbericht

| Input / Weg | Erwartung | Ergebnis |
| --- | --- | --- |
| Nachhaltiges, energieeffizientes, klimafreundliches Haus | `GENERIC_ENVIRONMENTAL_CLAIM` / BLOCK | PASS |
| Dauerhaft niedrige Energiekosten, ideal gedämmt | `UNVERIFIED_PERFORMANCE_OR_COST_CLAIM` / BLOCK | PASS |
| Klimaneutral, CO₂-neutral | `GHG_OR_OFFSET_CLAIM` / BLOCK | PASS |
| PV-Fakt → „nachhaltiges Eigenheim“ | Scope- und Generic-Block | PASS |
| Wärmepumpen-Fakt → „Haus ist energieeffizient“ | Scope- und Generic-Block | PASS |
| Luft-Wasser-Wärmepumpe ohne / mit Evidenz | BLOCK / zulässige technische Aussage | PASS |
| `planned` bzw. `optional` | Nur mit ausdrücklichem Statuswort bzw. keine Bestandsbehauptung | PASS |
| DGNB-/QNG-Serienfakt + Living-Haus-Serienkontext | Sachliche Serienaussage zulässig | PASS |
| DGNB-/QNG-Text ohne passende Serienzugehörigkeit bzw. als individuelles Objektzertifikat | BLOCK | PASS |
| bestätigte serielle Technik | Sachliche technische Aussage zulässig | PASS |
| Projektierter Endenergiebedarf | Zulässiger Planungswert, kein Energieausweis | PASS |
| Späterer Energieausweis | Vorrang vor Planungswert; `<energiepass>` wird nur daraus erzeugt | PASS |
| Kein Planungswert und kein Energieausweis | Keine Energiekennzahl | PASS |
| Historische Energieklasse A++ / A+ | Ohne belastbaren strukturierten Fakt nicht freigegeben | PASS |
| KI, deterministischer Fallback, Rotation | zentral validiert vor Speicherung | PASS |
| manuelle Freitexte und Bildunterschriften | unverändert, aber beim Export validiert | PASS |
| OpenImmo XML, ZIP/Download, Batch/FTPS | gleiche finale Barriere | PASS |

Ausgeführt nach dem Nachtrag:

- `node --test --test-reporter=dot tests/*.test.mjs` – vollständig erfolgreich.
- `node_modules/.bin/eslint . --ignore-pattern dist --ignore-pattern .next` – ohne Befund.
- `node_modules/.bin/vinext build` – Produktions-Build erfolgreich.

## Keine Produktivdaten geändert

Es wurden keine aktiven Inserate, macOS-Katalogdaten, IndexedDB-Daten, Pending-Snapshots, Resetarchive, Sicherungsstände oder Upload-Historien migriert, bereinigt oder überschrieben. Die Änderung betrifft ausschließlich Quellcode, Tests und diese Dokumentation.

## Noch offen für Phase 2B+

- Read-only-Bestandsklassifizierung ist über `phase2b-claim-scan.mjs` und `phase2b-claim-scan-cli.mjs` vorbereitet. Sie verwendet dieselbe zentrale Claim-Policy und besitzt keinen Speicher-, Upload- oder Textgenerierungspfad.
- Batch-Bereinigung der 44 aktiven Inserate und historischer Snapshots.
- Weitergehende Nachweisreferenzen/Dokumentenverwaltung für QNG und DGNB sowie vollständige Evidenzmodelle für PV, Speicher, Lüftung, U-Werte und weitere technische Merkmale.
- Bewusste Freigabe konkret spezifizierter allgemeiner Umweltclaims mit Darstellung auf demselben Medium.
- Prüfung visueller Umweltclaims und Nachhaltigkeitssiegel innerhalb der Bildinhalte.
