# Fabian&Pascal Inseratestudio für macOS

Lokale macOS-Anwendung zum Verwalten von bis zu 22 Haustypen, Grundstücken und
Inseratentwürfen sowie zum kontrollierten OpenImmo-Import in Immoprofessional.
Die aktuell geöffnete Anwendungsversion steht dauerhaft dezent unten rechts.

## Start auf dem Mac

1. `Start-Fabian-Pascal-Inseratestudio.command` doppelt anklicken.
2. Falls macOS beim ersten Start nachfragt, die Datei per Rechtsklick **Öffnen**.
3. Die Anwendung öffnet `http://127.0.0.1:43181` im Standardbrowser.

Benötigt werden Node.js ab Version 22, pnpm und die Apple Command Line Tools
(bei Bedarf einmalig mit `xcode-select --install`). Der Startknopf verwendet zuerst
die installierten Programme und erkennt zusätzlich die lokale Codex-Laufzeit.
Beim ersten Start werden die exakt im Lockfile festgeschriebenen Pakete
installiert und die lokale Produktionsfassung gebaut. Laufzeitprotokolle liegen
ausschließlich im Unterordner `work`.

Die gebaute Fassung wird anschließend durch den schlanken lokalen
`production-server.mjs` ausgeliefert. Dadurch bleibt der tägliche Start auch mit
der großen integrierten Medienbibliothek schnell; ein vollständiger Neuaufbau
erfolgt nur, wenn sich relevante Quelldateien geändert haben.

Bei einem neuen Git-Checkout müssen die Originalbilder einmalig mit Git LFS
geladen werden:

```bash
git lfs install
git lfs pull
```

Die App enthält 665 Originalbilder mit rund 3,17 GB logischer Größe. Ein Zugriff
auf iCloud Drive oder die ursprüngliche Ordnerstruktur ist für den Betrieb nicht
mehr erforderlich.

## Arbeitsablauf

1. Unter **01 Grundstücke & Auswahl** werden Grundstücke zentral verwaltet,
   bearbeitet, importiert und direkt mehrfach ausgewählt. Dieselbe gruppierte
   Liste enthält Straße, PLZ, Ort, Fläche, Kaufpreis, letztes Plattform-
   Uploaddatum, Inseratsanzahl und Statusfarbe. Innerhalb eines Landkreises oder
   einer kreisfreien Stadt lässt sie sich nach allen sichtbaren Kennzahlen
   sortieren.
2. Direkt unter der Grundstücksliste wird der **eine gemeinsame Hauspool**
   gewählt. Die vorhandene gewichtete Rotation verteilt vier unterschiedliche
   Häuser auf jedes ausgewählte Grundstück. Einzelne Vorschläge bleiben
   austauschbar, sortierbar, fixierbar und grundstücksbezogen ausschließbar.
3. **02 Haustypen** dient ausschließlich der alphabetisch sortierten
   Hausbibliothek, Preis- und Bildpflege. Grundstücke oder Inseratstexte werden
   dort nicht ausgewählt beziehungsweise bearbeitet.
4. Unter **03 Texte & Vorschau** liegen Überschrift, Kurztext, Objektbeschreibung,
   Lage, Ausstattung, Energieangaben, feste Langtexte, KI-Erzeugung und
   Portalvorschau. Zwischen zentral ausgewählten Grundstücken wird hier nur zur
   Bearbeitung navigiert; die Auswahl selbst bleibt unverändert aus Schritt 01.
5. **04 Inseratsmanager** verarbeitet ausschließlich die zentrale Auswahl. Die
   Inserate können optional je Grundstück gruppiert und nach Ort, Uploaddatum,
   letzter oder nächster Aktualisierung, Health Score und Status sortiert werden.
6. **05 Export & Upload** verwendet ohne erneute Grundstücksauswahl exakt
   dieselben Grundstücke und vorbereiteten Inserate.

Der frühere Navigationsschritt **Projektierung** wurde vollständig entfernt.
Seine Hauspool- und Verteilungsfunktionen befinden sich jetzt in Schritt 01,
seine Textfunktionen in Schritt 03 und seine Inseratssteuerung in Schritt 04.

Der Import erstellt Entwürfe. Adressfreigabe und Portalweitergabe sind im
OpenImmo-Paket deaktiviert. Die tatsächliche Veröffentlichung bleibt eine
bewusste Aktion in Immoprofessional.

## Grundstücksverwaltung und Exposé-PDFs

Grundstücke sind die einzige Adress- und Auswahlquelle des gesamten Workflows.
Sie besitzen interne ID, Straße, Hausnummer, PLZ, Ort, Grundstücksgröße,
Kaufpreis, Zeitstempel und Aktivstatus. Die persistierte zentrale Auswahl wird
beim Laden gegen aktive Grundstücke bereinigt und von Texten, Manager,
Scheduler sowie Upload gemeinsam verwendet. Interne Inseratsarbeitsstände
referenzieren den Grundstücksdatensatz und werden aus der zentralen Quelle
synchronisiert. Eine manuelle
Löschung entfernt den Grundstücksdatensatz und sämtliche internen abhängigen
Projekt-, Upload-, Aktionsbild- und Rotationsreferenzen. Sie löst niemals eine
externe Löschung bei Immoprofessional oder einem Immobilienportal aus.

Eine gemeinsame gruppierte Liste enthält Auswahl, Anlage, Bearbeitung,
vollständige Löschung, Exposé-Verwaltung und den kontrollierten Excel-Import.
Die aktiven Datensätze werden nach Bundesland und Landkreis beziehungsweise
kreisfreier Stadt gruppiert. Grundstücke mit ein bis drei Inseraten sind gelb,
Grundstücke ab vier Inseraten grün markiert; bei mehr als vier Varianten steht
zusätzlich ein deutlicher Hinweis am einzelnen Eintrag.

## Automatischer KI-Grundstücksabgleich

Der lokale Helfer liest `KI_Grundstuecke.xlsx` ausschließlich schreibgeschützt.
Der Quellpfad steht zentral in `plot-sync-config.mjs` und kann über
`FPI_PLOT_SYNC_SOURCE_PATH` überschrieben werden. Berücksichtigt werden nur die
Statuswerte **Neu**, **Vorhanden** und **Nicht mehr vorhanden**. Die Zuordnung
erfolgt in dieser Reihenfolge über interne ID, normalisierten Inseratslink und –
nur ohne beide Kennungen – eine eindeutige normalisierte Adresse.

Der Abgleich läuft nach dem ersten erfolgreichen Lauf alle drei Tage um 07:00
Uhr in `Europe/Berlin`. Status, nächster Termin und Protokoll liegen persistent
unter `~/Library/Application Support/Fabian-Pascal Inseratestudio`; ein Datei-
und Prozess-Lock verhindert parallele Läufe. War der Mac zum Termin aus oder im
Ruhezustand, holt der lokale Helfer den fälligen Lauf beim nächsten Start nach.
Ein manueller Lauf verschiebt den bestehenden Rhythmus nicht.

