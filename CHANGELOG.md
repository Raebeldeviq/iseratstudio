# Änderungsprotokoll

## Ergänzende Projektierungsstandardwerte – 24. Juli 2026

### Report

- Die Standardwerte für Immoprofessional-Projektierungen zentral in
  `IMMOPROFESSIONAL_DEFAULTS` zusammengeführt und eine gemeinsame,
  ergänzende Normalisierung ergänzt.
- Neue und automatisch erzeugte Inserat-Projektierungen erhalten gehobene
  Ausstattungsqualität, den Status `PROJEKTIERT`, Fußbodenheizung,
  Luft-Wärmepumpe, KfW40 und KfW55, Energieklasse A++, keine
  Provisionspflicht sowie die GEG-2022-Effizienzklasse A+.
- Bereits gespeicherte Projektierungen werden beim Laden nur vervollständigt.
  Leere Werte und „keine Angabe“ erhalten den Standard; vorhandene Texte sowie
  explizite Wahr-/Falsch-Werte bleiben unverändert.
- Den OpenImmo-Export auf dieselbe Normalisierung umgestellt. Die
  GEG-Effizienzklasse wird standardkonform als `energiepass/wertklasse`
  übertragen; die separate Immoprofessional-Energieklasse bleibt davon
  unabhängig. Anwendungsversion auf 0.9.5 angehoben.

### Begründung

Eine einzige Konfiguration verhindert abweichende Werte zwischen Erzeugung,
lokaler Wiederherstellung und Export. Die Einstellungen liegen je Inserat,
damit künftig unterschiedliche Benutzerwerte innerhalb desselben
Grundstücksprojekts erhalten bleiben können. Die erneute Ergänzung unmittelbar
vor dem Export schützt zugleich ältere lokale Sicherungen mit noch fehlenden
Feldern.

### Hürden und Risiken

- Immoprofessional unterscheidet die allgemeine Energieklasse A++ von der
  Energieeffizienzklasse des Energieausweises. Deshalb wird A++ als benanntes
  Immoprofessional-Zusatzfeld und A+ im OpenImmo-Energiepass ausgegeben.
- Der bestehende feste Courtage-Hinweis bleibt unverändert, obwohl
  `provisionspflichtig` bei fehlender Angabe nun wie gefordert auf `false`
  gesetzt wird. Damit wird kein bisher vorgeschriebener Freitext verändert.
- Alle übrigen Energieausweisfelder, Ausstattungsmerkmale, Texte und Abläufe
  bleiben technisch unverändert.

## Dauerhaft sichtbare Versionsanzeige – 23. Juli 2026

### Report

- Eine kleine, fest positionierte Versionsanzeige unten rechts ergänzt. Sie ist
  im Ladebildschirm, bei einem doppelten Tab und in allen vier Arbeitsschritten
  dauerhaft sichtbar.
- Die Versionsnummer für Oberfläche und OpenImmo-Export in einer gemeinsamen
  Konstante zusammengeführt und die Anwendung auf Version 0.9.4 angehoben.

### Begründung

Die Anzeige macht bei Rückfragen und Fehlersuche unmittelbar erkennbar, welcher
Build tatsächlich geöffnet ist. Die zentrale Versionsquelle verhindert, dass
Browseranzeige und `senderversion` im OpenImmo-Paket voneinander abweichen.

### Hürden und Risiken

- Die Anzeige muss über langen Formularen sichtbar bleiben, darf aber keine
  Schaltflächen blockieren. Sie ist deshalb sehr klein, halbtransparent und
  nimmt keine Maus- oder Touch-Eingaben entgegen.

## Einheitliche Überschrift und regionale Excel-Adressbücher – 23. Juli 2026

### Report

- Die Überschrift aus Schritt 2 nach jeder KI-Antwort nochmals lokal erzwungen.
  Schritt 3 kann dadurch keine abweichende Kurzfassung eines älteren
  Helferprozesses mehr übernehmen und kennzeichnet das Feld ausdrücklich als
  **unverändert aus Schritt 2**.
- Einen lokalen deutschen PLZ-Datensatz integriert. Beim Excel-Import werden
  Bundesland und Landkreis aus PLZ plus Ort ermittelt, in den Grundstücksdaten
  angezeigt und im Adresswähler als Gruppen dargestellt.
