# Änderungsprotokoll

## Schnellere Produktionspipeline – 24. Juli 2026

- Neue Totalabgleiche losen pro Adresse garantiert mindestens ein
  Einfamilienhaus, einen Bungalow und ein Zweifamilienhaus aus. Der vierte
  unterschiedliche Haustyp bleibt zufällig; anschließend wird auch die
  Reihenfolge der vier Inserate gemischt.
- Die Vorabprüfung sperrt den Totalabgleich verständlich, wenn eine dieser
  Pflichtkategorien nicht uploadfähig im aktiven Hausbestand vorhanden ist.
- Unter **Adresse & Auswahl** kann ein zuvor exportierter Excel-Bestand jetzt
  nach einer eindeutigen Sicherheitsabfrage vollständig an die Stelle des
  bisherigen Adressbestands treten. Eindeutig zugeordnete Projekte behalten
  ihre internen IDs, Inserate, Uploadverläufe und Erneuerungstermine; Haustypen,
  Bilder, Preislisten und Zugangsdaten werden nicht verändert.
- Die **Adresszentrale** mit Benutzerwahl, Excel-Werkzeugen und suchbarer
  Adresstabelle lässt sich jetzt vollständig auf- und zuklappen. Die geöffnete
  Adresse und ihre Bearbeitung bleiben darunter direkt erreichbar.
- Totalabgleich und 7-Tage-Erneuerung bereiten jetzt höchstens zwei
  KI-Inserattexte gleichzeitig vor. Der Puffer bleibt bewusst auf zwei
  Inserate begrenzt, damit bei einem Stopp nicht unnötig viele kostenpflichtige
  Texte vorproduziert werden.
- Die Übertragung an Immoprofessional bleibt strikt seriell: Auch während die
  nächsten Texte entstehen, wird immer nur ein einzelnes OpenImmo-Paket
  übertragen. Reihenfolge, Objekt-IDs und gespeicherte Aktionsbilder bleiben
  stabil.
- **Aufträge & Fehler** zeigt live beide KI-Plätze, den einzelnen Uploadplatz,
  wartende und uploadbereite Inserate sowie eine Restzeit.
- OpenAI-Ein- und Ausgabetokens werden einschließlich interner
  Qualitätswiederholungen pro Inserat gespeichert. Daraus zeigt das Studio die
  bisher gemessenen API-Kosten und eine geschätzte Gesamtsumme in US-Dollar.
- Zeit- und Kostenhochrechnungen verwenden ab drei Messungen die Daten des
  aktuellen Laufs; davor gelten bewusst konservative Sicherheitswerte. Die
  Standard-API-Preise für Luna, Terra und Sol sind mit Stand 24. Juli 2026
  hinterlegt.
- Beim sicheren Anhalten starten weder weitere KI-Aufträge noch weitere
  Uploads. Höchstens zwei bereits laufende Texte werden noch abgeschlossen und
  als uploadbereit oder fehlgeschlagen gespeichert.
- Die Anwendungsversion auf **0.12.0** angehoben.

## Auftrags- und Fehlerzentrum – 24. Juli 2026

- Einen eigenen Arbeitsbereich **Aufträge & Fehler** ergänzt. Dort sind Status,
  Adresse, Benutzer, Haustyp, Objekt-ID, Arbeitsschritt, Protokollschritte und letzter
  Zeitpunkt für jedes Inserat eines Totalabgleichs oder einer
  7-Tage-Erneuerung sichtbar.
- Die Verarbeitung ist jetzt pro Inserat abgesichert. Fehler bei KI-Text,
  Vorbereitung oder Übertragung betreffen nur das einzelne Inserat; alle
  übrigen Inserate und Adressen laufen weiter.
- **Nur fehlgeschlagene erneut übertragen** wiederholt ausschließlich rote
  Fehler desselben Laufs. Bereits erfolgreiche Objekt-IDs werden sicher
  übersprungen; vorhandene Texte, Bilder, Haustypen und Objekt-IDs bleiben bei
  einem reinen Uploadfehler erhalten.
- Unterbrochene Übertragungen werden vorsichtshalber als **Eingang prüfen**
  markiert. Erst nach einer manuellen Kontrolle in Immoprofessional können sie
  zur Wiederholung freigegeben werden, damit keine doppelte Anzeige entsteht.
- Ein Lauf endet mit einer verständlichen Zusammenfassung als abgeschlossen,
  pausiert oder mit Fehlern. Eine Adresse erhält erst nach vier erfolgreichen
  Einzeluploads einen neuen Sieben-Tage-Termin.
- Die letzten 30 Läufe bleiben als leichtes Protokoll gespeichert. Die Historie
  enthält keine Bilder, Inserattexte oder Zugangsdaten.
- Die Anwendungsversion auf **0.11.0** angehoben.