`Nicht mehr vorhanden` deaktiviert ein Grundstück und sperrt neue
Inseratsentwürfe sowie Rotationen, erhält aber historische Arbeitsstände und
externe Inserate. Aktive externe Inserate erzeugen einen Prüfhinweis und werden nicht
automatisch gelöscht. Strukturfehler brechen vor dem atomaren Katalogschreiben
ab; fehlerhafte Einzelzeilen werden protokolliert und stoppen die übrigen
gültigen Zeilen nicht.

Eine später auf Vercel gehostete Webanwendung kann nicht direkt auf den lokalen
iCloud-Pfad des Mac zugreifen. Dafür muss die Excel-Datei über einen für den
Server erreichbaren, authentifizierten Objektspeicher oder ein eingebundenes
Netzlaufwerk bereitgestellt und der bestehende Job über einen persistenten
Server-/Cron-Prozess ausgelöst werden. Der lokale Helfer bleibt für die aktuelle
Mac-Version die zuständige, persistente Ausführungsumgebung.

Der Excel-Import speichert erst nach einer sichtbaren Vorschau. Ungültige Zeilen
sind nicht auswählbar. Bei einer Kombination aus gleicher Straße, Hausnummer,
PLZ und Ort ist die sichere Voreinstellung **Überspringen**; Aktualisieren oder
bewusstes Neu-Anlegen erfordern eine ausdrückliche Auswahl.

Exposé-PDFs werden unter
`~/Library/Application Support/Fabian-Pascal Inseratestudio/plot-exposes`
gespeichert. Upload und Lesen laufen ausschließlich über den lokalen,
sitzungsgeschützten Helfer. Entfernen und Ersetzen verschieben Altdateien in
ein lokales Archiv. PDF-Inhalte, Bilder und Dateien gelangen weder in die
OpenImmo-Pakete noch an die Text-KI. Die Auslesung führt keine
Bebaubarkeits-, Risiko-, Makler-, Provisions- oder Bildanalyse durch.

Der attraktive Lageverkaufstext nutzt nur Ort, Ortsteil und hinterlegte,
geprüfte regionale Grundnotizen. Der Satz zur konkreten Bebaubarkeit und
Hauspositionierung wird separat angezeigt und als eigener sachlicher
OpenImmo-Textwert exportiert.

## Vorinstallierter Hauskatalog

Unter **Haustypen** stehen 22 vollständige Vorlagen bereit:

- SUN 126 V2, SUN 130 V2, SUN 136 V4, SUN 142 V2, SUN 143 V4,
  SUN 144 V4 Tag, SUN 151 V8, SUN 154 V3, SUN 157 V2, SUN 164 V2,
  SUN 165 V2, SUN 167 V3, SUN 168 V2 und SUN 210 V2
- SOL 101 V2, SOL 107 V2 und SOL 110 V2 als eingeschossige Bungalows
- SUN 113 V6 mit 106,15 m², 4 Zimmern, 3 Schlafzimmern und 355.122 € Hauspreis
- SOL 204 V4, SOL 229 V3, SOL 230 V6 und SOL 242 V4 als vollständig
  bebilderte Zweifamilienhäuser mit versionsgenauen EG-/OG- bzw. DG-Grundrissen

Jede Vorlage enthält die festgelegte Bildfolge mit beschriftetem Titelbild,
sechs unterschiedlichen Innenraumkategorien, emotionalem Catch,
versionsgenauen Grundrissen, Auszeichnungen, Vertrauensmotiv und QR-Abschluss.
Mehrere optionale Aktionsbilder können zentral verwaltet und beim Export
adressbezogen rotiert vor diese Folge gesetzt werden.

Auf einem frischen Mac installiert der Startknopf diesen neutralen Katalog
automatisch aus den eingebauten Medien. Bei einem bestehenden lokalen Katalog
werden ausschließlich fehlende, fest freigegebene Vorlagen ergänzt; vorhandene
Häuser, Projekte, Anbieterdaten, Aktionsbilder und Zugangsdaten bleiben erhalten.

## Integrierte Medienbibliothek

Im Repository liegen 655 Bilder aus dem Anzeigenbestand und 10 zusätzliche
Innenraumbilder – insgesamt 665 JPEG-, PNG- und WebP-Originale. Enthalten sind
sämtliche hinterlegten Hausansichten, Grundrisse, Innenräume, Standortmotive,
emotionale Motive, Auszeichnungen, Vertrauensbilder und QR-Abschlüsse.

Die Dateien liegen unter `bundled-media` und werden wegen ihrer Gesamtgröße mit
Git LFS versioniert. Sie werden nicht noch einmal in den Web-Build kopiert,
sondern ausschließlich durch den lokalen, sitzungsgeschützten Helfer ausgeliefert.
Für kontrollierte Wartungsimporte steht `npm run media:sync` zur Verfügung.

## Hinterlegte Hauspreise

Bei der automatischen Bildfolge erkennt die App das Preismodell aus Hausansicht
und Grundrissen. Bildvarianten wie V1, V2 oder V5 ändern den Hauspreis nicht.
Die Größen L und XL werden dagegen als unterschiedliche Häuser behandelt. Bei
einer eindeutigen Zuordnung werden Hauspreis und Objektart automatisch
übernommen; eine manuelle Änderung bleibt möglich. Fehlt ein Preis oder ist die
Kennung nicht eindeutig, bleibt der vorhandene Wert unverändert.
Die komplette Liste ist zusätzlich direkt im Bereich **Haustypen** aufklappbar.

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
| Einfamilienhaus | SUN 113 | 355.122 € |
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
hinterlegt. SUN 107, SUN 112 und SUN 155 besitzen im bereitgestellten
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
- Exposé-PDFs werden nur lokal verarbeitet und nicht an die Text-KI,
  Immoprofessional oder ein anderes Portal übertragen.
- Die integrierte Medienliste erfordert die lokale Sitzung. Vorschaubilder werden
  ausschließlich über signierte, nicht erratbare URLs ausgeliefert; freie
  Dateipfade können nicht an den Helfer übergeben werden.
- Private Grundstücksprojekte, persönliche Anbieterdaten, Zugangsdaten,
  Sitzungsdateien und Uploadprotokolle gehören nicht zum eingebauten Katalog
  und werden nicht im Git-Repository gespeichert.

Lokale Daten liegen unter:

`~/Library/Application Support/Fabian-Pascal Inseratestudio`

## Persistente automatische Inseratrotation

Die automatische Rotation läuft im persistenten lokalen Background-Helper und
nicht mehr in einem React-`useEffect`. Sie arbeitet deshalb auch ohne geöffnete
Browserseite. Beim Helper-Start gilt zunächst die persistente Produktions-
Policy: `detect-only` ermittelt Fälligkeiten ausschließlich read-only;
`guarded` darf einen regulär fälligen Lauf nur innerhalb sämtlicher Zeit-,
Abstands-, Tages-, Claim- und Produktionslimits starten. Einen unbeschränkten
Startup-Catch-up gibt es nicht. Anschließend prüft der Helper den gespeicherten
Zeitplan selbständig.
Ein dateibasierter, während der Verarbeitung erneuerter Scheduler-Claim
verhindert parallele oder doppelte Läufe und kann nach einem Helper-Abbruch
sicher übernommen werden.

