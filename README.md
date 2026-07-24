# Fabian&Pascal Inseratestudio

Lokale Anwendung für die Konfiguration von bis zu 25 Haustypen und die
Erstellung von bis zu vier Inseratentwürfen je Adresse.

## Start

Unter Windows `Start-Fabian-Pascal-Inseratestudio.cmd` doppelt anklicken. Die
Anwendung öffnet sich anschließend unter `http://localhost:43181`.
Der lokale Helfer speichert heruntergeladene Importpakete zuverlässig direkt
im Ordner `Downloads`.

Unter macOS `Start-Fabian-Pascal-Inseratestudio.command` doppelt anklicken. Beim
ersten Start können die Apple Command Line Tools sowie die Freigabe für iCloud
Drive erforderlich sein. Pascals Anzeigen- und Innenraumordner in iCloud Drive
werden automatisch als Medienbibliothek eingebunden.
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
   Haustypen auswählen. Dort außerdem festlegen, ob 0 bis 4 dieser Inserate ein
   Aktionsbild erhalten sollen. Die zufällige Zuordnung bleibt gespeichert und
   kann mit **Neu auslosen** bewusst geändert werden.
3. Unter **Export & Upload** einen vollständigen OpenAI-API-Schlüssel eintragen,
   der mit `sk-` beginnt, und **Zugangsdaten prüfen & speichern** drücken. Danach
   unter **Adresse & Auswahl** die hochwertige KI-Überschrift und alle vier
   Textblöcke gemeinsam erzeugen.
   Die Überschrift besteht aus 3 bis 8 Wörtern und enthält keine Haus- oder
   Modellbezeichnung. Sie wird stattdessen kurz, prägnant und am konkreten
   Wohnvorteil ausgerichtet. Frühere Überschriften werden im Studio gespeichert
   und bei neuen Durchläufen ausgeschlossen. Bis zu vier parallel erzeugte
   Inserate erhalten unterschiedliche Stilrichtungen. Wiederholt sich eine
   Überschrift trotzdem zu stark, lässt das Studio diese Fassung automatisch
   neu schreiben. Der gewünschte Ton ist modern, charmant und leicht humorvoll,
   bleibt dabei aber seriös und verständlich. Das Wort „klar“ sowie sämtliche
   Wortbildungen mit diesem Stamm sind in Überschriften ausgeschlossen.
4. Unter **Texte & Vorschau** Überschrift und die vier neu formulierten
   Textblöcke prüfen und bei Bedarf bearbeiten.
5. Unter **Export & Upload** das OpenImmo-Paket herunterladen oder nach einer
   ausdrücklichen Bestätigung an den Immoprofessional-FTP-Zugang übertragen.

## Totalabgleich für alle gespeicherten Adressen

Unter **Export & Upload** kann ein Totalabgleich für Fabian, Pascal oder beide
Adressbücher gestartet werden. Das Studio berücksichtigt alle vollständigen
Adressen des gewählten Bereichs und wählt je Adresse vier unterschiedliche,
zufällige Haustypen aus den uploadfähigen Vorlagen mit jeweils vier bis 14
Bildern. Für jedes Inserat werden eine neue Überschrift und vier neue Textblöcke
erzeugt. Jeder Totalabgleich erhält neue technische Objektkennungen.

Anschließend wird jedes Inserat als eigener OpenImmo-Import streng nacheinander
an Immoprofessional übertragen. Es gibt kein Sammelpaket. Fortschritt,
Haustypauswahl, erzeugte Inserate und bereits erfolgreiche Einzeluploads werden
nach jedem Schritt lokal gespeichert. Nach einem Fehler, Neustart oder
absichtlichen Stopp kann der Lauf fortgesetzt werden; bereits erfolgreich
übertragene Objektkennungen werden dabei übersprungen. Vorübergehende KI- und
Uploadfehler werden mit begrenzten Wiederholungsversuchen abgefangen.

Vor einem neuen Totalabgleich müssen die bisherigen Anzeigen in
Immoprofessional manuell gelöscht werden. Der Bestätigungsdialog zeigt vor dem
Start die Zahl der vollständigen Adressen und die Gesamtzahl der neuen
Inserate. Unvollständige Adressentwürfe werden nicht hochgeladen und in der
Übersicht als übersprungen ausgewiesen. Die Weitergabe an Immobilienportale
bleibt auch beim Totalabgleich deaktiviert.

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

## Aktionsbild-Pool

