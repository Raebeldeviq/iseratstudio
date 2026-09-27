# Luna 6, USP-Textlogik und Überschriften – Prüfnachweis

## Implementierung und Begründung

- Die günstige OpenAI-Empfehlung nutzt den verifizierten Modell-Identifier `gpt-6-luna`. UI, lokale Credential-Normalisierung und beide Responses-API-Wege lesen dieselbe Modellliste; Reasoning- und Temperaturparameter wurden nicht verändert. `gpt-5.6-terra` und `gpt-5.6-sol` bleiben verfügbar.
- Die vom Nutzer benannte `living-haus-checkliste.pdf` (zwei Seiten) wurde als Inventar der bestehenden zentralen Claim-Policy zugeordnet: A = belegbarer Living-Haus-Serienfakt, B = Ausstattung/Konfiguration nötig, C = konkrete Projekt-/Förder-Evidenz nötig, D = nicht für Titel. Die Titelwahl verwendet ausschließlich daraus freigegebene Fakten mit Quelle und Scope. Die Checkliste allein aktiviert keinen projektbezogenen Claim.
- Der Ausstattungsstandard verwendet belegte Angaben zu Festpreisgarantie, Bauversicherungen, Bau-/Planungsleistung, Bau-Cockpit, Zuhause-Paket und HausStatterei. Der bisherige pauschale Einstieg „Hausbau auf einem neuen Level“ entfällt. Das exakt erkannte alte Standardsystemfeld wird beim Lesen gegen die neue Version aufgelöst; als manuell markierter Text bleibt unverändert.
- Die neue Überschrift kombiniert einen variierenden emotionalen Einstieg mit Ort bzw. Hausdaten und höchstens einem freigegebenen USP. QNG-Garantieformulierungen werden nicht mehr in neuen Titeln ausgewählt. Die bestehende Policy und die OpenImmo-Fail-Closed-Prüfung bleiben bestehen.

## USP-Grenzen

| Kategorie | Beispiele | Freigabegrenze |
| --- | --- | --- |
| A | 18 Monate Festpreisgarantie, Bauversicherungen, Bau-Cockpit, HausStatterei, Architektenleistung, 30 Jahre Garantie auf das definierte tragende Holzrahmenwerk, DGNB-Serienzertifizierung | Nur mit freigegebenem Living-Haus-Serienfakt und dokumentierter Quelle; keine Ausweitung auf das individuelle Objekt. |
| B | I-KON, Luft-Wärmepumpe, Komfortlüftung, Zuhause-Paket, bodengleiche Duschen, Küche, Rollläden, Bodenplatte/Keller, Gründung und Baustelleneinrichtung | Nur mit passender Haus-, Paket- oder Vertragskonfiguration; „DGNB Gold“ bleibt wegen zusätzlicher Anforderungen nicht pauschal titelfähig. |
| C | KFN-förderfähig, QNG-förderfähig | Nur mit individueller Projekt-/Förder-Evidenz; keine Finanzierungs- oder Zertifizierungszusage. |
| D | Zuhause-Darlehen, QDF-Herstellerzertifizierung, gesetzliche Gewährleistung | Nicht als automatisch zugewiesener Titel-USP; individuelle Beratung und Scope bleiben erforderlich. |

Der Katalog enthält 26 spezifische Einträge, darunter alle 25 angeforderten Checklistenpunkte plus die gesonderte, engere DGNB-Serienzertifizierung ohne Gold-Behauptung. Die `titleEligible`-Markierung ist keine alleinige Freigabe: Die bestehende Faktprüfung muss ebenfalls bestehen.

## Zehn read-only Beispieltitel

Aus zehn unterschiedlichen Haustypen des lokalen Katalogs am Standort Berlin-Zehlendorf deterministisch generiert. Kein Katalogeintrag wurde gespeichert, keine Anzeige übertragen. `BLOCK` und `REVIEW` stammen jeweils aus `validateListingClaims` für den erzeugten Titel. Hauskürzel werden nur hier zur Zuordnung genannt, nicht im Titel.

