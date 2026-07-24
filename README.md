# Fabian&Pascal Inseratestudio für macOS

Lokale macOS-Anwendung zum Verwalten von bis zu 18 Haustypen, Grundstücksprojekten und
Inseratentwürfen sowie zum kontrollierten OpenImmo-Import in Immoprofessional.
Die aktuell geöffnete Anwendungsversion steht dauerhaft dezent unten rechts.

## Start auf dem Mac

1. `Start-Fabian-Pascal-Inseratestudio.command` doppelt anklicken.
2. Falls macOS beim ersten Start nachfragt, die Datei per Rechtsklick **Öffnen**.
3. Den einmaligen Zugriff von Terminal auf **iCloud Drive** erlauben, damit die
   vorhandene Medienbibliothek gelesen werden kann.
4. Die Anwendung öffnet `http://127.0.0.1:43181` im Standardbrowser.

Benötigt werden Node.js ab Version 22, pnpm und die Apple Command Line Tools
(bei Bedarf einmalig mit `xcode-select --install`). Der Startknopf verwendet zuerst
die installierten Programme und erkennt zusätzlich die lokale Codex-Laufzeit.
Beim ersten Start werden die exakt im Lockfile festgeschriebenen Pakete
installiert und die lokale Produktionsfassung gebaut. Laufzeitprotokolle liegen
ausschließlich im Unterordner `work`.

## Arbeitsablauf

1. Unter **Haustypen** Hausdaten pflegen und in der **iCloud-Medienbibliothek**
   genau eine versionsbezeichnete SUN-/SOL-Hausansicht mit LivingHaus-Logo
   auswählen. **Komplette Bildfolge erstellen** ergänzt automatisch die sechs
   Innenräume, den emotionalen Catch, die zur Version passenden Grundrisse,
   Auszeichnungen, Vertrauensmotiv und QR-Abschluss. Eine nicht eindeutige
   Hausversion oder ein fehlender Grundriss blockiert die Übernahme, statt eine
   möglicherweise falsche Datei zu verwenden.
2. Unter **Adresse & Auswahl** Grundstücksdaten erfassen und bis zu vier
   Haustypen auswählen. Fabian und Pascal besitzen getrennte Adressansichten;
   einzelne Adressen können gespeichert oder gesammelt per Excel importiert
   werden. Importierte Adressen werden offline aus PLZ und Ort um Bundesland
   sowie Landkreis ergänzt, entsprechend gruppiert und innerhalb der Gruppen
   nach PLZ sortiert. Die vorgeschriebenen Texte stehen direkt unter den Grundstücksdaten
   vollständig in vergrößerten Feldern. Unter der Hausauswahl erscheinen nur
   noch Überschrift, Hausbeschreibung und Lage je Haustyp; die erste Vorschau
   ist geöffnet.
3. Unter **Export & Upload** Anbieterdaten und die benötigten Zugänge eintragen.
   Mit **Zugangsdaten prüfen & speichern** wird ein neuer OpenAI-Zugang geprüft;
   ein neu eingegebener Immoprofessional-Zugang wird einschließlich Zielordner
   und FTPS-Zertifikat geprüft.
4. Texte erzeugen, anschließend unter **Texte & Vorschau** fachlich und rechtlich
   kontrollieren.
5. Unter **Export & Upload** die gewünschten Inserate einzeln auswählen und erst
   nach der Zusammenfassung bestätigen. Alternativ nur ein OpenImmo-ZIP laden.

Der Import erstellt Entwürfe. Adressfreigabe und Portalweitergabe sind im
OpenImmo-Paket deaktiviert. Die tatsächliche Veröffentlichung bleibt eine
bewusste Aktion in Immoprofessional.

## Vorinstallierter Hauskatalog

Unter **Haustypen** stehen 18 vollständige Vorlagen bereit:

- SUN 126 V2, SUN 130 V2, SUN 136 V4, SUN 142 V2, SUN 143 V4,
  SUN 144 V4 Tag, SUN 151 V8, SUN 154 V3, SUN 157 V2, SUN 164 V2,
  SUN 165 V2, SUN 167 V3, SUN 168 V2 und SUN 210 V2