Unter **Haustypen** können bis zu 25 Aktionsbilder zentral hochgeladen werden.
Unter **Adresse & Auswahl** lässt sich anschließend pro Grundstück festlegen,
ob 0, 1, 2, 3 oder 4 der ausgewählten Häuser ein Aktionsbild erhalten. Das
Studio lost sowohl die Häuser als auch möglichst unterschiedliche Bilder
zufällig aus. Die Zuordnung bleibt für die Adresse und ihre Inserate gespeichert,
bis **Neu auslosen** gewählt wird. Dieselbe Regel gilt beim Totalabgleich.

Ein zugeordnetes Aktionsbild steht in Vorschau und OpenImmo-Export immer auf
Position 1. Die normalen Hausbilder bleiben unverändert gespeichert. Hat eine
Hausvorlage bereits 14 Bilder, enthält nur der Export das Aktionsbild plus die
ersten 13 Hausbilder; Bild 14 bleibt vollständig in der Hausvorlage erhalten.
Der Aktionsbild-Pool wird separat und ohne Bildduplikate in der lokalen Browser-
und Gerätesicherung gespeichert.

## Integrierter Haus- und Medienkatalog

Version 0.10.0 enthält den vollständigen operativen Katalog mit 18
Haustypen, 30 Preislisteneinträgen und 665 Originalbildern. Jeder aktive
Haustyp besitzt eine geprüfte Bildfolge mit 12 oder 13 Bildern. Die
Originaldateien liegen unter `bundled-media` und werden über Git LFS
versioniert; der für schnelle Browser-Ladezeiten optimierte Satz liegt unter
`assets/bundled-house-catalog`.

Beim Katalogabgleich werden bisherige Haustypen unsichtbar archiviert. Dadurch
bleiben ältere Inserate, Upload-Historie und ihre Bildbezüge vollständig
auflösbar, während Hausauswahl, Totalabgleich und Bildtext-Erneuerung nur noch
die 18 aktiven Haustypen verwenden. Adressprojekte, Zugangsdaten,
Aktionsbilder und Uploadprotokolle werden vom Abgleich nicht ersetzt.

Das Inseratestudio darf nur in einem Browser-Tab gleichzeitig geöffnet sein.
Ein zweiter Tab wird automatisch gesperrt, damit ältere Datenstände keine
Haustypen, Bilder oder neu erzeugten Entwürfe überschreiben können.

Die XML-Datei setzt `weitergabe_generell` auf `false` und gibt die genaue
Objektadresse nicht frei. Der erste Import muss dennoch mit einem einzelnen
Testobjekt geprüft werden, da Immoprofessional eigene Importregeln anwenden
kann.

Neue Totalabgleich-Objekte erhalten neue technische Objektkennungen. Der Export
verwendet die OpenImmo-Aktion `CHANGE`, damit Immoprofessional die jeweilige
Kennung kontrolliert anlegen oder aktualisieren kann. Die technischen
Uploadschritte werden ohne Benutzernamen oder Passwörter im lokalen
Diagnoseprotokoll `upload.log` festgehalten.

Für jedes Inserat setzt der Export automatisch das Gebiet auf **Wohngebiet**,
aktiviert **Gäste-WC** und überträgt die **Nutzfläche in m²**. Die Nutzfläche
entspricht dabei der beim Haustyp hinterlegten Wohnfläche.

Pascals Projektierungsstandardwerte aus Version **0.9.5** werden je Inserat
ergänzt, wenn dort noch kein eigener Wert gespeichert ist: gehobene
Ausstattungsqualität, Status **PROJEKTIERT**, Fußbodenheizung,
Luft-Wärmepumpe, KfW40 und KfW55, Energieklasse A++,
`provisionspflichtig=false` sowie Energieausweis-Effizienzklasse A+.
Bereits vorhandene abweichende Werte und ausdrücklich gespeicherte
Ja-/Nein-Werte bleiben unverändert. Derselbe Abgleich erfolgt beim Laden,
bei der KI-Erzeugung, beim Totalabgleich und unmittelbar vor dem Export.

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
lokalen Tresor gespeichert. Unter Windows schützt DPAPI die Daten für das
angemeldete Windows-Benutzerkonto; unter macOS liegen sie im Apple-Schlüsselbund.
Die Zugangsdaten stehen nach
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
lokalen Benutzerkonto gesichert. Beim Start wird die neueste intakte
Fassung geladen. Vorhandene Daten aus der früheren Datenbank werden einmalig
übernommen. Die Daten werden nicht mit deviq, Plotverium oder anderen Projekten
verbunden. Zugangsdaten liegen separat plattformgeschützt.
