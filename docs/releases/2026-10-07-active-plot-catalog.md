# Aktive Grundstücksauswahl: Master, Suchgebiet und Exklusiv

## Umsetzung

Die operative Auswahl verwendet gültige Pool-A-Grundstücke aus der produktiven `KI_Grundstuecke_MASTER.xlsx`. Pool B bleibt über dieselbe plotId auf derselben Karte erhalten. „Nicht mehr vorhanden“ wird aus dem operativen Masterbestand ausgeschlossen. Beide produktiven Größenüberschriften werden unterstützt, ohne zusätzliche Excel-Spalten anzulegen.

Zwei Hauptbereiche: „Im eigenen Suchgebiet“ und „Exklusiv / außerhalb des Suchgebietes“. Geografische Untergruppen haben unabhängige, persistente Collapse-Zustände über den bestehenden Browser-Speicher. Die Regionsnamen kommen aus Suchgebiet; Berlin verwendet vorhandene Stadtteil-/Ortsangaben und die praktischen Gruppen Kladow, Staaken und Spandau. Diese Darstellung ändert keine PLZ-Mitgliedschaft.

`exclusiveOutsideTerritory` wird ausdrücklich als Boolean gespeichert und durch die vorhandenen Grundstücks- und Pool-Synchronisationswege erhalten. Fehlende Werte bleiben bei Altbeständen fehlend; damit entsteht keine automatische Katalogmigration beim Runtime-Start. Außerhalb gefundene Grundstücke benötigen die ausdrückliche Aktivierung. Eine kompakte Bearbeitungs-Auswahl erschließt nicht aktive Datensätze ohne dritte Kartenkategorie.

Die einmalige Bereinigung ist eine explizite Transaktion mit Vorschau, betroffenen Datensätzen, Änderungs-Token, Katalog-Versionskontrolle und bestehendem Lifecycle-Schutz. Sie speichert eine Freigabe und die bisherigen plotIds. Grundstücke, Projekte, Inserate, Uploadhistorien, Lösch-Batches und Evidenzdaten werden nicht gelöscht. Fehlende Altgrundstücke werden beim späteren Master-Abgleich nicht automatisch wieder exportiert. Neue Grundstücke im Suchgebiet sind danach automatisch auswählbar; externe benötigen den Exklusiv-Schalter.

Die zentrale Auswahl und die Erstellung neuer Inserate nutzen dieselbe Eligibility. Vor Bestätigung bzw. bei ungültiger Datenquelle wartet die Erstellung neuer Inserate. Die gespeicherte bisherige Auswahl bleibt bis zur Bestätigung erhalten. Der Inseratsmanager liest weiterhin sämtliche bestehenden Projekte und Listings.

## Begründung

Das vorhandene Suchgebiet ist die einzige Gebietsdefinition. Die produktive Master-Datei enthält aktuell nur Pool_A und Pool_B; solange dort kein Suchgebiet-Blatt vorhanden ist, wird das bereits von der App verwendete Blatt aus der bestehenden Eingabedatei gelesen. Existiert im Master ein ungültiges Suchgebiet, erfolgt keine Ausweichzuordnung. Es wird kein zweites Gebietssystem und kein zusätzlicher Excel-Katalog angelegt.

Die operative Freigabe ist von `isActive`, Löschlogik und Listing-Lifecycle getrennt. Dadurch werden historische Datensätze nicht durch eine Auswahlbereinigung deaktiviert oder kaskadierend gelöscht. Die erste Freigabe wird ausschließlich durch Pascal in der Haupt-App erteilt.

## Hürden und Risiken

Die produktiven Worker-Spalten heißen `Grundstücksgröße (m²)` und `Grundstückspreis (€)`; die vorhandene Master-Synchronisation akzeptierte die Größenüberschrift bislang nicht. Die zusätzliche Alias-Unterstützung erhält alle vorhandenen Pool- und Excel-Metadaten.

Eine immer ergänzte false-Eigenschaft hätte Altbestände beim Start implizit normalisiert. Die Speicherung ist deshalb optional und abwärtskompatibel. Ein Regressionstest der vorhandenen Fixed-Copy-Migration prüft weiterhin ihren bytegenauen Sicherungsweg.

Die Vorschau bindet sich an Katalog und aktuelle Quelldaten. Bei Änderungen muss sie neu geöffnet werden. Bei nicht lesbarem Master oder Suchgebiet wird kein historischer Bestand entfernt und keine neue Auswahl freigegeben. Exklusiv wird lokal gespeichert und bei Abgleichen erhalten; es wird keine neue Exklusiv-Spalte in Excel benötigt.

## Validierung und produktive Vorschau

- Fokussierte Tests: Pool-Identität, geografische Gruppen, Exklusiv, neue Grundstücke, Suche, Collapse, ausdrückliche/stabile Bestätigung und Schutz historischer Daten.
- 47 fokussierte Tests bestanden. Gesamtsuite: 703 Tests, 702 bestanden, 1 bestehender Skip, 0 Fehler. ESLint und Produktions-Build bestanden.
- Zusätzlicher TypeScript-Lauf: vier bereits vorhandene Fehler außerhalb dieser Änderung (`createVariantListing`, OpenImmo und Textgenerator); keine neuen Fehler in der Grundstücksansicht.
- Produktive Vorschau: 12 im Suchgebiet, 0 exklusiv, 112 aktive Altgrundstücke zur Ausblendung. Berlin-Zehlendorf 1, Berlin-Lichterfelde 1, Potsdam 4, Potsdam-Mittelmark 6. Kladow, Staaken, Spandau und Havelland derzeit jeweils 0 im gültigen Masterbestand.
- 127 bestehende Grundstücksdatensätze, 66 Projekte und 120 Inserate. Ein bislang nicht lokal vorhandenes Mastergrundstück wird erst bei Bestätigung ergänzt.
- Bereinigung nicht automatisch angewendet. Keine Inseratserzeugung, Uploads oder Portaländerungen während dieser Installation.
