# Kundennutzen, Ortsstruktur und Portaldiagnose – 28.09.2026

## Implementierung

- Neu erzeugte Titel beginnen mit einem zurückhaltenden Kundennutzen. Ort, gerundete Wohnfläche, Zimmerzahl und höchstens zwei freigegebene USP-Fakten bleiben enthalten. Die 30-jährige Garantie wird im Titel kurz genannt; der freigegebene Fakt und sein Beleg begrenzen sie weiterhin auf die definierte tragende Holzkonstruktion.
- Ein gemeinsamer Ortsauflöser trennt belegte Stadtteile von der amtlichen Stadt. Er nutzt zuerst ein bereits strukturiertes Stadtteilfeld und danach eine eng begrenzte Zuordnung mit Ortsname und Postleitzahl. Der aktive Katalog wurde auf Potsdam-Stern, Bornstedt, Drewitz und Groß Glienicke, Berlin-Zehlendorf, Kloster Lehnin-Damsdorf sowie Werder (Havel) mit Glindow, Phöben und Töplitz geprüft. Berlin-Rudow ist als belegter zusätzlicher Beispielort hinterlegt. Unbekannte Namen und amtliche Bindestrichorte bleiben unverändert.
- OpenImmo schreibt die Stadt nach `geo/ort` und den belegten Stadtteil nach `geo/regionaler_zusatz`. Der Titel darf beides als lesbare Lagebezeichnung verbinden.
- Die bestehende Statusausgabe `zustand_angaben/verkaufstatus@stand=NEU` wurde als Standardmapping verifiziert und bleibt unverändert. Ein weiterer portalspezifischer Wert wurde mangels Nachweis nicht eingeführt.

## Begründung

Die Titel nutzen ausschließlich `releasedTitleUsps` und behalten damit die bestehende Faktenfreigabe. Eine ausdrückliche Ortszuordnung verhindert, dass amtliche Namen durch eine allgemeine Bindestrichregel beschädigt werden. Der gleiche Auflöser in Titel und Export vermeidet unterschiedliche Lageinterpretationen.

## Hürden und offene Risiken

- Bei einem bereits vorhandenen Immoprofessional-Objekt war das sichtbare Feld „Status des Objektes“ leer, obwohl der aktuelle Serializer `verkaufstatus stand="NEU"` erzeugt. Ohne belegtes Immoprofessional-Importmapping oder kontrollierten Neuimport ist die Übernahme in dieses Feld **nicht nachgewiesen**. Der XML-Regressionsfall belegt nur die Standardausgabe.
- Für eine gezielte Aktivierung von ImmobilienScout24 beim Import wurde weder ein offizielles OpenImmo-Feld noch ein dokumentiertes Immoprofessional-spezifisches Importfeld gefunden. Die sichtbaren Portalcheckboxen sind objektspezifisch; die öffentliche Produktdokumentation beschreibt deren Auswahl und einen möglichen automatischen Export nach dem Speichern. Ob ein Import diesen Export auslöst und ob ausschließlich ImmobilienScout24 per XML gesetzt werden kann, bleibt ungeklärt. Es wurde keine Checkbox und kein Portalobjekt geändert.
- Für den Energieausweistyp gibt es weiterhin keinen Byte-Nachweis des historischen Transfers und keine belegte Ursache für „keine Angabe“ in Immoprofessional. Der aktuelle finale ZIP-Test prüft `energiepass/epart=BEDARF`, `endenergiebedarf=18` und `wertklasse=A+` bei belegten Canary-Fakten sowie das Ausbleiben des Energiepasses ohne solche Evidenz. Das ist **kein** Immoprofessional-End-to-End-Nachweis. Ein neuer Import darf nur über ein gesichert isoliertes Testprofil ohne Portalweitergabe erfolgen.
- Bei einem Widerspruch zwischen strukturiertem Stadtteil und dem bekannten zusammengesetzten Ortsnamen bleibt die Rohangabe erhalten. Dieser Fall benötigt eine Datenkorrektur vor Verwendung; er wird nicht durch eine Vermutung aufgelöst.

## Quellen zur Schnittstellenbewertung