## Zentrale Vorabprüfung – 24. Juli 2026

- Vor Einzelupload, Totalabgleich und 7-Tage-Erneuerung erscheint jetzt eine
  gemeinsame Vorabprüfung mit den sechs Bereichen **Flächen**, **Preise**,
  **Hausnummern & Adressen**, **Bilder**, **Zugangsdaten** und **Dubletten**.
- Alle gefundenen Probleme werden gesammelt angezeigt. Blocker sperren den
  jeweiligen Startknopf; reine Hinweise bleiben sichtbar, verhindern einen
  sicheren Lauf aber nicht.
- Die Prüfung berücksichtigt immer den tatsächlichen Arbeitsumfang: beim
  Einzelupload die aktuelle Adresse und ihre Inserate, beim Totalabgleich das
  gewählte Adressbuch und bei der 7-Tage-Erneuerung genau die ausgewählten
  Adressen.
- Gleiche echte Adressen werden auch zwischen Fabian und Pascal erkannt.
  Straßenvarianten wie `Str.`, `Straße` und `Strasse` sowie Hausnummern mit
  abweichenden Leerzeichen werden dabei vereinheitlicht. Zusätzlich werden
  doppelte Objekt-IDs gemeldet.
- Verwendete Haustypen benötigen einen Hauspreis sowie vier bis 14 tatsächlich
  lesbare Bilder. Unvollständige, aber nicht benötigte Vorlagen erscheinen nur
  als Hinweis und werden für neue Läufe nicht ausgelost.
- Vorhandene Daten werden durch die Prüfung weder gelöscht noch
  zusammengeführt. Direkt beim Start wird derselbe Prüfbericht erneut
  ausgewertet, damit kein zwischenzeitlich entstandener Fehler übersehen wird.

## Suchbare Adresstabelle – 24. Juli 2026

- Das lange Adressmenü durch eine gemeinsame Tabelle für Fabian und Pascal
  ersetzt; 25, 50 oder 100 Einträge können pro Seite angezeigt werden.
- Kombinierbare Suche und Filter für Projekt/Straße, Ort, PLZ, Benutzer,
  Vollständigkeit und letzten Upload ergänzt.
- Die Tabelle zeigt Grundstücksfläche, konkret fehlende Pflichtfelder und nur
  tatsächlich gespeicherte Uploadzeitpunkte. Das Erstellungsdatum wird nicht als
  Uploaddatum ausgegeben.
- **Öffnen** schaltet Benutzer und Projekt gemeinsam um, damit auch bei einem
  Wechsel zwischen Fabian und Pascal immer die richtige Adresse bearbeitet wird.

## 7-Tage-Arbeitszentrale – 24. Juli 2026

- Einen eigenen Arbeitsbereich mit den Kategorien **Heute fällig**,
  **Demnächst** und **Überfällig** ergänzt; Fabian, Pascal oder beide
  Adressbücher sind direkt filterbar.
- Fällige vollständige Adressen können einzeln, gruppenweise oder gesammelt
  ausgewählt und mit jeweils vier neuen Inseraten erneuert werden.
- Die Erneuerung schließt die vier aktuell verwendeten Haustypen aus und
  erzeugt neue Haus- und Aktionsbilder, KI-Texte, Überschriften sowie neue,
  bei Pause und Fortsetzung stabile Objekt-IDs.
- Straße, Hausnummer, PLZ, Ort, Ortsteil, Grundstücksfläche,
  Grundstückspreis, Nebenkosten und Lageangaben werden je Lauf eingefroren.
  Bei einer Abweichung hält der Lauf vor dem Upload sicher an.
- Die Arbeitszentrale speichert Teilfortschritte nach jedem Einzelupload. Erst
  nach vier erfolgreichen Uploads beginnt für die Adresse ein neuer
  Sieben-Tage-Zyklus.
- Normale Einzeluploads protokollieren erfolgreiche Objekt-IDs und setzen bei
  einer vollständigen Vierergruppe ebenfalls den nächsten Erneuerungstermin.
- Altadressen ohne verlässliches Uploaddatum werden offen als **Heute fällig ·
  Uploaddatum fehlt** angezeigt. Es wird kein historisches Datum geraten.
- Bisherige Objekt-IDs bleiben sichtbar und werden in einer kompakten
  Erneuerungshistorie bewahrt. Vor dem Start muss ihre Löschung in
  Immoprofessional ausdrücklich bestätigt werden.

## Automatische Portalveröffentlichung – 24. Juli 2026

- Unter **Export & Upload** kann jetzt sichtbar zwischen **Nur Import** und
  **Automatisch online** gewählt werden.
- Im Veröffentlichungsmodus erlaubt das OpenImmo-Paket mit
  `weitergabe_generell=true` die Weitergabe an die in Immoprofessional
  verbundenen Portale. Die genaue Objektadresse bleibt mit
  `objektadresse_freigeben=false` weiterhin verborgen.
