# Globale Innenraum-Priorität — 01.10.2026

## Änderung

Neu während der App-Vorbereitung erzeugte Entwürfe erhalten ihre globale Set-Zuordnung bereits im zentralen Erzeugungspfad. Der Vergleich nach Inserats-ID schützt vorhandene gespeicherte Entwürfe und veröffentlichte Inserate. Erneute Vorbereitung und Textregeneration verändern deren Zuordnung nicht.

Der vorhandene gemeinsame Bildresolver übernimmt bei einem zugeordneten Set ausschließlich dessen sechs gespeicherte Asset-Referenzen für Wohnzimmer, Kinderzimmer, Schlafzimmer, Küche, Bad und Büro. Alte Haus-Innenräume bleiben gespeichert und werden nur aus der neuen Inseratsbildfolge ausgefiltert. Alle übrigen Bildrollen bleiben erhalten.

## Begründung

Die Bildpriorität war im Resolver bereits korrekt umgesetzt. Die fehlende Set-Zuweisung bei einer früheren Entwurfserzeugung war die Lücke. Der zentrale Erzeugungspfad verwendet nun denselben vorhandenen Zuweisungshelfer; kein Umbau und keine parallele Bildverwaltung.

## Hürden und Risiken

Bestehende gespeicherte Inserate ohne Set behalten absichtlich ihre alte Bildfolge. Nur neue IDs erhalten eine Zuweisung. Fehlende persistierte Set-Assets blockieren weiterhin den Export. Alte Bilddateien werden nicht gelöscht.

Die automatische Freigabeprüfung hat die Integration in main und die anschließende Runtime-Installation wegen der AGENTS.md-Regel abgelehnt. Die kleine Korrektur verbleibt daher bis zur ausdrücklichen Klärung auf dem Feature-Branch. Die installierte Runtime verfügt bereits über den unverändert korrekten gemeinsamen Bildresolver.

## Prüfungen

- Fokussierte Innenraum-/OpenImmo-/Bildfolgetests: 30 bestanden.
- Gesamtsuite: 691 bestanden, 1 übersprungen, keine Fehler.
- ESLint und Produktions-Build: grün.
- Ein separates Canary wird als einziges neues Inserat mit vollständigem Set und ohne Legacy-Innenräume vorbereitet. Die Kontrolle umfasst sechs Raumreferenzen aus einem Set, Erhalt übriger Rollen, Bildreihenfolge und das finale OpenImmo-Paket.
- Ein erfolgreicher Upload bestätigt die Übertragung an Immoprofessional. Die tatsächliche Portal-Bildfolge prüft Pascal selbst.