Der automatische Umfang besteht aus allen aktiven, verwalteten Inseraten, für
die `automaticUpdateEnabled` eingeschaltet ist. `selectedPlotIds` ist nur eine
UI- und Arbeitsauswahl für manuelle Aktionen und beeinflusst den automatischen
Scheduler nicht. Fälligkeit wird bewusst dynamisch aus bestätigtem
Veröffentlichungszeitpunkt, Erstwartezeit, Aktualisierungsintervall und dem
inseratsbezogenen Steuerdatensatz berechnet. Ein zusätzlich persistierter
`due`-Status ist nicht erforderlich: Er würde bestehende Kataloge migrieren
und könnte einen tatsächlich veröffentlichten Zustand nur wegen Zeitablaufs
überschreiben. Jeder Schedulerlauf protokolliert die berechnete Anzahl
fälliger, ausgewählter, fortgesetzter, übersprungener und fehlerhafter
Inserate sowie Start, Ende und Abbruchgrund.

### Deterministische Creative-Diversifizierung

Die Auswahl des nächsten Grundstücks bleibt Aufgabe des Schedulers. Erst nach
dieser Auswahl bestimmt eine getrennte, rein zustandsbasierte Creative-Stufe
das nächste Haus und anschließend das Hero-Bild. Die Hauswahl verwendet eine
deterministische LRU-/Score-Reihenfolge aus der Historie des konkreten
Grundstücks und der globalen Rotationshistorie. Direkte Wiederholungen,
kurzfristig häufig genutzte Häuser und eine unnötige globale Serie werden
benachteiligt; bei mehreren zulässigen Häusern wird das bisherige Haus nicht
erneut gewählt. Ist fachlich nur ein Haus verfügbar, bleibt die Rotation mit
dem Diagnosecode `CREATIVE_VARIATION_EXHAUSTED` produktiv statt zu blockieren.

Die zweite Stufe wählt unabhängig davon das Hero. Normale Haus-Titelbilder mit
Rolle `cover` sind automatisch zulässig; andere Hausperspektiven nur mit der
expliziten Metadatenfreigabe `eligibleForListingHero: true`. Zentral verwaltete
Aktionsbilder gelten nur dann als freigegeben, wenn die Aktionsbildfunktion und
ihre automatische Rotation aktiviert sind, das konkrete Motiv aktiv ist, die
Rolle `promotion` trägt und nicht mit `eligibleForListingHero: false` gesperrt
ist. Ein freigegebenes Aktionsbild erscheint deterministisch ungefähr bei jeder
vierten geeigneten Rotation. Innerhalb beider Bildpools gilt erneut LRU; ohne
geeignetes Aktionsbild wird immer der normale Hausbildpfad verwendet.

Haus-ID, Hausname, Preis, vollständige Texte, Hero-Typ, Hero-ID und optionale
Aktionsbild-ID werden gemeinsam an der neuen Rotationskopie gespeichert. Der
Upload liest ausschließlich diese persistierte Auswahl. Ein Helper-Neustart
kann deshalb weder Haus noch Hero neu würfeln. Erst der eindeutig positive
Importbericht schreibt Haus- und Aktionsbildnutzung genau einmal in die
bestehenden Statistiken zurück. Ältere Rotationskopien bleiben ohne Migration
als Historie auswertbar.

Die nächsten zehn oder zwanzig fälligen Kandidaten lassen sich ohne
Katalogmutation, Helperstart oder Upload prüfen:

```bash
node listing-creative-preview-cli.mjs preview --limit 10
node listing-creative-preview-cli.mjs preview --limit 20 --at 2026-08-17T10:00:00+02:00
```

Die Vorschau zeigt Grundstück, Quelle, bisheriges und vorgeschlagenes Haus,
Hero-Typ, konkretes Creative, Begründung sowie letzte Verwendung. Daily-Plot-
Guard, Dreierlimit, Zeitfenster, Claims, Leases, Importbestätigung und das
separate DELETE-Sicherheitsmodell werden von der Creative-Stufe nicht verändert.

### Hartes Tageslimit je Grundstück

Für produktive Hausuploads gilt zentral: Pro stabiler `plotId` darf innerhalb
eines Kalendertags in `Europe/Berlin` höchstens ein Haus per FTPS übertragen
werden. Der persistente Schlüssel lautet `<plotId>:<YYYY-MM-DD>`. Der Guard
liegt in `plot-daily-upload-guard.json` im Application-Support-Verzeichnis und
wird von Background-Scheduler, manuellem Upload, explizitem Canary und
Restart-Catch-up gleichermaßen verwendet. Eine UI-Auswahl oder ein neuer
Helper-Prozess kann ihn nicht umgehen.

Der Tag ist ab erfolgreichem FTPS-Transfer verbraucht; ein noch ausstehender
Importbericht gibt ihn nicht wieder frei. Ein nach Transferbeginn unklarer
Zustand blockiert fail-closed. Ein ausschließlich lokal vorbereiteter und
nachweislich nicht gestarteter Transfer gibt seinen Claim dagegen wieder frei.
Katalog, Uploadledger und bestätigte Importberichte werden zusätzlich als
positive Evidenz ausgewertet. Fehlt eine stabile `plotId`, wird der produktive
Upload blockiert. Der einheitliche Code lautet
`PLOT_DAILY_UPLOAD_LIMIT_REACHED`.

Der Ablauf des automatischen Rotationsauftrags ist:

`scheduled → processing → prepared → transferred_pending_import → published`

`scheduled` und `processing` liegen auf dem Steuerdatensatz des weiterhin
veröffentlichten Ausgangsinserats; ab `prepared` besitzt die neue Kopie ihren
eigenen Zustand. Das Ausgangsinserat selbst bleibt währenddessen `published`,
weil es weiterhin die zuletzt bestätigte Veröffentlichung bezeichnet. Eine erfolgreiche
FTPS-Übertragung endet ausschließlich in `transferred_pending_import`. Erst
ein separates, eindeutig zugeordnetes Ereignis `import-confirmed` darf die
neue Kopie auf `published` anheben. Bei FTPS-Fehler, unklarem Importzustand
oder Helper-Abbruch bleibt das alte Inserat unverändert veröffentlicht; der
idempotente Uploadauftrag wird mit derselben Job-ID fortgesetzt.

Neue Rotationskopien erhalten weiterhin eine kollisionsgeprüfte eindeutige
Objektnummer. Ein `DELETE` ist ausschließlich für Kopien zulässig, die in einem
regulären Produktionslauf eine persistente Lifecycle-Autorisierung erhielten,
deren Import positiv und eindeutig bestätigt wurde und deren Quelle weiterhin
exakt auf dieses Replacement verweist. Ein FTPS-Erfolg allein autorisiert keine
Löschung. Scheduler-Protokoll und Lock liegen zusammen mit den übrigen lokalen
Laufzeitdaten im Application-Support-Verzeichnis.

