# Premium-Schutz in der Lösch-Ampel

## Änderung

- Die bestehenden Inseratsmanager-Felder `premiumPlacement` und `manualLock` schützen jetzt auch vor der normalen Lösch-Batch-Planung und -Bestätigung.
- Geschützte Batch-Einträge erhalten den Status `paused`. Objektnummer, Batch-Zuordnung und Eintragshistorie bleiben erhalten. Nach Entfernen beider Schutzgründe wird der vorherige Planungsstatus wiederhergestellt.
- Die Lösch-Ampel zählt nur löschbare Einträge. Bei gemischten Batches zeigt sie die geschützten Objektnummern ausdrücklich als „nicht löschen“ an. Die serverseitige Bestätigung prüft den aktuellen Schutzstatus erneut.
- Im bestehenden Inseratsmanager sind aktive Schutzgründe direkt an den vorhandenen Checkboxen lesbar. `premiumUntil` ist als optionales Datenfeld vorbereitet; Laufzeitautomatik ist nicht implementiert.

## Ansatz

Der Schutz wird am gespeicherten Batch-Eintrag reconciliert und bei jeder Ampel-Ansicht sowie vor der Bestätigung nochmals aus den aktuellen Inseratskontrollen abgeleitet. So bleiben bestehende Nummern und Historie unangetastet, während eine verspätete Änderung der Checkbox sofort wirksam wird. Die vorhandene Premium-Sperre der Hausrotation bleibt bestehen.

## Hürden und Risiken

- Ein gemeinsamer Suchpräfix kann zugleich löschbare und geschützte Inserate enthalten. Deshalb weist die Batchkarte auf geschützte Objektnummern hin; die externe Löschung in Immoprofessional bleibt eine manuelle Auswahl.
- Wenn ein pausiertes, noch nicht übertragenes Inserat später mit unveränderter Objektnummer hochgeladen wird, bleibt sein ursprünglicher Batch-Termin erhalten. Vor einem späteren Entsperren ist dieser Termin zu prüfen, insbesondere wenn er inzwischen verstrichen ist.
- Eine erfolgreiche interne Batch-Bestätigung belegt keine externe Portallöschung. Die Bestätigung bleibt an Pascals vorherige manuelle Löschung gebunden.

## Prüfung

- Gezielte Batch- und Rotationsprüfungen bestanden.
- Gesamtsuite: 658 bestanden, 1 übersprungen, 0 fehlgeschlagen.
- ESLint und Produktions-Build bestanden.
