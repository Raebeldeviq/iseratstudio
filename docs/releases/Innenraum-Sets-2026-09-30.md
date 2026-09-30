# Globale Innenraum-Sets und Rotation — 30.09.2026

## Umsetzung

Die vorhandene Bildverwaltung enthält einen kompakten Bereich für Sets A, B und C mit sechs Rollen: Wohnzimmer, Kinderzimmer, Schlafzimmer, Küche, Bad und Büro. Jede Rolle zeigt Vorschau und Vollständigkeitsstatus; JPEG, PNG und WebP werden unverändert als globale Assets gespeichert.

Explizite neue Inseratsgenerationen und neue Rotationskopien erhalten deterministisch das nächste vollständige Set. Unvollständige Sets werden übersprungen. Die globale letzte Set-ID steuert die Folge unabhängig von Grundstück, Hausauswahl und Lösch-Batch. Sind noch keine vollständigen Sets eingerichtet, bleibt die bisherige Hausbildfolge aktiv.

Inserate speichern Set-ID, automatische Auswahlquelle und sechs Asset-IDs. Textregeneration und Reload vergeben keine neue Zuordnung. Die Asset-IDs werden bei der Zuweisung eingefroren: spätere Änderungen an der globalen Set-Konfiguration verändern bereits zugeordnete Inserate nicht. Ersetzte globale Assets bleiben deshalb für ältere Referenzen erhalten.

Die Bilder werden im bestehenden Innenraumblock zwischen Hausansicht und emotionalem Catch eingesetzt. Vorschau, manuelles OpenImmo-Paket und Hintergrundexport verwenden dieselbe Auflösung. Aktionsbilder, Außenbilder, Grundrisse, Auszeichnungen, Vertrauen und QR-Abschluss behalten ihre Rollen. Bestehende Inserate ohne Set behalten ihre Bildfolge.

## Begründung

Der vorhandene Katalog-v2-Speicher speichert Binärdaten bereits eindeutig nach Asset-ID. Die Erweiterung nutzt diesen Speicher, die bisherige Gerätesicherung und IndexedDB. Es gibt keine zweite Bilddatenbank und keine physische Kopie pro Inserat. Eine gemeinsame Auflösung verhindert Unterschiede zwischen Vorschau und Export.

## Hürden und Risiken

- Alte Kataloge dürfen bei der Speicherung nicht allein wegen dieses Features um ein leeres Feld ergänzt werden. Eine entsprechende Regression wurde korrigiert und durch die bestehende Migrationstestsuite abgesichert.
- Fehlt ein bereits zugeordnetes Asset, blockiert die Auflösung mit einer konkreten Meldung, statt Räume aus anderen Sets einzusetzen.
- Ersetzte Assets werden bewusst behalten; eine spätere Bereinigung muss bestehende Inseratsreferenzen berücksichtigen.
- Im produktiven Katalog sind zum Releasezeitpunkt noch keine Innenraum-Sets eingerichtet. Die 18 Bilder müssen anschließend in der Haupt-App den Rollen zugeordnet werden. Es wurden keine Bilder generiert oder produktiven Inserate verändert/hochgeladen.
- Der optionale manuelle Set-Wechsel ist nicht Teil dieses Releases.
- Die zusätzliche TypeScript-Prüfung zeigt dieselben sechs bestehenden Fehler wie der unveränderte Ausgangsstand; keine neuen Typfehler. Die verbindlichen Gates (Tests, ESLint, Produktions-Build) bestehen.

## Prüfung

- Gesamtsuite: 690 bestanden, 1 übersprungen, 0 fehlgeschlagen.
- ESLint: ohne Fehler oder Warnungen.
- Produktions-Build: erfolgreich.
- Neue Tests: vollständige Sets A/B/C, fehlende Rollen, A→B→C→A, Überspringen, persistente Zuordnung, neue Kopien, Bestandsdaten, konsistenter Innenraumblock, gemeinsame Katalogassets und finale OpenImmo-ZIP-Bildfolge.
- Fokussierte Bild-/Katalog-/Exporttests: bestanden.

## Bedienung

Unter Haustypen → Innenraum-Sets die sechs Bilder je Set wählen. Nur vollständige Sets nehmen an der Rotation teil. Beim Ersetzen eines Bildes erhalten neue Inserate das neue Asset; bestehende Zuordnungen verwenden weiterhin ihre gespeicherten Asset-IDs. In der Inseratsvorschau und im Inseratsmanager erscheint die verwendete Set-ID.