### Globaler fail-closed Betriebsmodus

Die automatische Rotation besitzt zusätzlich einen persistenten globalen
Betriebsmodus in `listing-rotation-mode.json` im Application-Support-Verzeichnis:

- `off` erkennt und protokolliert fällige Inserate, erzeugt aber weder eine
  Rotationskopie noch einen Uploadauftrag.
- `canary` verarbeitet ausschließlich explizit freigegebene interne
  Listing-IDs oder externe Objektnummern. Alle anderen fälligen Inserate
  erscheinen mit eindeutigem Skip-Grund im Schedulerprotokoll.
- `active` aktiviert den regulären Backgroundbetrieb innerhalb der bestehenden
  Schedulerlimits und zusätzlich nur bei gültiger Produktions-Policy.

Fehlt die Konfiguration, ist sie beschädigt oder enthält sie einen unbekannten
Wert, wird immer `off` verwendet. Diese Sperre gilt auch für Startup-Catch-up
und das Wiederaufnehmen vorbereiteter Rotationen. Ein Helper-Neustart kann
damit ohne vorherige ausdrückliche Freigabe keinen produktiven FTPS-Auftrag
erzeugen.

Der aktuelle Zustand lässt sich ohne Helper-Start und ohne Upload lesen:

```bash
node listing-rotation-mode-cli.mjs status
```

Genau ein Canary-Inserat wird über seine interne Listing-ID oder seine externe
Objektnummer freigegeben:

```bash
node listing-rotation-mode-cli.mjs set --mode canary --listing-id 30460-XXXXXX
```

Die übrigen Modi werden explizit gesetzt:

```bash
node listing-rotation-mode-cli.mjs set --mode off
node listing-rotation-mode-cli.mjs set --mode active
```

Das CLI ändert ausschließlich die persistente Modusdatei. Es startet den
Helper nicht und führt selbst weder Rotation noch FTPS-Transfer aus.

### Persistentes Produktionslimit und Startup-Vertrag

`listing-rotation-production-policy.json` begrenzt `active` zusätzlich auf
höchstens drei Source-/Replacement-Lifecycles je Schedulerlauf. Fehlt diese
Datei, ist sie beschädigt, liegt `maxRunItems` außerhalb `1..3` oder ist der
Startup-Modus unbekannt, bleibt `active` fail-closed ohne Rotation und Upload.

```bash
node listing-rotation-production-policy-cli.mjs status
node listing-rotation-production-policy-cli.mjs set --max-run-items 3 --startup-catchup-mode detect-only
node listing-rotation-production-policy-cli.mjs set --max-run-items 3 --startup-catchup-mode guarded
```

`detect-only` ist der sichere Release- und Erststartmodus. `guarded` verwendet
bei einem späteren Neustart denselben regulären Scheduler wie der Stundenlauf;
Zeitfenster, globaler Mindestabstand, Tageslimit, maximal drei Inserate,
unterschiedliche Grundstücke und der persistente Daily-Plot-Guard bleiben
wirksam. `selectedPlotIds` und explizite Listing-IDs sind in `active` keine
Scheduler-Eingabe.

### Immoprofessional-Importbestätigung aus dem serverseitigen Berichtordner

Der lokale Background-Helper schließt die zweite Veröffentlichungsstufe über
den echten Immoprofessional-Mailbericht. Stufe 1 ist ausschließlich der
erfolgreiche FTPS-Transfer; die Rotationskopie bleibt dabei
`transferred_pending_import`. Stufe 2 erfordert die exakt validierte Zeile
`OK: Erfolgreich importiert` mit genau einer konkreten Objektnummer. Erst dann
wird diese Kopie `published`.

Die Mailablage übernimmt eine Outlook-/Exchange-Regel auf dem Server:

```text
Betreff enthält: Importbericht OpenImmo XML
Zielordner:       Inseratestudio – Importberichte
```

Das Inseratestudio liest danach ausschließlich den direkten Ordner
`Livinghaus / Inseratestudio – Importberichte`. Die lokalen Selektoren können
ohne Zugangsdaten gesetzt werden:

```bash
FPI_IMPORT_REPORT_MAIL_ACCOUNT="Livinghaus"
FPI_IMPORT_REPORT_MAILBOX="Inseratestudio – Importberichte"
```

Der Accountname muss genau einmal vorkommen; der von Apple Mail für Exchange
gemeldete Typ `unknown` ist allein kein Ablehnungsgrund. Der Ordner muss exakt
einmal direkt in dieser Accounthierarchie vorhanden sein. Ein gleichnamiger
Ordner unter „Auf meinem Mac“ oder einem anderen Account wird nicht verwendet.
Fehlende oder mehrdeutige Account-/Ordnerauflösung stoppt mit
**Importbericht-Ordner nicht verfügbar**. Das Inseratestudio legt den Ordner
nicht selbst an und besitzt in diesem Workflow keinerlei Mailmutation: kein
Verschieben, Löschen, Kopieren, Gelesen-Markieren, Markieren, Kategorisieren,
Anlegen oder Umbenennen.

Der Apple-Mail-Adapter verwendet einen strukturierten Prozessvertrag:
`FPI_OK` kennzeichnet ausschließlich eine erfolgreiche read-only Antwort;
fachliche Setupfehler werden als `FPI_ERROR / SETUP_REQUIRED / <Grund>`
zurückgegeben. Nur dieser tatsächlich ausgegebene Prozesswert kann
`MAIL_IMPORT_REPORT_SETUP_REQUIRED` auslösen. Der AppleScript-Quelltext, die
Kommandozeile und Debug-Ausgaben werden ausdrücklich nicht nach
Sentinelwörtern durchsucht.

Die serverseitige Ordnerzuordnung klammert die verschachtelte AppleScript-
Eigenschaftsauflösung explizit. Dadurch wird die Account-ID des gefundenen
Ordners vor jeder Abfrage parserfest mit dem eindeutig aufgelösten
`Livinghaus`-Account verglichen; ein anderer Account bleibt fail-closed. Die
Mail-Terminologie wird dabei über die stabile Bundle-ID `com.apple.mail`
aufgelöst, damit lokalisierte oder nicht terminologieauflösende App-Namen den
read-only Parser nicht beeinflussen.

Prozess- und AppleEvent-Timeouts werden vorgelagert als
`MAIL_AUTOMATION_TIMEOUT` mit `timedOut`, Exit-Signal und Laufzeit erfasst.
Explizite macOS-Automationsverweigerungen werden davon als
`MAIL_AUTOMATION_PERMISSION_DENIED`, eine nicht erreichbare Mail-/AppleEvent-
Verbindung als `MAIL_AUTOMATION_UNAVAILABLE` und ungültige strukturierte
Antworten als `MAIL_IMPORT_REPORT_PARSE_ERROR` getrennt. Alle Klassen bleiben
fail-closed: Sie bestätigen keinen Import, verändern keine Mail und lassen die
Rotationskopie unverändert `transferred_pending_import`.

### Persistenter macOS-Helper und read-only Runtime-Probe