- SOL 101 V2, SOL 107 V2 und SOL 110 V2 als eingeschossige Bungalows
- SUN 113 V6 mit vollständiger Bildfolge, aber bewusst offenem Hauspreis

Jede Vorlage enthält die festgelegte Bildfolge mit beschriftetem Titelbild,
sechs unterschiedlichen Innenraumkategorien, emotionalem Catch,
versionsgenauen Grundrissen, Auszeichnungen, Vertrauensmotiv und QR-Abschluss.
Das optionale zentrale Aktionsbild bleibt unverändert nutzbar und wird beim
Export vor diese Folge gesetzt.

Das Installationsskript ersetzt nur die leeren ursprünglichen Platzhalter
`Zweifamilienhaus – Muster` und `Haustyp 2`. Sobald ein echter Haustyp im
Katalog erkannt wird, bricht es ab, statt Daten zu überschreiben. Bestehende
Projekte, Anbieterdaten, Aktionsbild und Zugangsdaten bleiben erhalten.

## Hinterlegte Hauspreise

Bei der automatischen Bildfolge erkennt die App das Preismodell aus Hausansicht
und Grundrissen. Bildvarianten wie V1, V2 oder V5 ändern den Hauspreis nicht.
Die Größen L und XL werden dagegen als unterschiedliche Häuser behandelt. Bei
einer eindeutigen Zuordnung werden Hauspreis und Objektart automatisch
übernommen; eine manuelle Änderung bleibt möglich. Fehlt ein Preis oder ist die
Kennung nicht eindeutig, bleibt der vorhandene Wert unverändert.

| Objektart | Preismodell | Hauspreis |
| --- | --- | ---: |
| Bungalow | SOL 082 | 325.931 € |
| Bungalow | SOL 101 | 371.065 € |
| Bungalow | SOL 107 | 388.878 € |
| Bungalow | SOL 110 | 386.578 € |
| Doppelhaushälfte | SOL 117 L | 370.736 € |
| Doppelhaushälfte | SOL 117 XL | 470.310 € |
| Doppelhaushälfte | SOL 124 L | 370.542 € |
| Doppelhaushälfte | SOL 125 L | 378.568 € |
| Doppelhaushälfte | SOL 125 XL | 483.864 € |
| Einfamilienhaus | SUN 125 | 362.591 € |
| Einfamilienhaus | SUN 126 | 365.073 € |
| Einfamilienhaus | SUN 130 | 386.555 € |
| Einfamilienhaus | SUN 136 | 380.360 € |
| Einfamilienhaus | SUN 142 | 397.330 € |
| Einfamilienhaus | SUN 143 | 389.533 € |
| Einfamilienhaus | SUN 144 | 399.539 € |
| Einfamilienhaus | SUN 151 | 409.437 € |
| Einfamilienhaus | SUN 154 | 421.674 € |
| Einfamilienhaus | SUN 157 | 407.521 € |
| Einfamilienhaus | SUN 164 | 437.270 € |
| Einfamilienhaus | SUN 165 | 426.931 € |
| Einfamilienhaus | SUN 167 | 437.171 € |
| Einfamilienhaus | SUN 168 | 437.065 € |
| Einfamilienhaus | SUN 210 | 508.654 € |
| Zweifamilienhaus | SOL 194 | 581.836 € |
| Zweifamilienhaus | SOL 204 L | 573.427 € |
| Zweifamilienhaus | SOL 229 | 623.997 € |
| Zweifamilienhaus | SOL 230 | 629.138 € |
| Zweifamilienhaus | SOL 242 | 655.971 € |

Für SUN 126 und SUN 165 ist jeweils der bestätigte niedrigere Listenpreis
hinterlegt. SUN 107, SUN 112, SUN 113 und SUN 155 besitzen im bereitgestellten
Preisausschnitt keinen Wert; die App erfindet dafür keinen Ersatzpreis.

## Sicherheit

- Geheimnisse liegen im macOS-Schlüsselbund und werden nicht in Browserdaten,
  Katalogsicherungen oder Protokolle geschrieben.
- Die Browseroberfläche erhält nach dem Speichern nur Statusinformationen, nie
  gespeicherte Passwörter oder API-Zugänge zurück.
- Der lokale Helfer bindet ausschließlich an `127.0.0.1` und verlangt zusätzlich
  ein zufälliges Sitzungstoken aus einer Datei mit Benutzerrechten `0600`.
