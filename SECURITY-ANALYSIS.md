# Sicherheits- und Schwachstellenanalyse

Stand: 23. Juli 2026

## Behobene Schwachstellen

### Hoch: Zugangsdaten im Browser und in Upload-Headern

Die bisherige Oberfläche lud gespeicherte Geheimnisse vollständig in den
Browser und sendete FTP-Benutzername und Passwort bei jedem Upload in eigenen
HTTP-Headern. Jetzt bleiben Geheimnisse nach dem Speichern ausschließlich im
lokalen Helfer und im macOS-Schlüsselbund. Die Oberfläche sieht nur, ob die
benötigten Zugänge vorhanden sind.

### Hoch: Unverschlüsselter FTP-Transport

Der bisherige Upload erzwang Klartext-FTP. Standard ist jetzt explizites FTPS;
die Zertifikatskette und der Hostname werden geprüft. Implizites FTPS ist
verfügbar. Klartext-FTP erfordert eine bewusste Auswahl und eine zusätzliche
Warnung vor dem Upload. Der Standardhost ist der vom Zertifikat abgedeckte Name
`server22.immoprofessional.eu`. Frühere LivingHaus-Aliase werden vor jeder
Zugangsprüfung automatisch darauf normalisiert; die Hostprüfung wird nicht
umgangen.

### Hoch: Lokaler Helfer nur durch Origin-Prüfung geschützt

Eine Origin-Prüfung schützt nicht gegen jeden lokalen Prozess. Der Helfer
fordert nun zusätzlich für jede Anfrage ein zufälliges Sitzungstoken. Dieses
wird beim Start erzeugt, mit Modus `0600` gespeichert und nur über das nicht an
den Webserver gesendete URL-Fragment an die Oberfläche übergeben.

### Mittel: Windows-exklusive Daten- und Geheimnisspeicherung

`LOCALAPPDATA`, PowerShell und DPAPI wurden durch native macOS-Pfade und den
macOS-Schlüsselbund ersetzt. Die bestehende Windows-Implementierung bleibt im
Code als kompatibler Zweig erhalten.

### Mittel: Unbeabsichtigter Sammelupload

Vor dem Upload können einzelne Inserate explizit an- und abgewählt werden. Die
Bestätigung nennt die tatsächliche Anzahl und warnt bei Klartext-FTP.

### Mittel: Zugang wurde gespeichert, aber nicht geprüft

Ein neu eingegebenes Immoprofessional-Passwort wird erst gespeichert, nachdem
Anmeldung, Transportart, Zertifikat und Zielordner erfolgreich geprüft wurden.

### Mittel: Unvollständige OpenImmo-Pakete erst beim Ziel erkannt

Vor dem Packen werden jetzt Adresse, fünfstellige PLZ, Grundstücksfläche,
Anbieterdaten, eindeutige Objekt-IDs, Kaufpreis, Pflichttexte sowie Anzahl und
Format der Bilder geprüft. SVG und unbekannte Bildformate gelangen nicht in ein
Importpaket.

### Mittel: Freier lokaler Dateizugriff über die Medienoberfläche

Die neue Medienbibliothek akzeptiert keine Dateipfade aus dem Browser. Sie
liefert ausschließlich Dateien aus einem serverseitig aufgebauten Index. Die
Liste benötigt das lokale Sitzungstoken; Vorschaubilder und Übernahmen nutzen
HMAC-signierte URLs, ohne das Sitzungstoken offenzulegen. Symlinks und nicht
unterstützte Dateitypen werden beim Indexieren ausgelassen, einzelne Dateien
sind auf 100 MB begrenzt.

### Mittel: Unbegrenzte lokale Excel- und Aktionsbildimporte

Die neuen lokalen Importwege akzeptieren ausschließlich `.xlsx` beziehungsweise
JPEG, PNG und WebP. Excel-Dateien sind auf 10 MB und Aktionsbilder auf 25 MB
begrenzt. Die Arbeitsmappe wird ausschließlich im Browser verarbeitet und nicht
an den lokalen Helfer, OpenAI oder Immoprofessional übertragen. Erst daraus
erzeugte, vom Benutzer ausgewählte Inseratdaten können später exportiert werden.

### Mittel: Falsche oder unvollständige Exposé-Bildfolge

Hausansicht und Grundrisse werden anhand von Familie, Modell, Version, Dachform
und Etage verknüpft. Eine automatische Folge wird nur atomar übernommen, wenn
alle sechs unterschiedlichen Innenraumrollen, die erforderlichen Grundrisse und
die drei Abschlussmotive vorhanden sind. Die OpenImmo-Prüfung kontrolliert die
Rollen erneut, erkennt Duplikate und blockiert mehr als 14 Bilder. Weder ein
fehlendes Bild noch ein zusätzliches Aktionsbild führt zu stillem Abschneiden.
Die feste Beschriftung der fachlichen Rollen ist gegen die KI-Textfunktion
gesperrt.