Der Helper läuft als einzelner Benutzer-LaunchAgent im Aqua-Kontext und mit
`ProcessType=Interactive`. Die installierte Runtime ist eine isolierte,
fingerprintierte Kopie des geprüften Quellstands. Sie enthält die erforderlichen
Runtime-Abhängigkeiten, Medien und die fest allowlistete macOS-Keychain-Sidecar
`macos-keychain.swift`, aber keine Secrets, Tests, Arbeitsdaten,
Git-Metadaten oder Build-Artefakte. Der geschützte lokale Sitzungsschlüssel wird
erst beim Start aus dem Application-Support-Verzeichnis gelesen und niemals in
die Runtime kopiert.

Der Stager nimmt diese dynamisch gestartete Supportdatei in den
Runtime-Fingerprint auf und prüft sie vor der Installation. Fehlt die Sidecar,
stoppt das Staging fail-closed, bevor ein Helper auf den Stand zeigen kann.

Installation beziehungsweise kontrollierte Aktualisierung erfolgen aus einem
sauberen, vollständig geprüften Feature-Stand:

```bash
node helper-launch-agent-cli.mjs install
```

Der Apple-Mail-Kindprozess besitzt einen begrenzten Buffer und eine feste
Laufzeit. Bei Timeout wird ausschließlich der zugehörige `osascript`-Prozess
zunächst mit `SIGTERM` und nach Ablauf der Grace Period mit `SIGKILL` beendet;
der Helper wartet auf dessen tatsächliches Ende. Adapter und Importdienst
erlauben jeweils nur eine aktive Mailoperation. Die Ordnertraversierung ist auf
500 Nachrichten begrenzt und liest für die Kandidatensuche nur Betreff,
Empfangszeitpunkt und lokale Nachrichten-ID.

Der sessiongeschützte Runtime-Probe prüft den exakt laufenden Helperpfad, ohne
Nachrichtentexte oder Anhänge zu lesen und ohne eine Mail- oder Katalogmutation:

```bash
node mail-runtime-probe-cli.mjs probe --runs 10 --interval-ms 250
```

Jeder Lauf protokolliert Prozess-ID, Start, Ende, Dauer, Mailboxklasse,
Kandidatenanzahl sowie ausdrücklich `readOnly: true` und `mailMutations: 0`.

Gesucht wird nur nach dem exakten Betreff und in einem auf offene Transfers
begrenzten Lookback. Gibt es keine offene `transferred_pending_import`-Kopie,
wird Apple Mail nicht angesprochen. Solange eine Bestätigung offen ist, prüft
der Helper moderat alle fünf Minuten; ein Helper-Neustart führt denselben
idempotenten read-only Check aus. Es gibt keinen automatischen Inbox-Fallback.

Vertrauenswürdig ist ein Bericht nur mit dem konfigurierten
Immoprofessional-Host in Message-ID oder SMTP-Received-Kette und vorhandenem
`SPF=pass`. DKIM wird nicht vorausgesetzt. Der Parser bevorzugt `text/plain`,
verwendet HTML nur als Fallback und akzeptiert aktuell ausschließlich den
bekannten Einzelobjekt-Erfolgsvertrag: Sendersoftware
`Fabian&Pascal Inseratestudio`, Anbieter-ID `30460`, Objektanzahl `1` und genau
eine strukturierte Erfolgszeile. Unbekannte Erfolgs- oder Fehlerformate bleiben
fail-closed mit dem sichtbaren Hinweis **Importbericht prüfen**.

Die externe Objektnummer muss genau einer offenen Rotationskopie, deren Quelle
und einem abgeschlossenen deterministischen Uploadjob im persistenten Ledger
entsprechen. Reportbeleg, Kopiestatus und Scheduler-Handover werden gemeinsam
per Katalog-CAS gespeichert. Neue Belege enden direkt im Status `confirmed`;
die Mail bleibt unverändert im serverseitig gepflegten Ordner. Message-ID und
SHA-256 des Raw-Inhalts verhindern eine zweite fachliche Mutation. Historische
`confirmed_mail_move_pending`- und `mail_move_manual_review_required`-Belege
bleiben ohne Migration lesbar und lösen keine erneute Mailaktion aus.

Der vollständige Datenfluss lautet:

```text
Immoprofessional
→ E-Mail
→ Outlook-/Exchange-Regel
→ Inseratestudio – Importberichte
→ lokaler Helper (read-only)
→ strikter Parser
→ eindeutige Objektnummer und Uploadbeleg
→ atomare Importbestätigung
```

Nach der Bestätigung übernimmt die neue Kopie die automatische Rotation mit dem
bestätigten Immoprofessional-Importzeitpunkt und dem regulär berechneten nächsten
Termin. Die alte Quelle bleibt extern und intern `published`, gibt aber die
Scheduler-Verantwortung ab und wird als **Ersetzt – externe Löschung
ausstehend** gekennzeichnet. Nur eine Kopie mit der beim Produktionslauf
persistierten Delete-Autorisierung wird anschließend vom separaten
Produktions-Deletedienst berücksichtigt. Historische
`externalDeletionPending`-Quellen ohne diesen Marker werden niemals als
Catch-up gelöscht.

### Einmalige Legacy-Reconciliation zweier Pre-Report-Canarys

Die normale Importbestätigung bleibt ausnahmslos reportbasiert:
`transferred_pending_import` wird weder durch FTPS-Erfolg, Zeitablauf,
fehlende Fehlermail noch eine allgemeine Portal-Sichtbarkeit zu `published`.
Für die zwei vor Einführung des maschinenlesbaren Berichtvertrags übertragenen
Replacements `30460-652921` und `30460-056361` existiert ein separater,
hart begrenzter Reconciliation-Pfad. Er ist zusätzlich an die bereits
persistierten Projekt-, Source-, Replacement- und Uploadjob-IDs gebunden und
akzeptiert keine weitere Objektnummer.

Vor jeder Mutation verlangt dieser Pfad einen höchstens 15 Minuten alten,
vom Benutzer unmittelbar vor der Ausführung anhand der exakten externen
Objektnummer erhobenen Nachweis, dass genau die Replacement-Objektnummer aktuell
im Immoprofessional-Bestand vorhanden ist. Der Beleg wird ausdrücklich mit
`verificationMethod: manual_immoprofessional_exact_object_number` und
`verifiedBy: user_confirmed_provider_presence` sowie als
`legacy_provider_presence_verification` gespeichert und enthält weder eine
erfundene Message-ID noch einen Report-Hash oder Provider-Importzeitpunkt.
`lastUploadedAt` stammt aus dem vorhandenen historischen FTPS-Transfer und wird
mit `historical_ftps_transfer_for_legacy_reconciliation` gekennzeichnet. Neue
und nicht allowlistete Pending-Imports können diesen Pfad nicht verwenden.