- Standard ist explizites FTPS mit vollständiger Prüfung des Serverzertifikats.
  Implizites FTPS kann ausgewählt werden. Unverschlüsseltes FTP ist nur als klar
  gekennzeichneter Kompatibilitätsmodus vorhanden.
- Uploads werden einzeln gepackt, lokal zwischengespeichert und nach Abschluss
  oder Fehler entfernt. Das Diagnoseprotokoll enthält keine Zugangsdaten.
- An die Text-KI werden weder Straße, Hausnummer noch Postleitzahl übermittelt.
- Die iCloud-Medienliste erfordert die lokale Sitzung. Vorschaubilder werden
  ausschließlich über signierte, nicht erratbare URLs ausgeliefert; freie
  Dateipfade können nicht an den Helfer übergeben werden.

Lokale Daten liegen unter:

`~/Library/Application Support/Fabian-Pascal Inseratestudio`

## OpenImmo und Immoprofessional

Der Export verwendet OpenImmo 1.2.7 und überträgt jedes ausgewählte Inserat als
separates ZIP. Die technische Aktion `CHANGE` verwendet die eindeutige externe
Objekt-ID für kontrollierte Upserts. Automatisch
gesetzt werden Wohngebiet, Nutzfläche, Dachboden, Gäste-WC, Gartennutzung,
Fußbodenheizung, Elektro/Luft-Wärmepumpe, KFW40 und KFW55 sowie Energieklasse
A++. Küche wird als Einbauküche und offen übertragen; beim Bad werden Dusche,
Wanne und Fenster markiert. Adressfreigabe und allgemeine Weitergabe bleiben
deaktiviert.

## Verbindliche Inserattexte

Die Überschrift wird lokal und reproduzierbar aus einem emotionalen Einstieg,
Ort oder Ortsteil, gerundeter Wohnfläche, Zimmerzahl und zwei kurzen Vorteilen
aus der Living-Haus-Checkliste aufgebaut. Verwendet werden beispielsweise
18 Monate Festpreis, I-KON, Bau-Cockpit, DGNB-Gold, QNG-Potenzial oder die
30-jährige Garantie. Konkrete Förderbeträge werden nicht versprochen.

Die KI erhält und schreibt ausschließlich die emotionale, haustypbezogene
Objektbeschreibung und die generische Lagebeschreibung. Überschrift,
Ausstattung, Sonstiges und rechtliche Texte sind kein Bestandteil der
KI-Ausgabe. Die in Schritt 2 sichtbare Überschrift wird auch dann im Browser
erneut verbindlich eingesetzt, wenn ein älterer Helferprozess eine abweichende
Überschrift zurückgeben sollte. Schritt 3 zeigt deshalb exakt dieselbe
Überschrift. Bestätigte Zusatzangaben zum Ort oder
Ortsteil werden berücksichtigt; Straße, Hausnummer und Postleitzahl werden der
Text-KI weiterhin nicht übermittelt. Der vorgegebene Call-to-Action wird beim
Speichern und Export genau einmal angefügt.

Bereits gespeicherte Inserate werden beim Laden und unmittelbar vor dem Export
auf leere Textfelder geprüft. Vorhandene individuelle Texte bleiben erhalten;
fehlende Überschrift, Objektbeschreibung oder Lage erhalten eine lokale
Vorbelegung. Die festen Textfelder werden immer mit den freigegebenen Vorgaben
befüllt.

Ausstattung, Sonstiges, Provision, Anmerkung, Allgemeine Geschäftsbedingungen
und der freie Empfehlungstext sind zentral hinterlegt, in der Vorschau als fest
gekennzeichnet und werden beim OpenImmo-Export erneut erzwungen. Provision wird
über die Standardfelder `provisionspflichtig` und `courtage_hinweis`
übertragen. Die drei zusätzlichen Immoprofessional-Textfelder werden als
OpenImmo-`user_defined_simplefield` im Freitextblock mit ihren sichtbaren
Feldbezeichnungen ausgegeben.

