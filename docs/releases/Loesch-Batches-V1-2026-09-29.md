# Lösch-Batches V1 – 29.09.2026

## Änderung

- Neue Inserate erhalten explizit gespeicherte Objektnummern `30460-BBBIII`. Die vier Hauspositionen einer Adresse werden auf Uploadtag +9 bis +12 Kalendertage verteilt. Gleiche Löschtage nutzen denselben offenen Batch.
- Nach Batch 999 beginnt ein neuer interner Zyklus mit sichtbarem Batch 001. Aktive und archivierte, noch nicht sicher gelöschte Objektnummern werden bei der Vergabe auf Kollisionen geprüft.
- Die Lösch-Ampel zeigt aktive Batches nach Fälligkeit gruppiert, mit kompakter Zählung und aufklappbaren Inseratdetails. Eine manuelle Bestätigung setzt den internen Löschstatus und den tatsächlichen Löschzeitpunkt. Es findet keine Portalaktion statt.
- Alte Inserate und Sondernummern werden ausschließlich anhand gespeicherter Batchdaten von neuen Batches unterschieden. Der Grundstücks-Reset bewahrt die Batchhistorie, weil sie Teil des bestehenden Katalogzustands ist.

## Technischer Ansatz

Die Batchdaten liegen im vorhandenen `StudioState` und werden über die bestehende Browser- und macOS-Katalogsicherung gespeichert. Ein separater Speicher oder eine neue Datenbank ist nicht erforderlich. Die Löschbestätigung läuft über den lokalen Helper und dessen transaktionale Katalogaktualisierung, weil Browser-Sicherungen produktive Inseratstatusänderungen absichtlich sperren. Neue Entwürfe erhalten bereits eine Batchnummer; vor einem Upload an einem anderen Kalendertag werden nur noch nicht übertragene Batch-Entwürfe neu geplant und gespeichert. Der Nutzer startet den Upload danach erneut, damit die geänderten Nummern sichtbar geprüft werden können.

## Hürden und Risiken

- Die bisherige Nummernprüfung akzeptierte keine führenden Nullen. Sie wurde für `30460-BBBIII` erweitert, ohne alte Nummern auszuschließen.
- Bereits vorbereitete Entwürfe können an einem späteren Tag hochgeladen werden. Der erneute Start nach einer Datumsanpassung verhindert, dass ein Paket mit veralteter Löschplanung übertragen wird.
- Der Helper blockiert auch außerhalb des manuellen App-Ablaufs einen Upload, wenn ein explizit zugeordnetes Batch-Inserat nicht für den aktuellen Uploadtag vorbereitet ist. Eine spätere automatische Nachplanung gehört nicht zu V1.
- Bestätigte Löschungen bilden ausschließlich die manuelle Rückmeldung in Inseratestudio ab. Sie beweisen keine Portal-Löschung; deshalb bleibt die Bestätigung eine bewusste Nutzeraktion.

## Qualitätsnachweis

- Gesamtsuite: 655 bestanden, 1 übersprungen, 0 fehlgeschlagen.
- ESLint: fehlerfrei. Produktions-Build: erfolgreich.
- Die zusätzlich ausgeführte TypeScript-Einzelprüfung meldet vier bereits im Ausgangsstand vorhandene Typfehler in `app/InseratStudio.tsx`, `app/lib/openimmo.ts` und `app/lib/text-generator.ts`. Die neuen Batch-Typfehler wurden behoben; die bestehenden fachfremden Stellen wurden in diesem Auftrag nicht verändert.