Die einmalige CLI verlangt für mutierende Befehle zusätzlich
`--legacy-mode one-time`; der globale Rotationsmodus und der reguläre
Produktions-Delete-Modus müssen dabei beide explizit gültig auf `off` stehen.
Ein Legacy-DELETE verwendet den unveränderten, bereits geprüften
Einzelobjektvertrag, ein eigenes Ledger und ausschließlich die alte
Quellobjektnummer. Nach einem begonnenen Transfer gibt es keinen Retry. Nur ein
exakter positiver Löschbericht finalisiert die Quelle. Dies ist keine normale
Produktionsfunktion und keine allgemeine „force publish“-Schnittstelle.

Nach einer erfolgreichen Reconciliation ist jeder der beiden Einträge durch
seinen persistenten Evidence-Eintrag und den deterministischen bestätigten
Deletejob verbraucht. Wiederholte CLI-Aufrufe bleiben idempotent und erzeugen
weder einen weiteren Upload noch einen zweiten DELETE. Der Legacy-Pfad wird
nicht vom Background-Scheduler aufgerufen und kann nicht auf andere externe
Objektnummern erweitert werden, ohne den kompilierten Vertrag zu ändern.

Die technische Delete-Discovery und der reale, ausschließlich auf
`30460-287191` begrenzte Einzel-Canary sind separat in
[`IMMOPROFESSIONAL_DELETE_CONTRACT.md`](IMMOPROFESSIONAL_DELETE_CONTRACT.md)
dokumentiert. Immoprofessional hat den dort festgehaltenen Einzelpayload über
einen eindeutigen objektbezogenen Löschbericht maschinell bestätigt. Daraus
allein folgt keine Betriebsfreigabe. Der Produktionspfad ergänzt einen
separaten globalen Delete-Modus `off | active`, eine deterministische Job-ID,
einen atomaren Claim und einen exakt auf die alte Objektnummer begrenzten
Einzelobjekt-Payload. Fehlende oder beschädigte Modus-/Ledgerdaten führen
fail-closed zu `off` beziehungsweise zum Abbruch.

Für kontrollierte, ausdrücklich freigegebene Einzel-Deletes existiert ein davon
getrenntes, fest kompiliertes Testwerkzeug. Es akzeptiert ausschließlich die
vorab read-only bestimmten Source-/Replacement-Paare, arbeitet strikt sequenziell
und kennt für Rotation und Löschung nur `off` und einen einzelnen `canary`.
Vor einem DELETE müssen das Replacement `published`, der positive
Importbericht, das Scheduler-Handover und `externalDeletionPending` der Quelle
eindeutig belegt sein. Das Löschziel ist hart die alte externe Objektnummer und
darf nie die Replacementnummer sein. Nach einem erfolgreichen DELETE-Transfer
gibt es keinen Retry. Erst mindestens ein eindeutiger realer Löschbericht mit
alter Objektnummer und positivem Löschstatus finalisiert die Quelle; weitere
Portalberichte sind zusätzliche Evidenz, keine zusätzliche Blockierbedingung.
Dieses Testwerkzeug ist keine allgemeine Löschautomation und aktiviert weder
`automaticDeletionEnabled` noch den Modus `active`.

Ein einmal vorbereiteter Live-Canary-Deletejob bindet außerdem seinen
Payload-Zeitpunkt und sein FTPS-Ziel persistent. Jeder spätere Preflight- oder
Transferaufruf muss dadurch exakt denselben Dateinamen, SHA-256 und dieselbe
Paketgröße erzeugen;
jede Abweichung stoppt vor FTPS mit
`LIVE_CANARY_DELETE_PAYLOAD_MISMATCH` fail-closed.

Der reguläre Produktions-Deletedienst wird unabhängig davon gesteuert:

```bash
node listing-rotation-production-delete-cli.mjs status
node listing-rotation-production-delete-cli.mjs mode --mode off
node listing-rotation-production-delete-cli.mjs mode --mode active
```

Im Modus `active` verarbeitet er ausschließlich neue, eindeutig markierte
Produktions-Lifecycles, strikt sequenziell und höchstens bis zum identischen
`maxRunItems`-Limit. Nach einem Transfer bleibt die alte Quelle `published` und
`delete_pending_confirmation`. Erst ein read-only gelesener positiver
Immoprofessional-Bericht mit Anbieter `30460`, Objektanzahl eins, exakter alter
Objektnummer, SPF-Vertrauensnachweis und ohne Warnung/Fehler setzt sie auf
`deleted`. Ein unklarer Transfer wird nie automatisch wiederholt; das
Replacement wird in keinem Delete-Pfad verändert.
Offene Löschberichte und neue Löschtransfers teilen sich dieses Dreierbudget.
Ein unterbrochener oder unklarer Deletejob blockiert fail-closed sämtliche
weiteren Delete-Transfers, bis der Zustand manuell geklärt wurde.

### Einmalige Katalog-Reconciliation des bestätigten Delete-Canarys

Der historisch bestätigte Einzel-Canary `30460-287191` besitzt einen eigenen,
fest kompilierten internen Reconciliation-Vertrag. Er darf ausschließlich den
bereits vorhandenen positiven Delete-Canary-Bericht in den lokalen finalen
Status `deleted` überführen. Der Pfad sendet weder FTPS noch eine Portalaktion
und wird von keinem Scheduler aufgerufen.

Vor der Mutation müssen Rotation und Production-DELETE gültig auf `off`
stehen. Zusätzlich müssen der Scheduler-Lock, Reservations, Process-Leases,
Pending-Rotationen und offene Upload-/Deletejobs fehlen. Projekt-, Listing-,
Objekt- und deterministische Canary-Job-ID sind exakt gebunden. Anschließend
ist `automaticUpdateEnabled=false`, weshalb der Datensatz nicht mehr als
Schedulerkandidat erscheinen kann. Wiederholungen sind idempotent.

```bash
node historical-delete-state-reconciliation-cli.mjs status
node historical-delete-state-reconciliation-cli.mjs reconcile \
  --external-id 30460-287191 \
  --reconciliation-mode one-time
```

### Einmalige Reconciliation des lokalen Pre-FTPS-Abbruchs

Der Vorgang `30460-462061` → `30460-131712` besitzt einen separaten, fest
kompilierten Ausnahmevertrag für genau den Production-Deletejob
`production-delete:338e05d2…`. Die damalige isolierte Runtime scheiterte beim
Laden von `macos-keychain.swift`; im betroffenen Uploadadapter liegt dieser
Schritt nach dem lokalen Claim-Marker, aber vor FTPS-Client, Verbindung und
Upload. Der allgemeine Schutz gegen Wiederholungen unklarer Transfers bleibt
unverändert.

Vor einer Mutation werden der alte Runtimecode, die fehlende Sidecar, das
strukturierte Delete-Auditlog, der unveränderte Payload, der leere
Transferabschluss, leere Berichtfelder und beide Livinghaus-Berichtsordner
read-only geprüft. Source, Replacement, Projekt, Listing-IDs, vollständige
Job-ID, Payloadname, SHA-256 und Größe sind exakt gebunden. Rotation und
Production-DELETE müssen `off` sein und der Scheduler-Lock muss frei sein.