Projektierungsmerkmale werden je Inserat nur bei fehlenden Werten ergänzt. Die
zentrale Konfiguration setzt gehobene Ausstattungsqualität, `PROJEKTIERT`,
Fußbodenheizung, Luft-Wärmepumpe, KfW40 und KfW55, Energieklasse A++,
`provisionspflichtig=false` sowie die Energieausweis-Effizienzklasse A+.
Explizite Benutzerwerte einschließlich `false` bleiben erhalten. Die übrigen
Energieausweisfelder werden nicht verändert.

## FTPS-Verbindung

Der zertifikatskonforme FTPS-Host ist `server22.immoprofessional.eu`. Die
früheren Aliase `fabianraebel.livinghaus.info` und
`pascalfroehlich.livinghaus.info` zeigen zwar auf denselben Server, sind aber
nicht im Serverzertifikat enthalten. Die App stellt beide Altwerte automatisch
auf den korrekten Host um und behält die vollständige Prüfung von
Zertifikatskette und Hostname bei. Standardtransport bleibt explizites FTPS.

Der erste produktionsnahe Test muss mit genau einem nicht veröffentlichten
Objekt erfolgen. Immoprofessional kann kontospezifische Importregeln anwenden;
der Importbericht, die Bildreihenfolge und insbesondere die drei
benutzerdefinierten Textfelder sind danach zwingend zu prüfen.

## Speicherung und Wiederherstellung

Katalog und Bilder werden doppelt gespeichert: in der eigenen IndexedDB
`fabian-pascal-inseratestudio-v1` sowie unter `Application Support`. Bilder
liegen getrennt vom Manifest und werden bei reinen Textänderungen nicht erneut
kopiert. JSON-Export und -Import dienen als zusätzliche manuelle Sicherung.
Die Gerätesicherung verwendet eine Versionsprüfung: Ein älterer, noch geöffneter
Browser-Tab darf einen neueren Katalog nicht überschreiben und wird zum Neuladen
aufgefordert.

## Adressbücher und Excel-Import

Unter **Adresse & Auswahl** schaltet die Oberfläche zwischen den lokalen
Adressbüchern von Fabian und Pascal um. Bestehende Projekte ohne Zuordnung
werden beim ersten Laden Fabian zugeordnet. **Adresse speichern** schreibt den
aktuellen Stand sofort in Browser- und macOS-Sicherung.

Über **Excel-Vorlage herunterladen** steht die geprüfte Importvorlage bereit.
Jede Tabellenzeile enthält ein Grundstück; Pflichtfelder sind Benutzer,
Straße, PLZ und Ort. Beim Import werden deutsche Zahlenformate und führende
Nullen in Postleitzahlen berücksichtigt. Dubletten sowie unvollständige Zeilen
werden ausgelassen und in der Oberfläche gemeldet. Ein mitgelieferter
GeoNames-Datensatz ordnet PLZ und Ort ohne Online-Anfrage einem Bundesland und
Landkreis zu. Das Adressauswahlfeld ist danach nach Bundesland/Landkreis
gruppiert und innerhalb jeder Gruppe nach PLZ sortiert. Mehrdeutige oder nicht
enthaltene Zuordnungen werden als **Ohne PLZ-Zuordnung** geführt, statt einen
Landkreis zu raten. Bereits gespeicherte Adressen werden beim Laden ebenfalls
mit der Offline-Tabelle ergänzt, sodass kein erneuter Excel-Import nötig ist.
Excel-Dateien werden nur lokal im Browser verarbeitet und
sind auf 10 MB begrenzt. Die Regionsdaten stehen unter CC BY 4.0; Quelle und
Hinweise befinden sich unter `public/data/README.md`.

## Zentrales Aktionsbild

Ein Aktionsbild kann einmal unter **Haustypen** hinterlegt und für alle Inserate
aktiviert werden. Es erscheint dann in Auswahl, Vorschau und OpenImmo-Export an
Position 1; die Hausansicht folgt an Position 2. Die vorhandenen Hausbilder
bleiben unverändert. Überschreitet die Gesamtfolge dadurch das OpenImmo-Limit
von 14 Bildern, blockiert die Exportprüfung mit einem konkreten Hinweis. Es wird
kein Bild still entfernt. Das Aktionsbild wird separat in Browser- und
macOS-Sicherung gespeichert und ist auf JPEG, PNG oder WebP bis 25 MB begrenzt.

