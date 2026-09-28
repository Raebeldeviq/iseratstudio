# Titel und Energiepfad – Arbeitsnachweis vom 28.09.2026

## Umsetzung

- Neue Überschriften enthalten Ort, gerundete Wohnfläche und Zimmerzahl. Ein auf den zuerst gewählten USP abgestimmter Einstieg übersetzt den belegten Aspekt in einen vorsichtigen Kundennutzen.
- Bis zu zwei verschiedene, durch `releasedTitleUsps` freigegebene Aspekte werden deterministisch aus dem bestehenden Faktbestand gewählt. Die bestehende Claim-Policy bleibt unverändert. Historische und manuell gepflegte Titel werden nicht automatisch überschrieben.
- Der OpenImmo-ZIP-Test prüft den vollständigen Energiepass bei verifizierten `energy_certificate`-Fakten und das Ausbleiben eines Energiepasses ohne diese Evidenz.

## Begründung

Die Titelwahl nutzt die vorhandenen ListingFacts und die zentrale Freigabe, sodass ein Serien-, Paket- oder Projektmerkmal nicht allein aus einem Werbetext entsteht. Die Kombination aus zwei Vorteilen bleibt sprachlich zusammenhängend und behält die Pflichtangaben zu Wohnfläche und Zimmerzahl.

## Energieausweistyp: Befund und offene Grenze

Der Serializer schreibt bei verifiziertem Bedarf den Standardpfad `immobilie/zustand_angaben/energiepass/epart` mit dem Wert `BEDARF`, daneben `endenergiebedarf` und `wertklasse`. Das endgültige ZIP enthält dieselben Felder. OpenImmo selbst dokumentiert `BEDARF` als gültigen `epart`-Wert. Ein abweichendes, öffentlich dokumentiertes Importmapping von Immoprofessional wurde nicht gefunden.

Quelle zum Standardpfad: https://www.openimmo.de/go.php/p/44/openimmo-blog.htm

Im aktuell geladenen Katalog stehen 76 aktive Inserate auf `transferred_pending_import`. Keines davon hat einen `energy_certificate`-Fakt; die zwei verifizierten Canary-Fakten (`18`, `A+`) liegen in einem Resetarchiv eines nicht aktiven FPI-Inserats. Die Live-App zeigt für 17 ausgewählte Adressen 0 uploadbereite Inserate. Daher ist weder ein neues Energie-Mapping noch ein weiterer Upload anhand des vorliegenden Bestands belegbar. Ein Portaltest mit konkreter Objektnummer und Importbericht ist für die Ursachenisolierung erforderlich.

## Zehn read-only Titelproben

Alle zehn Proben stammen aus unterschiedlichen Haustypen des lokalen Katalogs für Dallgow-Döberitz. Jede bestand die bestehende Claim-Prüfung mit `BLOCK = 0` und `REVIEW = 0`.

| Haus | Titel | Freigegebene USP-Fakten |
| --- | --- | --- |
| SUN 126 V2 | 126 m², 4 Zimmer für große Pläne in Dallgow-Döberitz: Heute planen, an morgen denken – mit 30 Jahren Garantie auf die tragende Holzkonstruktion und 18 Monaten Festpreisgarantie | `structural_guarantee`, `fixed_price_guarantee` |
| SUN 130 V2 | Planbar ins eigene Zuhause: 131 m², 4 Zimmer in Dallgow-Döberitz – mit 18 Monaten Festpreisgarantie und 30 Jahren Garantie auf die tragende Holzkonstruktion | `fixed_price_guarantee`, `structural_guarantee` |
| SUN 136 V4 | 135 m², 4 Zimmer für große Pläne in Dallgow-Döberitz: Ein Zuhause mit durchdachter Technik – mit dem I-KON-Technikpaket und 30 Jahren Garantie auf die tragende Holzkonstruktion | `ikon_technical_package`, `structural_guarantee` |
| SUN 142 V2 | Heute planen, an morgen denken in Dallgow-Döberitz: 142 m², 5 Zimmer – mit 30 Jahren Garantie auf die tragende Holzkonstruktion und dem I-KON-Technikpaket | `structural_guarantee`, `ikon_technical_package` |
| SUN 143 V4 | Qualität für euer Zuhause: 143 m², 5 Zimmer in Dallgow-Döberitz – mit DGNB-Serienzertifizierung und dem I-KON-Technikpaket | `dgnb_series_certification`, `ikon_technical_package` |
| SUN 144 V4 Tag | Ankommen in Dallgow-Döberitz: 144 m², 5 Zimmer für euren nächsten Schritt – mit 18 Monaten Festpreisgarantie und dem I-KON-Technikpaket | `fixed_price_guarantee`, `ikon_technical_package` |
| SUN 151 V8 | Dallgow-Döberitz ruft: Den Hausbau im Blick auf 152 m² mit 5 Zimmern – mit der Bau-Cockpit-App und 18 Monaten Festpreisgarantie | `bau_cockpit`, `fixed_price_guarantee` |
| SUN 154 V3 | Ankommen in Dallgow-Döberitz: 153 m², 5 Zimmer für euren nächsten Schritt – mit 18 Monaten Festpreisgarantie und der Bau-Cockpit-App | `fixed_price_guarantee`, `bau_cockpit` |
| SUN 157 V2 | Den Hausbau im Blick: 153 m², 6 Zimmer in Dallgow-Döberitz – mit der Bau-Cockpit-App und dem I-KON-Technikpaket | `bau_cockpit`, `ikon_technical_package` |
| SUN 164 V2 | 164 m², 5 Zimmer für große Pläne in Dallgow-Döberitz: Gut vorbereitet in die Bauzeit – mit Bauversicherungen und 30 Jahren Garantie auf die tragende Holzkonstruktion | `building_insurance`, `structural_guarantee` |

## Hürden und Risiken

- Ein gültiges OpenImmo-XML beweist nicht, dass Immoprofessional den Wert in sein internes Feld übernimmt. Ohne den konkreten Importfall wäre eine zusätzliche Feldbelegung geraten.
- Die Zahl 18 und die Klasse A+ gehören ausschließlich zum archivierten Canary. Sie werden nicht auf aktive Inserate übertragen.
- Die aktuelle Warteschlange ist leer. Bereits übertragene Inserate dürfen nicht erneut als neue Anzeigen eingeplant werden.

## Qualitätsnachweis

- Fokussierte OpenImmo-, Canary- und Golden-Tests: 12 bestanden.
- Vollständige Testsuite: 640 bestanden, 0 fehlgeschlagen, 1 übersprungen (Windows-spezifisch).
- ESLint und Produktions-Build: grün.
- Read-only Compliance-Scan des aktuellen Katalogs: 76 Inserate, `BLOCK = 0`, `REVIEW = 0`.
- Es fand kein Upload und keine Änderung in Immoprofessional statt.