```bash
node delete-pre-ftps-reconciliation-30460-462061-cli.mjs status
node delete-pre-ftps-reconciliation-30460-462061-cli.mjs reconcile \
  --external-id 30460-462061 \
  --replacement-external-id 30460-131712 \
  --delete-job-id production-delete:338e05d2aac17d3947aabd12f73f00a417e6faa33616dea207f96fdf19f55352 \
  --reconciliation-mode one-time-pre-ftps
```

Die Reconciliation setzt ausschließlich diesen Ledgerjob auditierbar auf
`delete_prepared` und die Source zurück auf den normalen autorisierten
Deletezustand. Sie erzeugt selbst keinen FTPS-Verkehr, keinen DELETE und keine
Mailmutation. Ledger-first-Teilzustände sind idempotent wiederaufnehmbar; der
Pfad wird weder vom Helper noch vom Scheduler automatisch aufgerufen.

## Dynamisches Inseratsmanagement und sichere Variantenrotation

Jede neue oder aus Excel importierte Adresse besitzt eine persistente
Inseratsgruppe mit maximal vier gleichzeitig aktiven, unterschiedlichen
Häusern. Der zentrale Hauspool selbst besitzt keine feste Obergrenze und dient
sowohl der Ersterstellung als auch allen späteren Rotationen. Bestehende
Datenstände werden beim Laden verlustarm in das aktuelle Schema migriert;
überzählige Altvarianten werden nicht als neue aktive Inserate übernommen.

Jede Variante speichert ID, Projektbezug, Reihenfolge, Freigabe, vollständigen
Haus-Snapshot, Bild- und Grundrissreferenzen sowie einen kompletten
Inseratentwurf. Preis, Wohnfläche, Zimmer, Energieangaben, Texte und Bilder
werden gemeinsam geprüft und nie voneinander losgelöst rotiert.

Die kleinste Prozesseinheit ist das einzelne Inserat. Dessen Sperren,
Health Score, Benutzerpriorität, letzter und nächster Termin sowie
Verarbeitungs-Lease werden unabhängig gespeichert. Der zentrale gewichtete
Rotationsservice wird gleichermaßen von Vorschau, Inseratsmanager und Scheduler
verwendet. Der Scheduler verteilt fällige Inserate über unterschiedliche
Adressen und beachtet Tageslimit, Adresslimit,
Mindestabstand, Erstwartezeit, Intervall, Wochentage und Zeitfenster.

Der Inseratsmanager zeigt alle Adressen gemeinsam und erlaubt Dry Run, lokale
Entwurfserstellung, Priorisierung, Pause, Premium-Sperre, Löschsperre, Modus
und ein gezielt ausgewähltes Ersatzhaus aus dem zentralen Pool. Fehler eines
Inserats werden isoliert protokolliert und stoppen den übrigen Tageslauf nicht.

Die Hausauswahl ist deterministisch gewichtet. Selten verwendete Häuser, lange
nicht genutzte Häuser und Häuser, die auf dem konkreten Grundstück noch nie
vorkamen, werden bevorzugt. Hohe parallele Nutzung, unmittelbare Grundstücks-
oder globale Wiederholungen und häufige Vierer-Kombinationen werden
benachteiligt oder ausgeschlossen. Haus-, Kombinations- und Creative-Historien
werden aus dem persistenten Katalog abgeleitet und nach der positiven
Importbestätigung fortgeschrieben. Die Verteilungsparameter liegen in
`house-distribution.mjs`, die zusätzliche Anti-Monotonie in
`listing-creative-selection.mjs`.

Automatisches Löschen bleibt standardmäßig `off` und wird nur als zweite,
separat freizugebende Stufe eines neu markierten Produktions-Lifecycles
ausgeführt. Auswahl, Prüfung, dynamische Rotation, eindeutige neue
Objektnummer, Importbestätigung und Löschbestätigung sind getrennte persistente
Schritte; Dry Runs veröffentlichen und löschen grundsätzlich nichts.

## Konsistenz, Idempotenz und lokale Migration

Version 0.15.0 vereinheitlicht alle fachlichen Zustände auf `draft`,
`prepared`, `scheduled`, `processing`, `published`, `blocked`, `failed`,
`archived` und `deleted`. Ältere deutsche Statuswerte werden beim Laden
verlustfrei in dieses Modell überführt. Feste OpenImmo-Standardwerte liegen nur
noch in `listing-copy.mjs`; bestehende Benutzereingaben werden nicht
überschrieben, fehlende Werte werden ergänzt.

Jeder Upload besitzt eine deterministische Job-ID. Der Browser verhindert
Doppelklicks und parallele Ausführung, der lokale Helfer führt zusätzlich ein
atomar geschriebenes Jobprotokoll mit Verarbeitungs-Lease. Bereits bestätigte
Jobs werden nach einem Neustart nicht erneut übertragen. Pro Grundstück kann
gleichzeitig nur ein aktives Inserat ein Aktionsbild tragen.

Beim Laden führt die App eine idempotente, sichere Datenmigration aus. Sie
entfernt das abgeschaffte Feld „Zusätzliche Hinweise“, vereinheitlicht Status,
begrenzt Logs, löst abgelaufene Sperren und deaktiviert überzählige aktive
Hausvarianten nach dem vierten Platz. Widersprüchliche produktive Dubletten
werden nicht automatisch gelöscht. Der lokale Helfer führt dieselbe Migration
vor dem Serverstart und vor jeder Katalogsicherung aus, schreibt den Bestand
atomar und legt einmalig eine Vor-Migrationssicherung an. Alle verwalteten
Aktionsbilder werden separat gesichert. Das Prüfskript
`scripts/audit-studio-catalog.mjs` arbeitet standardmäßig im Dry Run und darf
eine bereinigte Kopie nur mit explizitem `--apply --output` erzeugen.

Die Excel-Importvorlage enthält 14 fachliche Spalten und kein Hinweisfeld mehr.
Grundstücks- und Bilddaten bleiben lokal; es existiert in dieser Mac-Version
keine Supabase-, SQL- oder Vercel-Datenbankmigration.

## Mehrfachauswahl und Sammel-Upload

Die zentrale Grundstücksauswahl in Schritt 01 ist dynamisch und besitzt keine
feste Obergrenze. Für jede markierte Adresse erzeugt die App direkt darunter aus dem
zentralen Hauspool eine gewichtete, bearbeitbare Vierer-Kombination. Beim
Übernehmen lädt sie Grundstücksdaten und vollständige Hausvarianten, ergänzt
ausschließlich fehlende Standardwerte, erzeugt die Inseratentwürfe und ordnet
die vorhandenen Hausbilder zu. Ein Pool mit weniger als vier aktiven,
freigegebenen und vollständigen Häusern blockiert die Vorbereitung eindeutig.

Die Uploadübersicht zeigt jede Adresse mit Inseratanzahl, Hausvarianten,
Aktionsbild, Status, Gesamtzahl und Laufzeitschätzung. Der eigentliche Upload
läuft strikt sequenziell: Adresse für Adresse und darin Inserat für Inserat.
Ein Paket wird vollständig abgeschlossen, bevor das nächste beginnt. Fehler
werden je Inserat gespeichert und angezeigt; die übrige Warteschlange läuft
weiter.