Die App liest oder verändert keine Daten von deviq oder Plotverium.

## Bildfolge und feste Bildüberschriften

Die automatisch erzeugte Standardfolge lautet:

- Position 1: Hausansicht mit LivingHaus-Logo
- Position 2 bis 7: genau eine Küche, ein Bad, ein Schlafzimmer, ein
  Kinderzimmer, ein Wohnzimmer und ein Büro; nur innerhalb dieses Blocks darf
  die Reihenfolge verändert werden
- Position 8: **Hier beginnt dein Zuhause**
- Position 9: Grundriss **Erdgeschoss**
- Position 10: Grundriss **Obergeschoss** oder **Dachgeschoss**, bei Bedarf
  anschließend die seltene dritte Etage
- Danach: **Ausgezeichnet gebaut**, **Bestens Beraten** und **Jetzt Starten!**
  mit QR-Code

Die laufenden Positionsnummern werden von der App automatisch berechnet. Bei
SOL 82, SOL 101, SOL 107 und SOL 110 wird als Bungalow ausschließlich das
Erdgeschoss verlangt. Alle SUN-Modelle und die übrigen SOL-Modelle benötigen
Erdgeschoss plus Ober-/Dachgeschoss. Die Überschrift des Titelbilds kann zwischen
**Dein wundervolles Zuhause**, **Dein schönes Zuhause** und **Dein neues
Zuhause** wechseln. Die fachlich vorgegebenen Überschriften aller anderen Rollen
bleiben unverändert und werden von der KI-Bildtextfunktion nicht überschrieben.

## iCloud-Medienbibliothek

Beim Öffnen der Bibliothek indexiert die App die unterstützten JPEG-, PNG- und
WebP-Dateien im vorhandenen Anzeigenordner sowie die Motive aus
`01_RENDERING/Inneneinrichtung`. Ordnerstruktur und Dateinamen werden für
Gruppierung, Bildrolle und Beschriftung verwendet. Erkannte Kategorien sind
Hausansicht, Innenraum, Grundriss, Standort und allgemeine Anzeige. Suche,
Gruppen- und Kategorienfilter begrenzen die Ansicht auf jeweils 36
Vorschaubilder.

Für die Grundrisszuordnung werden SUN/SOL-Familie, Modellnummer, Version,
Dachform und Etage aus Hausansicht und Grundriss gelesen. Das Erdgeschoss steht
immer vor Ober- oder Dachgeschoss. Eine dritte Etage wird separat eingeordnet.
Zusätzlich kann jedes manuell importierte Bild einer Rolle zugeordnet und die
gesamte Folge anschließend nach Rollen normalisiert werden.

Die Originale bleiben unverändert in iCloud. Erst beim Übernehmen werden die
ausgewählten Dateien in den lokalen Haustyp kopiert und danach wie manuell
gewählte Bilder doppelt gesichert. Eine stabile Quell-ID verhindert erneute
Übernahme desselben Motivs. Ist eine Datei nur als iCloud-Platzhalter vorhanden,
löst die Vorschau beziehungsweise Übernahme den normalen iCloud-Download aus.
Nach 45 Sekunden wird ein festhängender Einzelabruf kontrolliert beendet; die
Datei kann dann in Finder über **Jetzt laden** lokal bereitgestellt werden.

Standardpfad:

`~/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/04_ANZEIGEN`

Standardpfad der Innenräume:

`~/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/01_RENDERING/Inneneinrichtung`

Auf einem anderen Mac können die Pfade vor dem Start über die
Umgebungsvariablen `FPI_MEDIA_LIBRARY_ROOT` und
`FPI_INTERIOR_LIBRARY_ROOT` gesetzt werden.

Wenn macOS die Bibliothek nicht freigibt, unter **Systemeinstellungen →
Datenschutz & Sicherheit → Dateien und Ordner → Terminal** den Zugriff auf
iCloud Drive aktivieren und die App neu starten. Der Index bricht einen solchen
Wartezustand nach acht Sekunden ab, damit der lokale Helfer erreichbar bleibt.

Details zur Sicherheitsanalyse stehen in [SECURITY-ANALYSIS.md](SECURITY-ANALYSIS.md),
die technische Änderungsübersicht in [CHANGELOG.md](CHANGELOG.md).