| Haus | Titel | USP | Evidenz | BLOCK | REVIEW |
| --- | --- | --- | --- | ---: | ---: |
| SUN 126 V2 | Ein Zuhause für große Pläne in Berlin-Zehlendorf: 126 m², 4 Zimmer – Bauversicherungen inklusive | Bauversicherungen | Checkliste S. 1; freigegebener Serienfakt `included_building_services` | 0 | 0 |
| SUN 130 V2 | 4 Zimmer für euer Leben in Berlin-Zehlendorf: Raum für das, was zählt – Bauversicherungen inklusive | Bauversicherungen | Checkliste S. 1; freigegebener Serienfakt `included_building_services` | 0 | 0 |
| SUN 136 V4 | 4 Zimmer für euer Leben in Berlin-Zehlendorf: Platz für euer Familienleben – 30 Jahre Garantie auf die tragende Holzkonstruktion | Begrenzte Konstruktionsgarantie | Checkliste S. 1; Serienfakt `structural_guarantee` | 0 | 0 |
| SUN 142 V2 | Ankommen in Berlin-Zehlendorf: 142 m² für euren nächsten Schritt – 18 Monate Festpreisgarantie | Festpreisgarantie | Checkliste S. 1; Serienfakt `fixed_price_guarantee` | 0 | 0 |
| SUN 143 V4 | Berlin-Zehlendorf ruft: Wohnen nach euren Vorstellungen mit 143 m² – DGNB-Serienzertifizierung | DGNB im Serien-Scope | Checkliste S. 1 und bestehende Serienfreigabe `certification` | 0 | 0 |
| SUN 144 V4 Tag | Raum für das, was zählt in Berlin-Zehlendorf: 144 m², 5 Zimmer – 30 Jahre Garantie auf die tragende Holzkonstruktion | Begrenzte Konstruktionsgarantie | Checkliste S. 1; Serienfakt `structural_guarantee` | 0 | 0 |
| SUN 151 V8 | Wohnen nach euren Vorstellungen: 152 m² in Berlin-Zehlendorf – DGNB-Serienzertifizierung | DGNB im Serien-Scope | Checkliste S. 1 und bestehende Serienfreigabe `certification` | 0 | 0 |
| SUN 154 V3 | 153 m² für große Pläne: 5 Zimmer in Berlin-Zehlendorf – 30 Jahre Garantie auf die tragende Holzkonstruktion | Begrenzte Konstruktionsgarantie | Checkliste S. 1; Serienfakt `structural_guarantee` | 0 | 0 |
| SUN 157 V2 | Berlin-Zehlendorf ruft: Hier beginnt euer nächstes Kapitel mit 153 m² – Bau-Cockpit-App | Bau-Cockpit | Checkliste S. 1; Serienfakt `bau_cockpit` | 0 | 0 |
| SUN 164 V2 | Ankommen in Berlin-Zehlendorf: 164 m² für euren nächsten Schritt – 18 Monate Festpreisgarantie | Festpreisgarantie | Checkliste S. 1; Serienfakt `fixed_price_guarantee` | 0 | 0 |

## Grenzen und Risiken

- Eine Hersteller-Checkliste belegt keine individuelle Förderfähigkeit. Deshalb bleibt `QNG-förderfähig` ohne Projektbeleg in Titeln aus; `QNG-Siegel garantiert` wird für neue Titel nicht verwendet.
- Der ältere QNG-Garantie-Fakt und historische manuelle Texte bleiben für den bestehenden Datenbestand unverändert. Eine Änderung dieser Alt-Policy oder eine Bestandsmigration ist nicht Teil dieses Releases.
- Auch ein BLOCK-/REVIEW-freier Testtitel ersetzt keine Sichtprüfung der tatsächlich generierten Anzeigen nach dem Modellwechsel. Es gab keinen Live-API-Aufruf, keinen Massenlauf und keinen Portal-Upload.
