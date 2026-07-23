# Fabian&Pascal Inseratestudio

Lokale Anwendung für die Konfiguration von bis zu 18 Haustypen und die
Erstellung von bis zu vier Inseratentwürfen je Adresse.

## Start

Unter Windows `Start-Fabian-Pascal-Inseratestudio.cmd` doppelt anklicken. Die
Anwendung öffnet sich anschließend unter `http://localhost:43181`.
Der lokale Helfer speichert heruntergeladene Importpakete zuverlässig direkt
im Windows-Ordner `Downloads`.
Große Bildbestände werden speicherschonend als kleines Inhaltsverzeichnis plus
einzelne Bilddateien gesichert; Textänderungen übertragen die Fotos nicht erneut.

## Arbeitsablauf

1. Unter **Haustypen** Hausdaten und mindestens vier bis maximal 14 Bilder
   hinterlegen. Über **Position** kann die Reihenfolge jederzeit geändert werden;
   Bild 1 ist das Titelbild. Beim Hochladen wird unter jedem Bild automatisch ein
   kurzer emotionaler Bildtext erzeugt und bleibt von Hand bearbeitbar. Grundrisse
   als solche markieren. Bereits gespeicherte Bilder können gesammelt über **Alle
   vorhandenen Bildtexte erneuern** aktualisiert werden. Anschließend **Haustypen &
   Bilder speichern** drücken. Die automatische Speicherung bleibt zusätzlich
   aktiv.
2. Unter **Adresse & Auswahl** die Grundstücksdaten erfassen und bis zu vier
   Haustypen auswählen.
3. Unter **Export & Upload** einen vollständigen OpenAI-API-Schlüssel eintragen,
   der mit `sk-` beginnt, und **Zugangsdaten prüfen & speichern** drücken. Danach
   unter **Adresse & Auswahl** die hochwertige KI-Überschrift und alle vier
   Textblöcke gemeinsam erzeugen.
   Die Überschrift besteht aus 3 bis 8 Wörtern und enthält keine Haus- oder
   Modellbezeichnung. Sie wird stattdessen kurz, klar und am konkreten
   Wohnvorteil ausgerichtet. Frühere Überschriften werden im Studio gespeichert
   und bei neuen Durchläufen ausgeschlossen. Bis zu vier parallel erzeugte
   Inserate erhalten unterschiedliche Stilrichtungen. Wiederholt sich eine
   Überschrift trotzdem zu stark, lässt das Studio diese Fassung automatisch
   neu schreiben. Der gewünschte Ton ist modern, charmant und leicht humorvoll,
   bleibt dabei aber seriös und verständlich.
4. Unter **Texte & Vorschau** Überschrift und die vier neu formulierten
   Textblöcke prüfen und bei Bedarf bearbeiten.
5. Unter **Export & Upload** das OpenImmo-Paket herunterladen oder nach einer
   ausdrücklichen Bestätigung an den Immoprofessional-FTP-Zugang übertragen.

## Getrennte Grundstücksadressen für Fabian und Pascal

Unter **Adresse & Auswahl** zuerst Fabian oder Pascal wählen. Jeder Benutzer
hat ein eigenes lokales Adressbuch. Mit **Adresse speichern** wird das aktuelle
Grundstück ausdrücklich in der Browser- und Windows-Sicherung abgelegt. Bereits
gespeicherte Adressen können anschließend über das Auswahlmenü erneut geöffnet
und für weitere Haustypen oder neue Inserattexte wiederverwendet werden. Ältere
Adressprojekte werden bei der ersten Verwendung automatisch Fabian zugeordnet.

### Adressen aus Excel importieren

Unter **Adresse & Auswahl** zuerst **Excel-Vorlage herunterladen** wählen. In der
Vorlage steht jede Grundstücksadresse in einer eigenen Zeile; in der Spalte
**Benutzer** muss Fabian oder Pascal gewählt sein. Anschließend die ausgefüllte
`.xlsx`-Datei über **Excel-Adressen importieren** einlesen. Die Adressen werden
automatisch dem getrennten Adressbuch des angegebenen Benutzers zugeordnet und
lokal gespeichert. Bereits vorhandene Adressen werden als Dubletten übersprungen;
unvollständige Zeilen zeigt das Studio direkt unter dem Importbereich an.

## Zentrales Aktionsbild

Unter **Haustypen** kann ein Aktionsbild einmal zentral hochgeladen und mit
**Für alle Haustypen verwenden** aktiviert werden. Es erscheint dann in der
Auswahl, Vorschau und im OpenImmo-Export als Bild 1 jedes Inserats. Die normalen
Hausbilder bleiben unverändert; bei bereits 14 Hausbildern wird nur das letzte
Bild im Export weggelassen. Nach dem Ausschalten verwendet jeder Haustyp wieder
sein eigenes Titelbild. Das Aktionsbild wird separat und ohne Bildduplikate in
der lokalen Browser- und Windows-Sicherung gespeichert.

Das Inseratestudio darf nur in einem Browser-Tab gleichzeitig geöffnet sein.
Ein zweiter Tab wird automatisch gesperrt, damit ältere Datenstände keine
Haustypen, Bilder oder neu erzeugten Entwürfe überschreiben können.