- Immoprofessional: https://www.immoprofessional.com/de/immobilienwebseite-schnittstellen/
- Immoprofessional zu Portalmarkierung und Export: https://www.immoprofessional.com/de/immobilienwebseite-schnittstellen/immowelt-inserieren/
- OpenImmo, Änderung des Energieausweisschemas 2026: https://openimmo.de/go.php/p/49/epass2026.htm
- Stadtteil Stern: https://www.potsdam.de/de/content/am-stern-drewitz-kichsteigfeld
- Potsdamer Stadtteilverzeichnis: https://www.potsdam.de/de/bevoelkerung-einwohner-nach-stadtteilen-der-landeshauptstadt-potsdam
- Bornstedt und Postleitzahl: https://www.potsdam.de/de/bornstedt
- Groß Glienicke und Postleitzahl: https://www.potsdam.de/de/gross-glienicke
- Stadtteil Rudow: https://www.berlin.de/special/stadtteile/neukoelln/908313-5170841-rudow.html
- Zehlendorf und Postleitzahl: https://www.berlin.de/ba-steglitz-zehlendorf/service/publikationen/wegweiser_durch_den_bezirk_2022.pdf
- Ortsteile Phöben und Töplitz: https://www.werder-havel.de/mein-werder/unsere-stadt/unsere-ortsteile/
- Amtlicher Ortsname Dallgow-Döberitz: https://www.dallgow.de/seite/102930/geschichte.html
- Damsdorf als Ortsteil von Kloster Lehnin: https://www.klosterlehnin.de/seite/32808/unsere-gemeinde.html

## Qualitätsnachweis

- Fokussierte Titel-, Orts- und OpenImmo-Tests: 23 bestanden, einschließlich Prüfung des XML im final erzeugten ZIP.
- Gesamtsuite: 644 bestanden, 0 fehlgeschlagen, 1 plattformspezifischer Test übersprungen. Gesamtes ESLint und Produktions-Build bestanden.
- Fünf lokal erzeugte Titelbeispiele mit freigegebenen Serien-/Paketfakten: Claim-Policy jeweils `PASS`, `BLOCK = 0`. Auch die verkürzte Garantie wurde gegen ihren vollständigen belegten Fakt geprüft.
- Keine Bestandsanzeige, Portalcheckbox, Rotation oder Uploadhistorie verändert.

| Haus und Lage | Lokal neu erzeugter Titel | Hinterlegte USP-Fakten |
| --- | --- | --- |
| SUN 167 V3, Potsdam-Stern | Mit gutem Gefühl ins neue Zuhause: 167 m², 5 Zimmer in Potsdam-Stern – DGNB-Serienzertifizierung & Bau-Cockpit-App | `dgnb_series_certification`, `bau_cockpit` |
| SUN 143 V4, Potsdam-Bornstedt | Gut organisiert bauen: 143 m², 5 Zimmer in Potsdam-Bornstedt – Bau-Cockpit-App & 18 Monate Festpreisgarantie | `bau_cockpit`, `fixed_price_guarantee` |
| SUN 151 V8, Potsdam-Drewitz | Gut organisiert bauen: 152 m², 5 Zimmer in Potsdam-Drewitz – Bau-Cockpit-App & DGNB-Serienzertifizierung | `bau_cockpit`, `dgnb_series_certification` |
| SOL 204 V4, Berlin-Zehlendorf | Mehr Sicherheit für eure Zukunft – 207 m², 6 Zimmer in Berlin-Zehlendorf – 30 Jahre Garantie & Bau-Cockpit-App | `structural_guarantee`, `bau_cockpit` |
| SOL 204 V4, Dallgow-Döberitz | Gut organisiert bauen – 207 m², 6 Zimmer in Dallgow-Döberitz – Bau-Cockpit-App & Bauversicherungen inklusive | `bau_cockpit`, `building_insurance` |

Diese Titel wurden nur aus dem lokalen Katalog neu berechnet; vorhandene Inserattexte wurden nicht gespeichert oder übertragen. Die USP-Belege stehen im freigegebenen Living-Haus-Faktenpool (`living-haus-checkliste.pdf`, Seiten 1–2). Bei `structural_guarantee` bezeichnet der vollständige Fakt ausschließlich die dort definierte tragende Holzkonstruktion.
