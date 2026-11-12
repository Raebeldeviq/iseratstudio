# Nachschubvorschau: Alle auswählen

## Änderung

Die Nachschubvorschau bietet zusätzlich den Button „Alle auswählen“. Er wählt
alle vorbereiteten Nachfolger der vollständigen Liste aus, auch wenn die Suche
gerade nur einen Teil davon zeigt. „Alle gefilterten Treffer auswählen“ bleibt
für die Suche erhalten. Auswahlanzahl und „Auswahl aufheben“ gelten weiterhin
für die gesamte Auswahl.

## Begründung

Beide Aktionen verwenden die vorhandene Sammelauswahl. Damit bleibt das
Verhalten einheitlich: Schon ausgewählte Inserate bleiben erhalten und es
entstehen keine doppelten IDs. Ungeklärte Archivhinweise werden wie bisher bei
der Sammelauswahl übersprungen und können ausdrücklich einzeln gewählt werden.

## Hürden und Risiken

„Alle“ muss sich auf die vollständige Vorschau beziehen und darf nicht
versehentlich auf die Suchtreffer begrenzt sein. Während einer laufenden
Verarbeitung oder bei nicht erreichbarem Helper bleibt die Auswahl gesperrt.
Die Auswahl startet keinen Upload; der bestehende Uploadbutton mit Bestätigung
bleibt erforderlich. Produktionsdaten, Nummern, Reservierungen, Löschbuchungen
und Uploadhistorie werden durch die Änderung nicht bearbeitet.

## Prüfung

Die fokussierten UI-Tests prüfen beide Beschriftungen und die Sperre des neuen
Buttons bei fehlendem Helper, laufender Verarbeitung und laufendem Upload.
Bestehende Auswahl-, Archiv- und Uploadtests decken die wiederverwendete
Sammelauswahl und den Doppelupload-Schutz ab. 32 fokussierte Tests bestanden.
Gesamtsuite: 864 Tests, 863 bestanden, ein bestehender Skip, keine Fehler.
ESLint und Produktions-Build bestanden.