- Adressen innerhalb der Bundesland-/Landkreis-Gruppen nach PLZ, Ort und Straße
  sortiert. Mehrdeutige Zuordnungen bleiben sichtbar unzugeordnet, statt durch
  eine Schätzung falsch einsortiert zu werden.
- GeoNames-Quelle und CC-BY-4.0-Lizenz dokumentiert; Anwendungsversion auf
  0.9.3 angehoben.

### Begründung

Die verbindliche Überschrift entsteht deterministisch in der Anwendung und
muss in jedem Arbeitsschritt sowie im späteren OpenImmo-Paket identisch sein.
Die Regionszuordnung wird als mitgelieferte Offline-Tabelle ausgeführt, damit
beim Excel-Import keine Grundstücksadressen an einen externen Geodienst
übertragen werden. PLZ und Ort werden gemeinsam geprüft, weil einzelne PLZ in
Deutschland mehrere Orte oder Verwaltungsgebiete umfassen können.

### Hürden und Risiken

- GeoNames stellt die Daten ohne Gewähr bereit. Unklare Kombinationen aus PLZ
  und Ort werden deshalb nicht automatisch einem Landkreis zugeschlagen.
- Bereits gespeicherte Projekte werden beim Laden nachträglich zugeordnet.
  Werden PLZ oder Ort manuell geändert, verwirft die App die bisherige Region;
  beim nächsten Laden erfolgt eine neue Prüfung mit der Offline-Tabelle.
- Die gewünschte 12-Tage-Wiederholungsautomatisierung wurde bewusst nicht
  implementiert; dazu wurde nur ein sicherer Lösungsansatz beschrieben.

## Direkt befüllte Inseratfelder im Grundstücksschritt – 23. Juli 2026

### Report

- Die im Screenshot gezeigte Grundstücksseite so umgebaut, dass Call-to-Action,
  Ausstattung, Sonstiges, Provision, Anmerkung, AGB und Empfehlungstext dort
  sofort vollständig in vergrößerten Feldern stehen.
- Die bisherigen leeren Zusatzfelder für Lage, Verkehr, Versorgung, Natur und
  Hinweise in einen optionalen, standardmäßig geschlossenen Bereich verschoben.
  Bereits vorhandene Inhalte bleiben gespeichert und werden weiterhin genutzt.
- Nach der Hausauswahl zeigt die Seite nur noch die tatsächlich individuellen
  Elemente Überschrift, Objektbeschreibung und Lage je Haus.
- Die KI-Antwort technisch von fünf auf genau zwei Felder reduziert:
  Objektbeschreibung und Lage. Überschrift und alle festen Texte werden nicht
  mehr vom Modell angefordert. Anwendungsversion auf 0.9.2 angehoben.

### Begründung

Das vorgeprüfte Grundstück ist der feste Ausgangspunkt. Deshalb müssen leere
optionale Eingabeflächen den Arbeitsfluss nicht dominieren. Die festen Texte
sind sofort kontrollierbar und die KI verarbeitet nur noch die beiden wirklich
variablen Themen. Das verkürzt Anfrage und Prüfung und verhindert zugleich,
dass vorgeschriebene Formulierungen durch eine Modellantwort verändert werden.

### Hürden und Risiken

- Objektbeschreibung und Lage bleiben je Haus beziehungsweise Ort individuell;
  sie können erst nach einer konkreten Hausauswahl sinnvoll erzeugt werden.
- Zusätzliche Lagefakten werden nur genutzt, wenn sie bereits gespeichert sind
  oder der optionale Bereich bewusst geöffnet und ergänzt wird. Fehlende Fakten
  werden weiterhin nicht erfunden.

## Textvorschau im zweiten Schritt – 23. Juli 2026

### Report

- Unter **Adresse & Auswahl** eine vollständige Textvorschau für jeden
  ausgewählten Haustyp ergänzt. Die erste Vorschau ist geöffnet; weitere Häuser
  lassen sich platzsparend aufklappen.
- Überschrift, Objektbeschreibung, Ausstattung, Lage, Sonstiges, fester
  Call-to-Action, Provision, Anmerkung, AGB und Empfehlungstext bereits vor der
  KI-Erzeugung sichtbar gemacht.
- Bestehende Inserate beim Laden und unmittelbar vor dem Export auf leere
  Textfelder geprüft. Nicht leere individuelle Inhalte bleiben erhalten;
  fehlende dynamische Inhalte erhalten eine lokale Vorbelegung und feste Felder
  die freigegebenen Standardtexte.