Die Aktionsbildverwaltung unterstützt beliebig viele Motive mit Vorschau,
Dateiname, Aktivstatus, Priorität, Reihenfolge, letzter Verwendung und
Verwendungszähler. Automatische Rotation, Zufall und manuelle Auswahl sind
separat schaltbar. Pro Adresse wird technisch höchstens einem Inserat ein
Aktionsbild zugeordnet. Nach einem erfolgreichen Upload werden Motiv,
Inserat, Objektnummer und Zeitpunkt in der lokalen Nutzungshistorie gespeichert.
Diese Historie steuert bei späteren Aktualisierungen die nächste Kombination.

Für jedes bearbeitete Inserat speichert die App zusätzlich Projekt-ID,
Adresssnapshot, Objektnummer, Hausvariante, Aktionsbild, Erstellungszeit,
letzte und nächste Aktualisierung, Status und Fehler. Die Daten verbleiben in
der bestehenden Browser- und macOS-Sicherung; es wurde keine neue Cloud- oder
Datenbankabhängigkeit eingeführt.

## OpenImmo und Immoprofessional

Der Export verwendet OpenImmo 1.2.7 und überträgt jedes ausgewählte Inserat als
separates ZIP. Die technische Aktion `CHANGE` verwendet die eindeutige externe
Objekt-ID für kontrollierte Upserts. Automatisch
gesetzt werden Wohngebiet, Nutzfläche, Dachboden, Gäste-WC, Gartennutzung,
Fußbodenheizung, Elektro/Luft-Wärmepumpe, KFW40 und KFW55 sowie Energieklasse
A++. Küche wird als Einbauküche und offen übertragen; beim Bad werden Dusche,
Wanne und Fenster markiert. Als Umgebung werden Bus und Einkaufsmöglichkeit
ergänzt. Diese Ausstattungswerte stammen aus der gemeinsamen
Standardwert-Konfiguration: Fehlende Angaben erhalten den Standard,
vorhandene Benutzerwerte werden nicht überschrieben. Adressfreigabe und
allgemeine Weitergabe bleiben deaktiviert.

## Verbindliche Inserattexte

Die Überschrift wird lokal und reproduzierbar aus einem emotionalen Einstieg,
Ort oder Ortsteil, gerundeter Wohnfläche, Zimmerzahl und zwei kurzen Vorteilen
aus der Living-Haus-Checkliste aufgebaut. Verwendet werden beispielsweise
18 Monate Festpreis, I-KON, Bau-Cockpit, DGNB-Gold, QNG-Potenzial oder die
30-jährige Garantie. Konkrete Förderbeträge werden nicht versprochen.

Die KI erhält und schreibt ausschließlich die emotionale, haustypbezogene
Objektbeschreibung und die generische Lagebeschreibung. Überschrift,
Ausstattung, Sonstiges und rechtliche Texte sind kein Bestandteil der
KI-Ausgabe. Die in Schritt 03 sichtbare Überschrift wird auch dann im Browser
erneut verbindlich eingesetzt, wenn ein älterer Helferprozess eine abweichende
Überschrift zurückgeben sollte. Textfeld und Portalvorschau zeigen deshalb
exakt dieselbe Überschrift. Bestätigte Zusatzangaben zum Ort oder
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

OpenImmo-Merkmale werden je Inserat nur bei fehlenden Werten ergänzt. Die
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

## Zentrale Grundstücksliste und Excel-Import

Schritt **01 Grundstücke & Auswahl** enthält die einzige Grundstücksliste und
die einzige Mehrfachauswahl. Eigentümerkennungen bleiben intern für vorhandene
Daten erhalten, erzeugen jedoch keine getrennten Adressbücher oder eine zweite
Auswahloberfläche. Anlage, Bearbeitung, Löschung, Excel-/PDF-Import und Exposé-
Verwaltung befinden sich direkt in dieser Liste. Änderungen werden in Browser-
und macOS-Sicherung übernommen.

Über **Excel-Vorlage herunterladen** steht die geprüfte Importvorlage bereit.
Jede Tabellenzeile enthält ein Grundstück; Pflichtfelder sind Benutzer,
Straße, PLZ und Ort. Beim Import werden deutsche Zahlenformate und führende
Nullen in Postleitzahlen berücksichtigt. Dubletten sowie unvollständige Zeilen
werden ausgelassen und in der Oberfläche gemeldet. Ein mitgelieferter
GeoNames-Datensatz ordnet PLZ und Ort ohne Online-Anfrage einem Bundesland und
Landkreis beziehungsweise einer kreisfreien Stadt zu. Die Liste bleibt nach
diesen Gebieten gruppiert und lässt sich innerhalb jeder Gruppe nach Ort, PLZ,
Grundstücksgröße, Kaufpreis, Uploaddatum oder Inseratsanzahl sortieren.
Mehrdeutige oder nicht enthaltene Zuordnungen werden als **Ohne PLZ-Zuordnung**
geführt, statt einen Landkreis zu raten. Bereits gespeicherte Grundstücke werden beim Laden ebenfalls
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

## Integrierte Medienbibliothek

Beim Öffnen der Bibliothek indexiert die App die unterstützten JPEG-, PNG- und
WebP-Dateien unter `bundled-media/advertisements` sowie die Motive unter
`bundled-media/interiors`. Ordnerstruktur und Dateinamen werden für
Gruppierung, Bildrolle und Beschriftung verwendet. Erkannte Kategorien sind
Hausansicht, Innenraum, Grundriss, Standort und allgemeine Anzeige. Suche,
Gruppen- und Kategorienfilter begrenzen die Ansicht auf jeweils 36
Vorschaubilder.

Für die Grundrisszuordnung werden SUN/SOL-Familie, Modellnummer, Version,
Dachform und Etage aus Hausansicht und Grundriss gelesen. Das Erdgeschoss steht
immer vor Ober- oder Dachgeschoss. Eine dritte Etage wird separat eingeordnet.
Zusätzlich kann jedes manuell importierte Bild einer Rolle zugeordnet und die
gesamte Folge anschließend nach Rollen normalisiert werden.

Beim Übernehmen werden ausgewählte Dateien in den lokalen Haustyp kopiert und
danach wie manuell gewählte Bilder doppelt gesichert. Eine stabile Quell-ID
verhindert die erneute Übernahme desselben Motivs. Nicht geladene Git-LFS-Dateien
werden mit einem klaren Hinweis auf `git lfs pull` abgelehnt, statt einen
unbrauchbaren Zeiger als Bild zu speichern.

Für bewusst abweichende externe Bibliotheken können die Pfade vor dem Start über die
Umgebungsvariablen `FPI_MEDIA_LIBRARY_ROOT` und
`FPI_INTERIOR_LIBRARY_ROOT` gesetzt werden.

Details zur Sicherheitsanalyse stehen in [SECURITY-ANALYSIS.md](SECURITY-ANALYSIS.md),
die technische Änderungsübersicht in [CHANGELOG.md](CHANGELOG.md).