### Mittel: Falscher Hauspreis durch Bild- oder Grundrissvariante

Die Hauspreise liegen in einem unveränderlichen, getesteten Modellkatalog. Die
Zuordnung ignoriert ausschließlich Bildversionen und Dachformen; L und XL
bleiben unterschiedliche Preismodelle. Soweit das Titelbild L/XL nicht nennt,
wird die Kennung aus dem versionsgenau ausgewählten Grundriss gelesen.
Mehrdeutige, widersprüchliche oder unbekannte Kennungen führen zu keiner
automatischen Preisänderung. Der erkannte Listenpreis bleibt in der Hausmaske
sichtbar und kann nach manuellen Änderungen gezielt wiederhergestellt werden.

## Verbleibende Risiken und Grenzen

1. Die App kann den Immoprofessional-Importbericht nicht automatisiert abrufen,
   solange keine dokumentierte Status-API oder Rückkanal-Konfiguration vorliegt.
2. Der Klartext-FTP-Modus bleibt aus Kompatibilitätsgründen vorhanden. Er sollte
   nur verwendet werden, wenn der Anbieter nachweislich kein FTPS unterstützt.
3. Ein vom Anbieter verlangtes Client-Zertifikat ist nicht konfiguriert. Die
   aktuelle Lösung prüft das Serverzertifikat. Für gegenseitiges TLS werden die
   exakten Immoprofessional-Vorgaben und ein sicherer Zertifikatsimport benötigt.
4. OpenImmo-Felder und rechtliche Aussagen müssen vor dem ersten Live-Einsatz
   anhand eines realen Importberichts und der aktuellen Leistungsbeschreibung
   fachlich abgenommen werden.
5. Der Entwicklungsserver ist für den lokalen Einzelplatzbetrieb gedacht. Für
   Verteilung an mehrere Macs sollte daraus ein signiertes und notarisiertes
   App-Bundle mit fest gebauter Oberfläche entstehen.
6. Die integrierten Originalbilder werden mit Git LFS verteilt. Ein unvollständig
   ausgeführter Checkout enthält nur kleine Zeigerdateien; der Helfer erkennt
   diese und verlangt `git lfs pull`, statt sie als Bilder weiterzugeben.
7. Die Adressansichten von Fabian und Pascal liegen im selben lokalen Katalog.
   Sie verhindern versehentliche Vermischung in der Oberfläche, ersetzen aber
   keine getrennten macOS-Benutzerkonten bei unterschiedlichen Zugriffsrechten.
8. Sieben in der Bibliothek vorhandene Hausvarianten besitzen aktuell keine
   exakt passende Grundrissversion; eine weitere Datei enthält keine
   Modellnummer. Die automatische Folge blockiert diese Fälle. Die fehlenden
   Originaldateien müssen fachlich korrekt ergänzt werden und dürfen nicht
   durch ähnlich benannte Versionen ersetzt werden.
9. Der Hauspreiskatalog ist eine lokale Momentaufnahme der bereitgestellten
   Preisliste. Er enthält kein automatisches Gültigkeitsdatum und keinen
   Herstellerabgleich. Vor Veröffentlichungen muss bestätigt werden, dass der
   hinterlegte Preisstand noch freigegeben ist.
10. Der FTPS-Servername wurde über DNS, Reverse-DNS und das ausgelieferte
    Zertifikat technisch bestätigt. Eine spätere Servermigration durch
    Immoprofessional erfordert eine erneute Prüfung des offiziell zugewiesenen
    Hostnamens.

## Abhängigkeitsprüfung

Der Produktions-Audit meldete zunächst eine hohe `sharp`- und eine mittlere
`postcss`-Schwachstelle aus der Next-Abhängigkeitskette. Next wurde auf 16.2.11
aktualisiert; `sharp` 0.35.3 und `postcss` 8.5.22 werden über das reproduzierbare
pnpm-Lockfile erzwungen. Der abschließende Produktions-Audit ist ohne Befund.

## Empfohlener Abnahmetest

1. FTPS-Zugang über **Zugangsdaten prüfen & speichern** validieren.
2. Ein Testprojekt und genau einen Inseratentwurf auswählen.
3. ZIP zusätzlich lokal herunterladen und XML, feste Bildüberschriften sowie
   die Reihenfolge von Aktionsbild, Haus, Innenräumen und Grundrissen prüfen.
4. Testobjekt hochladen, Importbericht kontrollieren und Entwurfsstatus prüfen.
5. Erst nach dokumentierter Freigabe weitere Objekte übertragen.