- Den lokalen Lage-Rückfall neutral formuliert, ohne fehlende Quelldaten im
  später sichtbaren Inserat zu thematisieren. Anwendungsversion auf 0.9.1
  angehoben.

### Begründung

Die Texte sind damit bereits im zweiten Arbeitsschritt transparent und können
vor der kostenpflichtigen KI-Erzeugung kontrolliert werden. Eine gemeinsame
Vervollständigungsfunktion wird beim Laden, in der Vorschau und beim Export
verwendet. Dadurch entsteht kein Unterschied zwischen sichtbarer Vorbelegung
und tatsächlich übertragenem Inhalt.

### Hürden und Risiken

- Lage-, Verkehrs- und Versorgungsdaten werden weiterhin nicht erfunden. Fehlen
  bestätigte Angaben, verwendet die lokale Vorbelegung ausschließlich einen
  neutralen Orts- beziehungsweise Ortsteiltext.
- Die lokale Vorbelegung ersetzt nicht die individuelle KI-Fassung. Nach der
  Erzeugung bleiben Objektbeschreibung und Lage im dritten Schritt prüf- und
  bearbeitbar.

## Verbindliche Inserattexte und Immoprofessional-Merkmale – 23. Juli 2026

### Report

- Überschriftenformat auf emotionalen Einstieg plus Ort/Ortsteil, gerundete
  Wohnfläche, Zimmerzahl und zwei Vorteile aus der Living-Haus-Checkliste
  umgestellt.
- Objektbeschreibung als individuelle, emotionalere KI-Fassung umgesetzt und
  den vorgegebenen Telefon-Call-to-Action idempotent als festen Abschluss
  ergänzt.
- Ausstattung und Sonstiges wortgetreu zentral hinterlegt. Provision,
  Anmerkung, Allgemeine Geschäftsbedingungen und freier Empfehlungstext als
  weitere geschützte Pflichttexte in Vorschau und OpenImmo-Export aufgenommen.
- OpenImmo-Ausstattung um Dachboden, Gäste-WC, Gartennutzung,
  Fußbodenheizung, Elektro/Luft-Wärmepumpe, KFW40, KFW55, Energieklasse A++,
  offene Einbauküche sowie Bad mit Dusche, Wanne und Fenster ergänzt.
- Provision über die OpenImmo-Standardfelder `provisionspflichtig` und
  `courtage_hinweis` übertragen; die drei Immoprofessional-Zusatztexte als
  benannte `user_defined_simplefield`-Felder im Freitextblock ergänzt.
- Vorhandene Kataloge werden beim Laden auf die festen Energie- und
  Heizungswerte migriert. Anwendungsversion auf 0.9.0 angehoben.

### Begründung

Die dynamischen Inhalte und die rechtlich beziehungsweise vertrieblich
vorgegebenen Inhalte sind jetzt technisch getrennt. Die KI erhält nur die
Aufgabe, Hausgefühl und Lage individuell zu formulieren; eine zentrale
Nachbearbeitung setzt Überschrift und Pflichttexte deterministisch ein. Dieselbe
Nachbearbeitung läuft erneut beim Export, damit manuelle Änderungen oder ältere
lokale Entwürfe keine Pflichtangabe entfernen können. Die Ausstattungsmerkmale
verwenden die dafür vorgesehenen OpenImmo-1.2.7-Elemente und deren definierte
Reihenfolge.

### Hürden und Risiken

- KFW40 und KFW55 werden auf ausdrückliche Vorgabe gleichzeitig übertragen.
  Ob ein angeschlossenes Immobilienportal beide Werte gemeinsam darstellt,
  entscheidet dessen Importprofil.
- Immoprofessional dokumentiert die kontospezifische Zuordnung seiner drei
  zusätzlichen Freitextmasken nicht öffentlich. Die Daten werden
  standardkonform als benannte OpenImmo-Erweiterungsfelder geliefert; ihre
  konkrete Zuordnung muss beim ersten nicht veröffentlichten Testimport im
  Importbericht kontrolliert werden.
- Förderbedingungen können sich ändern. Überschriften verwenden deshalb
  Checklisten-Vorteile und QNG-Potenzial ohne aktuelle Fördersumme oder
  individuelle Förderzusage.
