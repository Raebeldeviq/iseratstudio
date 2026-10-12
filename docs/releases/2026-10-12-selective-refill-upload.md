# Gezielter Upload vorbereiteter Nachfolger

## Report

Die vorhandene Vorschau erhält einzelne Checkboxen, eine Suche nach neuer Objektnummer oder Pool-Adresse, gefilterte Sammelauswahl, Auswahlaufhebung und einen sichtbaren Auswahlzähler. Beim Öffnen ist nichts ausgewählt. Auch außerhalb der aktuellen Suche ausgewählte Inserate sind erkennbar und können in einer kompakten Liste geprüft werden.

Der Uploadbutton nennt die konkrete Anzahl. Ein modaler Bestätigungsdialog listet die Objektnummern und bietet Abbrechen oder Upload starten. Archivkonflikte werden aus den weiterhin ungeklärten, früher übertragenen Resetarchiven abgeleitet. Die Sammelauswahl überspringt betroffene Inserate. Bewusste Einzelauswahl bleibt möglich und der Hinweis steht ebenfalls in der Bestätigung.

Die bestehende Uploadplanung benötigt für Nachschub nun eine explizite, nicht leere Liste vorbereiteter listingIds. Unbekannte, doppelte und bereits übertragene IDs werden zurückgewiesen. Dieselbe Auswahl begrenzt die Wiederaufnahme und die vorhandene sequenzielle Uploadpipeline. Eine zusätzliche Prüfung vor dem Worker weist eine breitere oder doppelte Warteschlange zurück. Der bisherige FTPS-Transport und die persistente Job-Idempotenz werden weiterverwendet.

Die Transferverbuchung berücksichtigt bestätigte Nachschubquellen: Sie bleiben gelöscht und werden weder als veröffentlicht gekennzeichnet noch mit einem ausstehenden Rotationsauftrag versehen. Der neue Uploadhistorieneintrag verwendet die tatsächlich übertragene Pool-Adresse. Die bestehenden Reservierungen, Gutschriften und historischen Daten bleiben erhalten. FTPS-Erfolg bleibt `transferred_pending_import` und bedeutet keine Portalimportbestätigung.

## Begründung

Eine feste Auswahl nach listingId bleibt auch bei Suche, Wiederaufnahme und bestehender Batch-Neuplanung eindeutig. Eine alleinige Ausblendung von Karten würde keinen sicheren Transportumfang festlegen. Deshalb wird die Auswahl unabhängig vom sichtbaren Filter in der vorhandenen Pipeline geprüft. Es gibt keinen zweiten Uploadweg.

Archivhinweise sind eine Darstellung des bestehenden Bestands. Es werden keine historischen Inserate verändert und keine Portalstatusinformationen erfunden.

## Hürden und Risiken

- Alte Rotationskopien erwarten eine veröffentlichte Quelle. Nachschub hat dagegen eine bestätigte gelöschte Quelle. Die Transferverbuchung musste diese belegte Unterscheidung berücksichtigen, damit nach FTPS-Erfolg keine falsche Quellenreaktivierung oder gescheiterte Katalogverbuchung entsteht.
- Bereits gespeicherte Entwürfe können zu einem anderen Uploadtag geplant worden sein. Die bestehende Batch-Neuplanung gilt ausschließlich den ausgewählten listingIds. Sie kann deren Nummern an den neuen Batch anpassen; die App speichert diesen Stand und verlangt wie bisher einen erneuten Uploadstart nach Prüfung der aktualisierten Nummern. Nicht ausgewählte Inserate bleiben vorbereitet.
- Einzelne Archivhinweise bleiben bewusst auswählbar. Das ersetzt keine Prüfung des tatsächlichen Portalbestands. Die Sammelauswahl und Bestätigung machen diese Fälle sichtbar.
- UI-Auswahl wird nur in der geöffneten Ansicht gehalten. Ein erneutes Öffnen beginnt ohne Auswahl; nach erfolgreichem Transfer fallen die betreffenden IDs aus der vorbereiteten Auswahl.

## Prüfung

Isolierte Regressionen prüfen fehlende Auswahl, einen und vier von 90 Nachfolgern, Ausschluss unbekannter/übertragener IDs, Suchauswahl, Archivhinweise, Ausweitung der Warteschlange, parallele und wiederholte Aufrufe, persistente Wiederaufnahme, simulierte FTPS-Fehler, unveränderte übrige 86 Inserate, unveränderte gelöschte Quellen, Historie und +9/+10/+11/+12 nach Uploadtag-Neuplanung. Bestehende Upload- und OpenImmo-Regressionen laufen ebenfalls.

Produktive Transfers sind in diesem Entwicklungsauftrag nicht vorgesehen. Die vier beauftragten Objektnummern werden ausschließlich für eine lesende Umfangsprüfung und den UI-Praxistest verwendet.

Ergebnis: 49 fokussierte Tests bestanden. Gesamtsuite: 777 Tests, 776 bestanden, ein bestehender Skip, keine Fehler. ESLint und Produktions-Build bestanden. Die Gesamtsuite enthält die bestehenden Upload-, Idempotenz-, Bild- und OpenImmo-Regressionen.

Ein zusätzlicher isolierter Durchlauf auf einer Kopie des aktuellen Katalogs bestätigt 90 vorbereitete Inserate, 22 Archivhinweise und 68 bei Sammelauswahl berücksichtigte Inserate. Genau die vier beauftragten listingIds erreichen die simulierte Transferverbuchung. Sämtliche anderen Inseratsobjekte, Reservierungen und Archive bleiben identisch; danach bleiben 86 vorbereitet. Die bestehenden Uploadtag-Regeln planen für diese vier Hauspositionen 1 jeweils den 21. Oktober bei einem simulierten Upload am 12. Oktober. Der reale Bestand wird durch diese Prüfung nicht verändert.