- Einzelupload und Totalabgleich zeigen vor dem Start eine eindeutige Warnung.
  Der Modus wird in einem Totalabgleich fest gespeichert und kann bei einer
  Fortsetzung nicht unbemerkt wechseln.
- Bestehende Sicherungen und Läufe ohne diese Einstellung bleiben aus
  Sicherheitsgründen im Modus **Nur Import**.

## Aktionsbilder im Totalabgleich – 24. Juli 2026

- Im Totalabgleich dieselbe gut sichtbare Auswahl **0, 1, 2, 3 oder 4**
  ergänzt.
- Die gewählte Zahl gilt für jede vollständige Adresse des neuen Laufs. Bei
  **4 – Alle vier** erhält jedes der vier Inserate pro Adresse ein eigenes,
  zufällig ausgewähltes Aktionsbild auf Position 1.
- Die Einstellung wird im Lauf gespeichert und bleibt bei Anhalten, Neustart
  und Fortsetzen unverändert. Die Einzeladress-Einstellungen werden nicht
  überschrieben.

## Sichtbare Aktionsbild-Auswahl je Adresse – 24. Juli 2026

- Die bisher weit unten angeordnete Auswahlliste durch fünf große Schaltflächen
  direkt unter der gewählten Grundstücksadresse ersetzt.
- Für jede Adresse lässt sich nun unübersehbar **0, 1, 2, 3 oder 4** wählen.
  Die Auswahl legt fest, wie viele der vier Inserate ein zufälliges Aktionsbild
  auf Position 1 erhalten.
- Die gewählte Zahl, der verfügbare Aktionsbild-Pool und die spätere Zuordnung
  zu den ausgewählten Häusern werden getrennt und verständlich angezeigt.

## Excel-Bestandsdownload – 24. Juli 2026

- Unter **Adresse & Auswahl** den Button **Bestand als Excel herunterladen**
  ergänzt.
- Die erzeugte `.xlsx`-Datei enthält den vollständigen Adressbestand, eine
  Bestandsübersicht, alle erzeugten Inserate sowie aktive und archivierte
  Haustypen.
- Grundstücksflächen und Hausgrößen bleiben echte Zahlen; Grundstücks-,
  Haus- und Gesamtpreise werden als Euro-Werte formatiert. Kopfzeilen sind
  fixiert und alle großen Tabellen können direkt in Excel gefiltert werden.
- Die erste Tabelle entspricht weiterhin dem Adressimport. Ein exportierter
  Bestand kann deshalb später wieder über **Excel-Adressen importieren**
  eingelesen werden.
- Zugangsdaten und Bilddateien werden bewusst nicht in die Excel-Datei
  geschrieben.

## Vollständiger Medien- und Preiskatalog – 24. Juli 2026

- Pascals neuen GitHub-Medienstand vollständig übernommen: 665 Originalbilder
  in `bundled-media`, versioniert über Git LFS.
- Den unter macOS zulässigen, unter Windows ungültigen Dateinamen
  `Deine 5* Küche.jpg` Windows-sicher als `Deine 5 Sterne Küche.jpg`
  integriert und ein unsichtbares Leerzeichen am Ordner `Sun 130` entfernt.
- Alle 18 Haustypen gegen den neuen Bestand geprüft. Sie erhalten jeweils 12
  oder 13 Bilder ohne fehlende Titelbilder, Grundrisse oder Bildrollen.
- Die 61 tatsächlich verwendeten Bilder als 9,5 MB große WebP-Dateien
  vorbereitet, damit der Browserkatalog nicht erneut an zu großen
  Base64-Zeichenketten scheitert.
- Die vollständige neutrale Preisliste mit 30 Modellen in Schritt 1 sichtbar
  gemacht und SUN 113 mit 355.122 €, 106,15 m², vier Zimmern und drei
  Schlafzimmern ergänzt.
- Die Anwendungsversion auf 0.10.0 angehoben. Windows-Speicherung,
  25-Haustypen-Grenze, Aktionsbilder und Totalabgleich bleiben erhalten.
- Den gezielt installierten Gerätekatalog beim Laden priorisiert, damit ein
  älterer Browser-Speicherstand die neuen Haustypen nicht zurückrollen kann.
- Archivierte Historienbilder bleiben vollständig in der Gerätesicherung,
  werden aber nicht mehr beim Start als mehrere hundert Megabyte Base64 in den
  Browser geladen. Aktive Haus- und Aktionsbilder werden dabei dedupliziert.
- Grundstücksadressen, Zugangsdaten, Upload-Historie und bestehende Inserate
  gehören weiterhin ausschließlich zum lokalen Gerätekatalog und nicht zu
  GitHub.