- Die gelieferten Pflichttexte enthalten bewusst die vom Auftraggeber
  vorgegebenen Schreibweisen. Sprachliche oder rechtliche Änderungen erfolgen
  nur nach ausdrücklicher fachlicher Freigabe.

## Fertiger 18-Häuser-Startkatalog – 23. Juli 2026

### Report

- 18 sofort nutzbare Hausvorlagen aus der freigegebenen iCloud-Bibliothek
  zusammengestellt: die bestätigten 14 SUN-Modelle sowie SOL 101, SOL 107,
  SOL 110 und SUN 113.
- Für jede Vorlage eine konkrete Hausansicht mit LivingHaus-Logo, sechs
  Innenraummotive, emotionalen Catch, versionsgenaue Grundrisse,
  Auszeichnungen, Vertrauensmotiv und QR-Abschluss hinterlegt.
- Zimmer, Schlafräume, Bäder und Etagen anhand der ausgewählten Grundrisse
  modellgenau erfasst. SOL 101, SOL 107 und SOL 110 verwenden als Bungalows nur
  das Erdgeschoss; alle SUN-Vorlagen enthalten Erd- und Ober-/Dachgeschoss.
- Die bestätigten Modellpreise automatisch übernommen. SUN 113 bleibt mit
  Hauspreis 0 bewusst offen, weil dafür keine belastbare Preisquelle vorliegt.
- Eine abgesicherte Katalogmigration ergänzt, die ausschließlich die beiden
  leeren Startplatzhalter ersetzt. Echte Haustypen werden nicht überschrieben;
  Anbieter-, Projekt-, Aktionsbild- und Schlüsselbunddaten bleiben erhalten.
- Optimistische Versionsprüfung für die macOS-Katalogsicherung ergänzt. Ein
  noch geöffneter alter Browser-Tab erhält HTTP 409 und kann einen inzwischen
  neueren Gerätekatalog weder beim Helfer-Neustart noch während eines parallelen
  Speichervorgangs überschreiben.
- Gemeinsame Bilder werden nur einmal in der lokalen Gerätesicherung abgelegt
  und beim Laden dedupliziert. Anwendungsversion auf 0.8.0 angehoben.

### Begründung

Die Vorlagen werden deterministisch aus exakten, versionsbezeichneten
Quelldateien aufgebaut. Damit stimmen Titelbild, Grundriss und Bildreihenfolge
bereits beim ersten Öffnen überein. Stabile Bild-IDs vermeiden unnötige Kopien
der wiederverwendeten Innenraum- und Vertrauensmotive. Die Migration arbeitet
gegen die bestehende Gerätesicherung, damit Zugangskonfiguration und Projekte
nicht neu eingerichtet werden müssen.

### Hürden und Risiken

- Mehrere Hausansichten liegen doppelt im Übersichts- und Modellordner. Für den
  Katalog wird bewusst die eindeutige Übersichtsversion verwendet; der
  Grundriss wird weiterhin über Modell, Version, Dachform und Etage ermittelt.
- SUN 113 besitzt im gelieferten Preisausschnitt keinen Preis. Vor einem
  produktiven Inserat muss dieser Wert fachlich ergänzt werden.
- Die 61 eindeutigen Bilddateien belegen lokal rund 110 MB. Die Originale
  bleiben unverändert in iCloud; die App-Sicherung erhält eine eigene Kopie.
- Die automatische Migration verweigert den Lauf, sobald ein nicht leerer
  Haustyp im Zielkatalog erkannt wird. Das schützt vorhandene Nutzerdaten,
  erfordert bei späteren individuellen Katalogen jedoch eine bewusste manuelle
  Zusammenführung.
- Beim ersten Kaltstarttest überschrieb ein noch offener Browser-Tab den frisch
  installierten Katalog, sobald der lokale Helfer wieder erreichbar war. Die
  Speicherung verlangt deshalb jetzt den zuletzt gelesenen Sicherungszeitpunkt
  und prüft ihn vor Vorbereitung und Commit erneut.

## Zertifikatskonformer Immoprofessional-Host – 23. Juli 2026

### Report

- Standardhost für explizites FTPS auf `server22.immoprofessional.eu`
  umgestellt.
- Die bisherigen Hosts `fabianraebel.livinghaus.info` und
  `pascalfroehlich.livinghaus.info` werden beim Laden, Prüfen und Speichern
  automatisch auf den kanonischen Host migriert.
