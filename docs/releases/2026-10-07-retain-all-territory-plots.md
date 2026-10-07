# Gesamten Bestand im vorhandenen PLZ-Suchgebiet behalten

## Änderung

Alle aktiven Grundstücke mit einer PLZ aus dem vorhandenen Blatt `Suchgebiet` bleiben im eigenen Bereich erhalten. Alter, Herkunft, Master-Eintrag und bisherige Behalten-Merkmale sind dafür unerheblich. Kein solches Grundstück erscheint in der Bereinigungsliste. Außerhalb gilt weiterhin der bestehende Exklusiv-Schalter.

Auch Grundstücke im Suchgebiet mit noch unvollständiger Adresse bleiben erhalten. Die vorhandene Adressprüfung verhindert weiterhin die Auswahl für neue Inserate, bis eine verwendbare Adresse vorliegt. Die Vorschau nennt diese Zahl zusätzlich. Bereits archivierte Datensätze werden nicht wieder aktiviert.

Der zusätzliche Editor-Schalter für ein Behalten ohne Master-Eintrag entfällt. Vorhandene Werte bleiben aus Kompatibilitätsgründen gespeichert; für das Behalten im Suchgebiet werden sie nicht benötigt. Pool A/B und dessen Synchronisation bleiben unverändert.

## Begründung

Pascals konkretisierte Regel ist gebietsbezogen. Der Abgleich nur mit der Masterdatei und die folgende Ausnahme für neun Grundstücke erfüllten sie nicht. Die zentrale Zuordnung nutzt weiterhin ausschließlich die bereits vorhandene PLZ-Logik. Das Behalten eines Grundstücks und seine Eignung für die Erzeugung eines Inserats werden getrennt geprüft.

## Hürden und Risiken

Beim vollständigen Abgleich waren noch 30 Grundstücke im Suchgebiet in der Ausblendungsliste, darunter 16 mit offener Adressprüfung. Die korrigierte Vorschau ergibt 51 aktive Grundstücke im eigenen Gebiet, 0 Exklusiv-Grundstücke und 73 auszublendende Grundstücke außerhalb. Von den 51 bleiben 16 bis zur Adressprüfung für neue Inserate gesperrt. Vier bereits archivierte Grundstücke im Gebiet bleiben archiviert und gespeichert.

Die Korrektur erfordert keine Änderung der gespeicherten Grundstücke oder historischen Inserate. Die einmalige Bereinigung bleibt zur Bestätigung durch Pascal offen. Es werden weder Excel-Dateien beschrieben noch Portalobjekte, Listings, Uploadhistorien, Bilder, Lösch-Batches oder Auditdaten verändert.

## Prüfung

Regressionen prüfen alle PLZ des Test-Suchgebiets einschließlich alter Datensätze ohne Master-Eintrag und ohne Behalten-Merkmal, die Erhaltung offener Adressen bei gesperrter Inseratserzeugung, Bestätigung und Neustart, die Fortführung archivierter Datensätze und unveränderte Historie. Dazu fokussierte Tests, Gesamtsuite, ESLint und Produktions-Build. Der produktive Bestand wird vollständig gegen die vorhandenen 50 aktiven PLZ geprüft; erwartete Überschneidung zwischen eigenem Gebiet und Ausblendungsliste: null.
