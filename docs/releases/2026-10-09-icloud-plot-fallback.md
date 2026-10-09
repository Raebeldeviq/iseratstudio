# iCloud-Ausfallsicherheit der Grundstücksansicht

## Änderung

- Der bestätigte lokale Grundstückskatalog bleibt bei Lesefehlern der Master-Excel bedienbar. Die letzte gültige Quelle einschließlich Suchgebiet wird als Metadatum `activePlotCatalog.lastValidSource` im vorhandenen Katalog gespeichert.
- Ältere Kataloge ohne diese Metadaten verwenden bei einem Master-Ausfall zunächst das vorhandene lokale Suchgebiet. Ein gespeicherter gültiger Gebietsstand hat im Ausfall Vorrang.
- Die Oberfläche meldet „Excel momentan nicht erreichbar“, erklärt die lokale Anzeige und bietet „Erneut prüfen“. Die reguläre Statusabfrage entfernt die Warnung nach Wiederverbindung automatisch. Excel-Synchronisation und eine zuvor geöffnete Bestätigung sind während des Ausfalls gesperrt.
- Fehlende, unlesbare und leere Master-Dateien werden vor Sperrdatei und Katalog-Staging abgewiesen. Auch ein Lesefehler unmittelbar vor dem Ersetzen der Datei verwirft den vorbereiteten Abgleich.
- Die Adress-Prüfliste zählt und zeigt ausschließlich den bestätigten aktiven Bestand. Damit bleiben 35 nutzbare Grundstücke und 16 Prüffälle getrennt sichtbar; ausgeblendete Altgrundstücke kehren nicht in die Auswahl zurück.

## Begründung

Die bisherige Verfügbarkeit der Excel-Quelle steuerte zugleich die Sichtbarkeit lokaler Grundstücke. Die Trennung von Verbindungsstatus und gültigem lokalem Gebietsstand beseitigt diese Kopplung mit der bestehenden Katalog-Persistenz. Grundstücksdatensätze, Pool A/B, Projekte, Inserate, Uploadhistorien und Lösch-Batches werden durch den Fallback nicht geändert. Die vorhandene Bereinigungsfreigabe bleibt Voraussetzung; es findet keine neue Bereinigung statt.

## Hürden und Grenzen

- iCloud kann bei vorhandenen Dateien vorübergehend Lesefehler liefern. Dateiexistenz allein belegt deshalb keinen gültigen Import; der Abgleich prüft lesbare Inhalte und mindestens eine Pool-A-Zeile.
- Ohne gespeicherten Gebietsstand und ohne lesbare lokale Suchgebiet-Datei wird kein Gebiet geraten. Der bestätigte Bestandskatalog wird beim regulären Öffnen um die letzte gültige Quelle ergänzt.
- Bereits bestätigte Bereinigungen werden nicht erneut ausgeführt. Der Fallback ist keine Excel-Synchronisation und aktualisiert keine Grundstücke aus einer alten Master-Kopie.
- Leere Master-Dateien werden vorsorglich nicht synchronisiert. Eine initial fehlende Master-Datei wird durch diesen Abgleich nicht mehr automatisch neu angelegt.

## Prüfung

Regressionstests decken Online-Anzeige, Offline-Neustart mit 51/35/16, vorhandenes Suchgebiet als Rückfall, Vorrang der gespeicherten Quelle, Wiederverbindung, fehlende/leere Excel, Abbruch vor Schreibzugriffen, Ausfall während des Abgleichs, unveränderte Pool-/Historien-/Löschdaten und erfolgreichen erneuten Abgleich ab. Die echte Grundstückskomponente wird zusätzlich mit Online-/Offline-Status gerendert und auf Warnung, verfügbare Auswahl und gesperrte Synchronisation geprüft.

Gesamtsuite: 717 Tests, davon 716 bestanden und ein Test planmäßig übersprungen. ESLint und Produktions-Build erfolgreich. Die zusätzliche TypeScript-Prüfung zeigt vier unveränderte, auch auf dem aktuellen `main` reproduzierte Befunde in Listing-/Textgenerator-Typen; dieser Fix ergänzt keine Typfehler.

Die isolierte Browserprüfung mit dem echten lokalen Bestand bestätigt 35 auswählbare Grundstücke, 16 gesperrte Prüffälle, sichtbare Warnung und gesperrten Excel-Abgleich während des Ausfalls. „Erneut prüfen“ entfernt nach Wiederverbindung die Warnung und aktiviert den Abgleich wieder; die Auswahl bleibt bei 35.

Installation und Laufzeitprüfung verändern weder produktive Master-Excel noch Inserate; es erfolgen keine Uploads und keine Datenbereinigung.