- Zugangstest normalisiert die Zielkonfiguration jetzt vor dem TLS-Aufbau. Damit
  kann eine erneut eingetragene Altadresse den Zertifikatsfehler nicht mehr
  auslösen.
- Oberfläche erläutert den korrekten Host; Zertifikatskette und Hostname werden
  weiterhin strikt geprüft. Es wurde keine unsichere Ausnahme ergänzt.
- Anwendungsversion auf 0.7.1 angehoben.

### Begründung

Beide LivingHaus-Aliase zeigen auf `82.165.70.71`, deren kanonischer
Reverse-DNS-Name `server22.immoprofessional.eu` ist. Der Server liefert ein
gültiges Zertifikat ausschließlich für `*.immoprofessional.eu` und
`immoprofessional.eu`. Der kanonische Name zeigt auf dieselbe IP und entspricht
dem Zertifikat. Eine Hostmigration löst deshalb den Fehler, ohne die
TLS-Sicherheitsprüfung abzuschwächen.

### Hürden und Risiken

- Eine Verbindung über den bisherigen Alias erreicht technisch den richtigen
  Server, muss aber wegen des fehlenden Zertifikatsnamens abgewiesen werden.
- Der zuvor fehlgeschlagene Zugangstest wurde absichtlich nicht gespeichert.
  Benutzername und Passwort müssen einmal mit dem neuen Host geprüft und danach
  im macOS-Schlüsselbund gespeichert werden.
- TLS-Aufbau, Zertifikatskette, Hostname und Serveridentität sind technisch
  verifiziert. Anmeldung und Zielordner lassen sich erst mit dem konkreten
  Immoprofessional-Zugang vollständig bestätigen.
- Falls Immoprofessional den Server künftig verlegt, muss der offiziell
  zugewiesene, zertifikatsgedeckte Host erneut geprüft werden.

## Modellbasierter Hauspreiskatalog – 23. Juli 2026

### Report

- 29 bereitgestellte Hauspreise für Bungalows, Einfamilienhäuser,
  Doppelhaushälften und Zweifamilienhäuser als geprüften lokalen Katalog
  hinterlegt.
- Bildversionen V1, V2, V3 usw. aus der Preisidentifikation entfernt. SUN 126
  und SUN 165 verwenden modellweit den bestätigten niedrigeren Listenpreis von
  365.073 € beziehungsweise 426.931 €.
- L und XL bei SOL 117 und SOL 125 als eigenständige Preismodelle umgesetzt.
  Die App verwendet bei generischen Titelbildern die genauere L-/XL-Kennung der
  zugeordneten Grundrisse.
- Hauspreis und Objektart werden beim Erstellen einer vollständigen Bildfolge
  automatisch gesetzt. Bei manueller Änderung zeigt die Hausmaske den
  erkannten Listenwert und bietet eine kontrollierte Wiederübernahme an.
- Unbekannte oder mehrdeutige Modelle werden nicht geschätzt; ihr bestehender
  Hauspreis bleibt unverändert.
- Reale Bibliothek geprüft: 65 der 71 vollständig verwendbaren Bildvarianten
  erhalten einen Preis für 26 aktuell vorhandene Katalogmodelle. Für sechs
  Bildvarianten wurde kein Preis geliefert; sie bleiben bewusst offen.
- Anwendungsversion auf 0.7.0 angehoben.

### Begründung

Der Preis wird nicht an eine austauschbare Visualisierung, sondern an das
fachliche Hausmodell gebunden. Ein eigener, getesteter Resolver entfernt
Dachform- und Versionsangaben, wertet L/XL aber weiterhin als Bestandteil des
Modells. Dadurch erhalten beispielsweise alle SUN-126-Bildvarianten denselben
Preis, während SOL 125 L und SOL 125 XL nicht vermischt werden.

### Hürden und Risiken

- SUN 126 und SUN 165 waren in der Quelle jeweils doppelt mit unterschiedlichen
  Grundrissausführungen und Preisen vorhanden. Nach ausdrücklicher Freigabe ist
  jeweils der niedrigere Preis hinterlegt.
- Die Titelbilder von SOL 124 und SOL 125 tragen teilweise keine L-/XL-Kennung.
  Für die Zuordnung werden deshalb die bereits versionsgenau ausgewählten
  Grundrissdateien mit ausgewertet.
