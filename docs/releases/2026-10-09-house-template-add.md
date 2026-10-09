# Haustypen über den Starterkatalog hinaus ergänzen

## Änderung

Die feste Obergrenze von 22 Haustypen in der Aktion „Haustyp hinzufügen“ wurde entfernt. Sowohl „+“ als auch die beschriftete Schaltfläche legen eine neue Vorlage an und öffnen sie zur Bearbeitung. Die Hausbibliothek und die Übersicht zeigen die tatsächliche Anzahl. Eine Bestätigung benennt den neu angelegten Haustyp.

## Begründung

22 ist die Anzahl der vorhandenen Startervorlagen, keine Grenze der Katalog-Persistenz. Beide Schaltflächen nutzten dieselbe Aktion, die bei genau diesem Bestand frühzeitig abbrach. Der bestehende Vorlagen-Editor, die Standardwerte und die lokale Speicherung können zusätzliche Haustypen bereits verwalten; eine Änderung der Datenarchitektur ist nicht erforderlich.

## Hürden und Risiken

Die bisherige Ablehnung erschien oberhalb des Arbeitsbereichs und war bei der Hausbibliothek leicht zu übersehen. Der bisher statische Bibliothekstitel verstärkte den Eindruck, dass nichts passiert. Neue Vorlagen bleiben ohne Bilder, Hauspreis und ungeprüfte technische Angaben; ihre spätere Verwendung folgt den bestehenden Prüfungen. Bildlimit, bestehende Haustypen, Grundstücke und Inserate werden nicht verändert.

## Prüfung

Beide Schaltflächen wurden in der echten App-Komponente mit einer isolierten Bibliothek von zunächst 22 Haustypen geprüft: Anlage des 23. und 24. Haustyps, Wechsel in den Editor, Bearbeitung, lokale Speicherung und Wiederöffnung erfolgreich. Die zwei umbenannten Testvorlagen bleiben nach dem Neuladen erhalten. Der Helper-Endpunkt dieser Test-App wird ausschließlich auf einen temporären Testkatalog umgeleitet; produktive Testvorlagen und Inserat-Uploads werden nicht erzeugt.

Gesamtsuite: 716 Tests bestanden, ein Test planmäßig übersprungen. ESLint und Produktions-Build erfolgreich.
