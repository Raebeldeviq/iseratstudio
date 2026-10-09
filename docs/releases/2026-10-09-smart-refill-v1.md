# Nachschub nach bestätigten Lösch-Batches

## Report

- Die vorhandene manuelle Batchbestätigung schreibt die tatsächlich von aktiv auf gelöscht gewechselten Inserate als eindeutige freie Plätze in den bestehenden Gerätekatalog. Fälligkeit allein erzeugt keinen Platz. Geschützte Einträge bleiben ausgenommen.
- Die Anzeige „Nachschub & Rotation“ unter der Lösch-Ampel berechnet automatisch geeignete Nachfolger: abgeschlossene Zyklen zuerst, danach ungenutzte Grundstücke. Laufende Zyklen, vorhandene Entwürfe, Premium-/Löschschutz, relevante Prüffälle und unvollständige Grundstücksdaten sperren Kandidaten.
- Die Vorbereitung reserviert vier freie Plätze für vier neue, unterschiedliche Hausinserate. Nicht belegbare Restplätze bleiben sichtbar. Auswahl und Reservierung werden vor der Erfolgsmeldung dauerhaft gespeichert.
- Die bestehende Inseratvorbereitung ist in `app/lib/listing-preparation.ts` gemeinsam nutzbar. Hausverteilung, Titel, Texte, Innenraum-Sets, Objektnummern und Lösch-Batches werden dadurch über denselben Ablauf erzeugt.
- Pool B benötigt eine ausdrückliche fachliche Bestätigung der vollständigen Adresse, Fläche und des Preises. Auch eine von der Grundstücksadresse abweichende Pool-A-Adresse braucht diese Bestätigung. Automatisch berechnete Pool-B-Daten gelten nicht als Freigabe. Jede Änderung dieser Fakten macht die Freigabe ungültig; vor dem Upload wird erneut geprüft.
- „Vorbereitete Inserate hochladen“ verwendet den vorhandenen manuellen FTPS-Sammelupload, begrenzt auf reservierte, noch nicht übertragene Inserate. Dessen persistentes Jobprotokoll überspringt abgeschlossene Übertragungen auch nach einem Neustart. Die bestehende Uploadbestätigung bleibt erforderlich.
- Bei geändertem Uploadtag werden die vorhandenen Regeln +9/+10/+11/+12 angewendet. Die Rotationsbereitschaft berücksichtigt den Eintrag zur aktuellen Objektnummer; verworfene frühere Planungen blockieren weder den erneuten Uploadstart noch einen abgeschlossenen Zyklus.

## Begründung

Freie Plätze, fachliche Freigaben und Vierergruppen stehen als `smartRefill` im vorhandenen Katalog. Es gibt keine zusätzliche Datenbank oder zweite Erzeugungs-/Transferpipeline. Die vorhandene optimistische Versionsprüfung schützt konkurrierende Speichervorgänge; zusätzliche Übergangsprüfungen verhindern erfundene Plätze, gelöschte Zuordnungen und doppelte Belegung. Während Vorbereitung und Upload verhindert die Oberfläche konkurrierende Bearbeitung; die Katalogaktualisierung wartet auf das Ende der Aktion.

## Hürden und Risiken

- Bereits vor Einführung bestätigte Löschungen werden nicht nachträglich als freie Plätze gutgeschrieben. Der Zähler beginnt mit den nächsten manuellen Batchbestätigungen und weist dies sichtbar aus.
- Restkapazität unter vier Plätzen bleibt frei. Bei weniger als vier geeigneten Häusern oder fehlenden Grundstücken werden keine unvollständigen Zyklen erzwungen.
- Reservierungen werden dauerhaft aufbewahrt. Ein später manuell zurückgesetzter Entwurf führt nicht automatisch zu einer erneuten Platzvergabe.
- Die fachliche Richtigkeit einer Adresse und der Grundstücksfakten muss der Nutzer prüfen. Die Software kann Vollständigkeit und unveränderte Freigabedaten kontrollieren, keine realen Grundstücksfakten nachweisen.
- FTPS-Erfolg bedeutet weiterhin „übertragen, Import unbestätigt“. Es gibt keine automatische Portalaktivierung und keinen neuen unbeaufsichtigten Upload.
- Historische Inseratsobjekte bleiben unverändert. Die aktive Projektadresse darf beim neuen Zyklus wechseln; bestehende Inserate behalten ihre gespeicherten Adress-Snapshots. Master-Excel und Synchronisationslogik wurden nicht geändert.

## Prüfung

16 fokussierte Nachschubtests umfassen 20 freie Plätze/5 Vierergruppen, 2/4 und 4/4 gelöscht, A→B→A, sachbezogene Poolfreigabe und deren Verfall, geschützte Inserate, Restkapazität, gleiche Bestätigung, Neustart, atomare Reservierung und konkurrierende Speicherung, aktuellen Uploadtag, genaue Uploadauswahl sowie die gerenderte Oberfläche. Ein Exporttest erzeugt mit der gemeinsamen Vorbereitung ein echtes OpenImmo-ZIP und prüft Pool-B-Fakten, neue Nummern, unveränderte Historie und Innenraumfolge A/B/C/A. Sämtliche Daten sind isolierte Testdaten; keine echten Uploads.

Gesamtsuite: 732 bestanden, ein Test planmäßig übersprungen. ESLint und Produktions-Build erfolgreich. Die Gesamtsuite enthält die bestehenden Compliance-, OpenImmo-, Bildfolge-, Batch- und Rotationsprüfungen.

Zusätzliche TypeScript-Diagnose: Der unveränderte Ausgangsstand `973ac61` enthält vier Typmeldungen. Nach der gemeinsamen Erzeugung verbleiben drei bereits bestehende Meldungen in `openimmo.ts` und `text-generator.ts`; keine neue Typmeldung. Diese Zusatzprüfung ist kein vorhandener Build-Gate. Die angeforderten Tests, ESLint und der Produktions-Build sind grün.