- Für SUN 107, SUN 112, SUN 113 und SUN 155 liegt im bereitgestellten Ausschnitt
  kein Hauspreis vor. Diese Werte werden weder abgeleitet noch durch ähnliche
  Modelle ersetzt.
- Der Katalog bildet den bereitgestellten Preisstand ab und aktualisiert sich
  nicht selbst. Neue Preislisten müssen vor produktiver Nutzung fachlich
  abgeglichen und versioniert eingepflegt werden.

## Automatische Exposé-Bildfolge – 23. Juli 2026

### Report

- Elf vorhandene Beispiel-Exposés visuell auf Bildauswahl, Reihenfolge und
  wiederkehrende Beschriftungen geprüft.
- Rollenbasierte Standardfolge aus Hausansicht, sechs unterschiedlichen
  Innenräumen, emotionalem Catch, versionsgenauen Grundrissen, Auszeichnungen,
  Vertrauensmotiv und QR-Abschluss implementiert.
- Aktionsmodus beibehalten: Aktionsbild an Position 1, Hausansicht an Position 2;
  bei mehr als 14 Gesamtbildern blockiert die Prüfung, ohne ein Bild zu löschen.
- SUN-/SOL-Modell, Version, Dachform und Etage aus den bestehenden Dateinamen
  ermittelt. Grundrisse werden immer als EG vor OG/DG und optionaler dritter
  Etage eingeordnet.
- SOL 82, SOL 101, SOL 107 und SOL 110 als reine EG-Bungalows berücksichtigt.
- Die Einrichtungsmotive aus `01_RENDERING/Inneneinrichtung` direkt in die
  Medienbibliothek aufgenommen; Bad und Büro werden aus `04_ANZEIGEN` ergänzt.
- Feste Überschriften gegen manuelle und KI-gestützte Überschreibung geschützt.
  Nur der Titeltext und die Reihenfolge innerhalb der sechs Innenräume bleiben
  variabel.
- Rolle, Vollständigkeit, Duplikate, Reihenfolge und 14-Bilder-Grenze werden vor
  dem OpenImmo-Paket geprüft. Manuell importierte Altbestände bleiben kompatibel.
- Reale Bibliothek mit 665 unterstützten Dateien geprüft: 71 der 79
  Hausansichten im Übersichtsordner ergeben direkt eine vollständige Folge.
  Sieben Varianten werden wegen fehlender exakter Grundrisse sicher blockiert;
  `SUN V8.png` wird wegen der fehlenden Modellnummer abgewiesen.
- Anwendungsversion auf 0.6.0 angehoben.

### Begründung

Explizite Bildrollen sind belastbarer als eine reine Sortierung nach
Dateinamen. Die Dateinamen bleiben die Quelle für die automatische Erkennung,
die erkannte Rolle wird anschließend jedoch mit dem Haustyp gespeichert und
beim OpenImmo-Export erneut geprüft. Damit bleibt die gewünschte Reihenfolge
auch nach manuellen Änderungen stabil. Bei uneindeutigen oder fehlenden
Grundrissen wird bewusst keine vermeintlich ähnliche Version eingesetzt.

### Hürden und Risiken

- Der Bestand verwendet unterschiedliche Schreibweisen, Ordnerstufen und teils
  direkt im Haustypordner liegende Grundrisse. Die Erkennung deckt sowohl
  Grundrissordner als auch die Etagenkürzel EG, OG und DG im Dateinamen ab.
- Die Grundrisse für `SOL 183 V2`, `SOL 204 V11`, `SOL 242 V3`, `SOL 242 V6`,
  `SUN 113 V1`, `SUN 113 V9` und `SUN 126 V9` fehlen in der bereitgestellten
  Bibliothek. Diese Varianten bleiben bis zur Ergänzung gesperrt.
- `SUN V8.png` enthält keine Modellnummer und kann deshalb keinem Haustyp
  sicher zugeordnet werden.
- Eine Folge mit seltener dritter Etage umfasst bereits 14 Standardbilder. Ein
  zusätzliches Aktionsbild würde das Portal-Limit überschreiten und muss für
  diesen Export deaktiviert werden.
- Die fachliche Motivqualität und das LivingHaus-Logo müssen beim ersten
  produktionsnahen Import weiterhin visuell im Immoprofessional-Entwurf geprüft
  werden.

