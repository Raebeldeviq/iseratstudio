# Globale Innenraum-Priorität — 01.10.2026

## Änderung

Neu während der App-Vorbereitung erzeugte Entwürfe erhalten ihre globale Set-Zuordnung bereits im zentralen Erzeugungspfad. Der Vergleich nach Inserats-ID schützt vorhandene gespeicherte Entwürfe und veröffentlichte Inserate. Erneute Vorbereitung und Textregeneration verändern deren Zuordnung nicht.

Der vorhandene gemeinsame Bildresolver übernimmt bei einem zugeordneten Set ausschließlich dessen sechs gespeicherte Asset-Referenzen für Wohnzimmer, Kinderzimmer, Schlafzimmer, Küche, Bad und Büro. Alte Haus-Innenräume bleiben gespeichert und werden nur aus der neuen Inseratsbildfolge ausgefiltert. Alle übrigen Bildrollen bleiben erhalten.

## Begründung

Die Bildpriorität war im Resolver bereits korrekt umgesetzt. Die fehlende Set-Zuweisung bei einer früheren Entwurfserzeugung war die Lücke. Der zentrale Erzeugungspfad verwendet nun denselben vorhandenen Zuweisungshelfer; kein Umbau und keine parallele Bildverwaltung.

## Hürden und Risiken

Bestehende gespeicherte Inserate ohne Set behalten absichtlich ihre alte Bildfolge. Nur neue IDs erhalten eine Zuweisung. Fehlende persistierte Set-Assets blockieren weiterhin den Export. Alte Bilddateien werden nicht gelöscht.

Pascal hat nach bestandener Portalprüfung von 30460-003015 die Integration des geprüften Feature-Stands in main, origin/main und Runtime ausdrücklich freigegeben. Entwickelt wurde ausschließlich auf dem Feature-Branch.

## Prüfungen

- Fokussierte Innenraum-/OpenImmo-/Bildfolgetests: 30 bestanden.
- Gesamtsuite: 691 bestanden, 1 übersprungen, keine Fehler.
- ESLint und Produktions-Build: grün.
- Ein separates Canary wird als einziges neues Inserat mit vollständigem Set und ohne Legacy-Innenräume vorbereitet. Die Kontrolle umfasst sechs Raumreferenzen aus einem Set, Erhalt übriger Rollen, Bildreihenfolge und das finale OpenImmo-Paket.
- Ein erfolgreicher Upload bestätigt die Übertragung an Immoprofessional. Die tatsächliche Portal-Bildfolge prüft Pascal selbst.

## Canary-Ergebnis

- Neues Testinserat: `30460-003015`, SUN 130 V2, Fritz-Zubeil-Straße 23A, Potsdam-Babelsberg.
- Interior-Set: A; 6/6 Raumrollen aus demselben Set; keine Legacy-Innenräume im finalen Paket.
- Bildfolge: Hausansicht → Wohnzimmer → Kinderzimmer → Schlafzimmer → Küche → Bad → Büro → Emotionaler Catch → EG-Grundriss → OG-Grundriss → Auszeichnungen → Vertrauen → QR-Abschluss (13 Bilder).
- Genau ein neues Inserat und genau eine Übertragung. Uploadjournal: `transferred_pending_import`, Transferzeit `2026-10-01T14:15:50.187Z`.
- ZIP: `fritz-zubeil-stra-e-23a-14482-potsdam-14482-pots-sun-130-v2-30460-003015-2026-10-01.zip`. Vorab geprüfter Paket-SHA-256: `0b45a33fd2e2f8f54f24efe089959ece0173475e058642ce2d36f7f3e876ec54`.
- Alle 112 vorher vorhandenen Inserate und sämtliche Haustyp-/Bildassets unverändert geprüft.
- Die erste lokale Statusübernahme nach dem erfolgreichen Transfer scheiterte an einer irrtümlichen Rotationsquellen-Kennzeichnung des unabhängigen Tests. Nur beim neuen Canary wurde diese Kennzeichnung korrigiert und der bereits vorhandene Uploadjournalbeleg lokal übernommen. Kein zweiter Upload und keine Änderung der Quelle.
- Portal-Bildfolge und tatsächlicher Import bleiben Pascals manueller Prüfung vorbehalten.
- Die Erzeugungspfad-Korrektur ist getestet. Integration und Runtime-Aktualisierung wurden anschließend von Pascal ausdrücklich freigegeben.

## Freigegebener vollständiger Rotationszyklus

Nach Installation genau drei unabhängige neue Testinserate erzeugen und deren persistierte Folge B → C → A, sechs konsistente globale Raumreferenzen, Ausschluss alter Innenräume und Erhalt der übrigen Rollen anhand der finalen Pakete prüfen. Nur diese drei neuen Inserate jeweils einmal übertragen. Der ursprüngliche Bestand und der erste Canary bleiben unverändert. Uploadjournal und vollständiger Vorher-/Nachher-Vergleich dienen als Nachweis; die Portalprüfung erfolgt durch Pascal.
