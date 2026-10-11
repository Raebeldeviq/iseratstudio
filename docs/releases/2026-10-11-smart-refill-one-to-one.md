# Nachschub pro Inserat – 11.10.2026

## Änderung

- Ein bestätigtes gelöschtes Inserat reserviert genau einen Nachfolger derselben plotId. Die bisherige globale Bündelung zu vier Inseraten auf anderen Grundstücken entfällt.
- Der unveränderliche Pool des Quellinserats entscheidet A→B oder B→A; aktive gemischte Pools sind zulässig. Bestandsinserate und Projekt-Stammdaten bleiben erhalten.
- Haustypen werden mit der vorhandenen Katalogvalidierung und Gewichtung gewählt. Quellhaus, aktive Häuser und gleichzeitig reservierte Häuser sind ausgeschlossen.
- Der bestehende Generator unterstützt einzelne Ersatzpositionen und verwendet weiterhin Texte, Bildreihenfolge, Hausvarianten, Innenraum-Sets und Compliance. OpenImmo übernimmt Fläche und Grundstückspreis aus dem jeweiligen Inserat-Snapshot.
- Die bestehende Nachschubvorschau zeigt Quellnummer → Nachfolgernummer, Adresse, Pools, Häuser, Innenraum-Set, Hausposition und Löschtermin.
- Neue Reservierungen enthalten genau eine Kredit-ID und eine neue listingId. Alte Viererreservierungen bleiben als Audit erhalten; kontrolliertes Verwerfen ist ausschließlich eine geprüfte administrative Transaktion.
- Pascals ausdrücklich erteilte Freigabe der vorhandenen Pooldaten wird einmalig auf die aktuellen Fakten-Fingerprints übertragen. Spätere Datenänderungen erhalten diese Freigabe nicht automatisch.

## Begründung

Der freie Platz gehört dem tatsächlich gelöschten Inserat, nicht einer globalen Grundstücksauswahl. Persistente Quellidentität und ein Inserat-Snapshot erlauben individuelle Rotation bei unveränderten Nachbarinseraten. Die vorhandene Erzeugung und Exportprüfung bleiben gemeinsame Infrastruktur.

## Hürden und Risiken

- Legacy-Inserate haben teilweise keinen Pool-Snapshot. Die Zuordnung erfolgt über exakte listingId/Objektnummer, Uploadadresse, gespeicherte Poolfakten und ursprüngliche Hausposition. Mehrdeutige Fälle bleiben blockiert.
- Die automatische Archiv-Sperre einer abgeschlossenen regulären Löschung darf nicht mit einem echten Premium-/manuellen Löschschutz verwechselt werden.
- Noch nicht in den Legacy-Katalog übernommene Pool-B-Daten werden aus dem gespeicherten Master-Katalog gelesen. Fehlen sie dort, gilt die bereits vorhandene Pooldarstellung; unvollständige Daten bleiben Prüffälle. Die Master-Excel wird nicht geschrieben.
- Nummern verworfener Vorbereitungen bleiben in den Lösch-Batch-Einträgen erhalten und werden nicht erneut vergeben. Kein Verwerfen bei Transfermetadaten, Uploadhistorie oder vorhandenen Uploadjobs.
- Die Reparatur `scripts/repair-batch-001-refill.mjs` ist auf die vier beauftragten Rothenbücherweg-Nummern und vier Batch-001-Quellen begrenzt. Sie bestätigt keine Löschungen und verändert weder Credits noch Uploadhistorie oder produktive Inserate.

## Verifikation

Isolierte Regressionen decken individuelle Poolrotation, drei unveränderte Nachbarn, Haus-Eindeutigkeit, vier Grundstücke, Neustart/CAS, wiederholte Bestätigung, Archiv-/Premiumschutz, kontrolliertes Verwerfen, Nummernerhalt, Innenraum-Rotation, OpenImmo und +9/+10/+11/+12 Tage ab. Release-Gates: fokussierte Tests, Gesamtsuite, ESLint und Produktions-Build. Kein produktiver Upload.

Abgeschlossene Gates: 765 Tests, davon 764 bestanden und ein vorhandener Skip; ESLint ohne Fehler/Warnungen; Produktions-Build erfolgreich. Vier reale OpenImmo-Pakete mit je 13 Bildern und Innenraum-Sets C/A/B/C lokal geprüft. Zusätzlicher Schutz: Nachschubnummern bleiben auch nach Batch-999-Überlauf historisch reserviert.