## GitHub-Workflow-Integration für macOS – 23. Juli 2026

### Report

- GitHub-Stand `f875699` aus `agent/inseratstudio-workflow-updates` analysiert
  und konfliktfrei in den vorhandenen macOS-Feature-Branch übernommen.
- Maximale Hausbibliothek von 12 auf 18 Haustypen erweitert.
- Getrennte lokale Adressansichten für Fabian und Pascal mit ausdrücklichem
  Speichern und Migration bestehender Adressen zu Fabian ergänzt.
- Excel-Massenimport mit Dublettenprüfung, Fehlermeldungen, deutschen
  Zahlenformaten und geprüfter `.xlsx`-Vorlage integriert.
- Zentrales Aktionsbild eingeführt, das optional als Bild 1 in Auswahl,
  Vorschau, Sicherung, XML und ZIP für alle Haustypen verwendet wird.
- KI-Überschriften auf 3 bis 8 Wörter und 18 bis 60 Zeichen begrenzt;
  Haus-/Modellbezeichnungen, Doppelpunkte und Ausrufezeichen werden abgewiesen.
- Version auf 0.5.0 angehoben und `read-excel-file` 9.3.4 ergänzt.
- Zusätzlich zur GitHub-Fassung Größenlimits von 10 MB für Excel-Dateien und
  25 MB für Aktionsbilder implementiert.

### Begründung

Die GitHub-Erweiterungen wurden nicht als direkter Merge eingespielt, weil der
macOS-Port bereits tiefgreifende, noch nicht eingecheckte Änderungen an denselben
Dateien enthält. Die Funktionen wurden auf Quellhunk-Ebene übernommen und an
Schlüsselbund, Sitzungsauthentifizierung, macOS-Datensicherung, iCloud-Bibliothek
und die strengere OpenImmo-Prüfung angepasst. So bleiben die Sicherheits- und
Plattformverbesserungen erhalten, während alle neuen Workflows verfügbar sind.

### Hürden und Risiken

- GitHub- und macOS-Stand ändern dieselbe zentrale React-Komponente, die
  Katalogsicherung und den OpenImmo-Export; ein automatischer Merge hätte
  Sicherheits- und Funktionsänderungen überschreiben können.
- Die getrennten Adressbücher sind eine organisatorische UI-Trennung innerhalb
  desselben macOS-Benutzerkontos, keine kryptografische Mandantentrennung.
- Excel-Inhalte werden lokal verarbeitet; fachlich falsche, aber formal gültige
  Daten müssen weiterhin vor der Textgenerierung geprüft werden.
- Die GitHub-Normalisierung verwarf in „Grundstücksfläche m²“ die hochgestellte
  Zwei und importierte die Fläche dadurch als 0. Die macOS-Fassung nutzt eine
  Unicode-Kompatibilitätsnormalisierung; ein Test liest dafür die tatsächlich
  ausgelieferte Excel-Datei durch denselben Parser wie die App.
- Das Aktionsbild verändert die exportierte Bildreihenfolge und muss beim ersten
  Immoprofessional-Test anhand von XML, ZIP und Importbericht kontrolliert werden.

## Direkte iCloud-Medienbibliothek – 22. Juli 2026

### Report

- 655 unterstützte, bereits beschriftete Bilder aus `04_ANZEIGEN` direkt in die
  Haustyp-Bearbeitung eingebunden.
- Ordner und Dateinamen automatisch in Hausansichten, Grundrisse,
  Standortmotive und allgemeine Anzeigen klassifiziert.
- Suche, Gruppenfilter, Motivfilter, paginierte Vorschau, Mehrfachauswahl und
  gesammelte Übernahme in einen Haustyp implementiert.
- Grundrisse beim Import automatisch markiert und vorhandene Dateibeschriftungen
  als editierbare Bildtexte übernommen.
- Stabile Quell-IDs gegen Doppelimporte und einen konfigurierbaren Medienpfad
  über `FPI_MEDIA_LIBRARY_ROOT` ergänzt.
- Medienindex und Fehlerfall eines fehlenden iCloud-Ordners automatisiert
  getestet.
- Den Medienindex für 15 Minuten im lokalen Helfer zwischengespeichert und
  einzelne iCloud-Dateiabrufe auf 45 Sekunden begrenzt, damit Platzhalter die
  Bibliothek nicht dauerhaft blockieren.