Die XML-Datei setzt `weitergabe_generell` auf `false` und gibt die genaue
Objektadresse nicht frei. Der erste Import muss dennoch mit einem einzelnen
Testobjekt geprüft werden, da Immoprofessional eigene Importregeln anwenden
kann.

Neue Objekte werden ohne OpenImmo-Änderungsaktion übertragen und dadurch vom
Empfänger als neue Datensätze behandelt. Die technischen Uploadschritte werden
ohne Benutzernamen oder Passwörter im lokalen Diagnoseprotokoll `upload.log`
festgehalten.

Für jedes Inserat setzt der Export automatisch das Gebiet auf **Wohngebiet**,
aktiviert **Gäste-WC** und überträgt die **Nutzfläche in m²**. Die Nutzfläche
entspricht dabei der beim Haustyp hinterlegten Wohnfläche.

## Textvorlagen

Der Textgenerator folgt dem Aufbau der bereitgestellten Exposés:
individueller Objektauftakt, Haus- und Leistungsvorteile, ausführliche Ausstattung,
standortbezogene Lage und rechtlich sauberer Beratungsabschluss. Alle Texte
werden als Klartext ohne sichtbare Markdown-Zeichen erzeugt.

Die wiederkehrenden Standardbausteine können für jeden Haustyp
ein- oder ausgeschaltet werden. Leistungs-, Garantie-, Finanzierungs- und
Förderangaben müssen vor dem Import auf ihre aktuelle Gültigkeit geprüft
werden.

Beim FTP-Upload wird jedes Inserat als eigenes, eindeutig benanntes
OpenImmo-ZIP nacheinander übertragen. Dadurch bleiben Pakete mit vielen Bildern
klein genug für den Importdienst; ein Klick überträgt weiterhin alle fertigen
Inserate des Projekts.

Der KI-Qualitätsmodus erstellt bei jedem Durchlauf eine eigenständige Fassung
mit angepasster Dramaturgie und Wortwahl. Er verwendet strukturierte Ausgaben
für Überschrift, Objektbeschreibung, Ausstattung, Lage und Sonstiges. Der
lokale Helfer prüft Mindesttiefe, Vollständigkeit, sichtbare Markdown-Zeichen,
Platzhalter, doppelte längere Absätze, formelhafte Einstiege und die
Mindestgliederung aller vier Textblöcke; eine nicht bestandene Fassung wird
einmal automatisch gezielt neu geschrieben. Frühere Texte werden dem Modell
als zu vermeidende Fassung mitgegeben. Jedes Inserat erhält zusätzlich eines
von acht Erzählprofilen, zum Beispiel Alltagsszene, Raumreise,
Zukunftsflexibilität oder Lieblingsplätze. Bei einer neuen Fassung wechselt
das Profil, damit nicht nur einzelne Wörter, sondern auch Aufbau und Perspektive
abwechslungsreich bleiben.

Standardmäßig verwendet das Studio GPT-5.6 Luna für kostengünstige Text- und
Bildauswertung. GPT-5.6 Terra und GPT-5.6 Sol bleiben im Qualitätsprofil als
manuell wählbare Optionen verfügbar. Der Wechsel des Modells verändert die
lokalen Qualitäts-, Vollständigkeits- und Adressprüfungen nicht.

OpenAI- und Immoprofessional-Zugangsdaten werden automatisch in einem separaten
lokalen Tresor gespeichert. Die Datei ist mit Windows DPAPI für das aktuell
angemeldete Windows-Benutzerkonto verschlüsselt. Die Zugangsdaten stehen nach
einem Neustart wieder zur Verfügung, werden aber weder in IndexedDB noch in
Inseratstudio-Sicherungen aufgenommen. Mit **Zugangsdaten speichern** kann die
Speicherung sofort ausdrücklich bestätigt werden; die Automatik bleibt
zusätzlich aktiv. Über **Zugangsdaten löschen** kann der Tresor geleert werden.

Bei der Texterzeugung werden als konkrete Ortsangaben ausschließlich Ort und
Ortsteil an die OpenAI API übermittelt. Straße, Hausnummer und Postleitzahl
werden weder an die Text-KI übergeben noch in einer KI-Fassung zugelassen. Eine
Fassung mit einem erkannten Straßennamen oder einer Postleitzahl wird automatisch
verworfen und neu geschrieben. Die API-Nutzung ist von einem ChatGPT-Abonnement
getrennt und kann Kosten verursachen. Kurze lokale Bildtexte bleiben als
Rückfallebene verfügbar; Inseratüberschrift und vier Textblöcke werden von der
KI erzeugt.

## Getrennte Speicherung

Die App verwendet die eigene IndexedDB-Datenbank
`fabian-pascal-inseratestudio-v1` am lokalen App-Ursprung. Zusätzlich wird der
vollständige Katalog einschließlich aller Bilder automatisch komprimiert im
lokalen Windows-Benutzerkonto gesichert. Beim Start wird die neueste intakte
Fassung geladen. Vorhandene Daten aus der früheren Datenbank werden einmalig
übernommen. Die Daten werden nicht mit deviq, Plotverium oder anderen Projekten
verbunden. Zugangsdaten liegen separat Windows-verschlüsselt.
