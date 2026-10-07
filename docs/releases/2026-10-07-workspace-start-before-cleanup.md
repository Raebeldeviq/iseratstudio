# Start vor der Grundstücksbereinigung

## Änderung

Die Haupt-App kann vor der einmaligen Bereinigungsbestätigung und während eines vorübergehend fehlenden Master-Zugriffs starten. Die Darstellung verwendet dafür bei leerer operativer Auswahl ein vorhandenes Projekt. Grundstücksfreigabe, Auswahl für neue Inserate und zentrale Erzeugung bleiben an die geprüfte aktive Auswahl gebunden.

## Begründung

Die Startprüfung benötigt ein Projekt für die vorhandenen Detailansichten. Vor der Bereinigungsbestätigung ist die neue operative Projektliste absichtlich leer. Diese Liste durfte deshalb nicht zugleich die Voraussetzung für das Öffnen der Bereinigungsvorschau sein. Die Projektwahl für die Oberfläche verwendet nun die vorhandenen gespeicherten Projekte als Rückfall.

## Hürde und Risiken

Ein erfolgreicher Build und eine gesunde Serverantwort hatten den blockierten Startbildschirm nicht erkannt. Die neuen Regressionstests prüfen den konkreten Zustand ohne Freigabe sowie ein vorübergehend nicht lesbares Master-Dokument. Sie bestätigen zugleich, dass historische Listings unverändert bleiben und kein Grundstück für neue Inserate freigegeben wird. Abschließend wird die tatsächlich geöffnete Browseransicht geprüft.

## Prüfung

14 fokussierte Tests bestanden. Gesamtsuite: 706 Tests, 705 bestanden, 1 bestehender Skip, 0 Fehler. ESLint und Produktions-Build bestanden. Historische Datensätze werden durch die Darstellungswahl nicht verändert.