- Die macOS-Inventur auf den nativen, inhaltsfreien Dateiscan umgestellt, weil
  Apples iCloud-Dateianbieter asynchrone Node-Verzeichnisabfragen nach einem
  festhängenden Platzhalter blockieren kann.
- Acht-Sekunden-Zeitlimit und konkrete Anleitung für die einmalige
  macOS-Dateiberechtigung des Terminal-Startknopfs ergänzt.

### Begründung

Die App greift lesend auf den bestehenden iCloud-Bestand zu, statt 655 Dateien
in das Projekt zu kopieren. Dadurch bleibt die vorhandene Ordnung führend, die
App klein und der iCloud-Traffic bedarfsgesteuert. Der Browser erhält keine
lokalen Dateipfade und keine Sitzungstoken in Bild-URLs; der lokale Helfer gibt
nur indexierte Dateien über HMAC-signierte URLs aus. Erst bewusst ausgewählte
Bilder werden in den lokalen Haustyp und dessen Sicherung übernommen.

### Hürden und Risiken

- Der Bestand enthält lokale und nur in iCloud vorgehaltene Dateien. Eine noch
  nicht geladene Datei kann beim ersten Vorschaubild eine Verzögerung verursachen;
  nach 45 Sekunden bricht der Helfer kontrolliert ab und verweist auf Finder.
- Ältere TIFF-Dateien sind nicht eingebunden, weil der OpenImmo-Export und die
  Browservorschau aktuell nur JPEG, PNG und WebP zulassen.
- Die Dateinamen sind fachliche Beschriftungen, enthalten teilweise aber
  technische Variantenkürzel. Diese werden absichtlich erhalten und können vor
  dem Export in der App bearbeitet werden.
- Wird der Anzeigenordner verschoben, muss der neue Pfad über
  `FPI_MEDIA_LIBRARY_ROOT` konfiguriert werden.

## macOS-Portierung – 22. Juli 2026

### Report

- Nativen macOS-Startknopf mit Laufzeiterkennung, Portprüfung, Sitzungsaufbau,
  Protokollierung und Browserstart ergänzt.
- Datenpfade auf `~/Library/Application Support` umgestellt.
- Zugangstresor auf den macOS-Schlüsselbund portiert.
- Secrets aus Browser-Antworten und Upload-Headern entfernt.
- Sitzungsauthentifizierung für sämtliche lokale Helfer-Endpunkte eingeführt.
- FTPS mit Zertifikatsprüfung und Zugangstest implementiert.
- Gezielte Auswahl einzelner Inserate vor dem Upload ergänzt.
- OpenImmo-Vorabprüfung für Adresse, Grundstücksfläche, Anbieter, Objekt-IDs,
  Preise, Pflichttexte sowie 4 bis 14 unterstützte Bilder ergänzt.
- Nicht mehr benötigte Cloud-Hosting-Kopplung aus dem lokalen Mac-Build entfernt.
- Next auf 16.2.11 aktualisiert und gepatchte `sharp`-/`postcss`-Versionen gegen
  die beim Audit gefundenen CVEs fest vorgegeben.
- Oberfläche und Dokumentation vollständig auf macOS angepasst.

### Begründung

Der bestehende React/OpenImmo-Kern ist plattformneutral und wurde deshalb
beibehalten. Native macOS-Dienste werden nur im lokalen Node-Helfer verwendet.
Diese Trennung minimiert Portierungsrisiken, bewahrt die vorhandene Datenlogik
und verhindert, dass Browsercode Zugriff auf dauerhaft gespeicherte Geheimnisse
erhält. FTPS ist die kleinste kompatible Härtung der bestehenden
Immoprofessional-Importstrecke.

### Hürden und Risiken

- Die ursprüngliche Implementierung war in Launcher, Pfaden, DPAPI und Texten
  eng an Windows gebunden.
- Die tatsächlichen FTPS-Fähigkeiten des konkreten Immoprofessional-Zugangs
  müssen mit dem Anbieterzugang validiert werden.
- Ohne dokumentierte Immoprofessional-Status-API kann die App einen erfolgreichen
  Transfer bestätigen, aber nicht die fachliche Annahme des Imports.
- Eine spätere Verteilung außerhalb dieses Macs benötigt Apple-Signierung und
  Notarisierung; der aktuelle Startknopf ist für den lokalen Workflow bestimmt.
