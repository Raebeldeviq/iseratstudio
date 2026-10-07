# Lokal gepflegte Grundstücke bei der Bereinigung behalten

## Änderung

Ein Grundstück im vorhandenen Suchgebiet kann mit `keepInActiveCatalog` ausdrücklich auch ohne Eintrag in der aktuellen Masterdatei behalten werden. Das Merkmal bleibt beim Speichern, Neustart und Pool-A/B-Abgleich erhalten. Neue manuell angelegte Grundstücke erhalten es bereits im bestehenden Editor; bestehende Grundstücke können es dort ebenfalls setzen.

Die neun von Pascal benannten Grundstücke werden mit diesem Merkmal lokal hinterlegt. Die einmalige Bereinigung bleibt unbestätigt. Erwartete Vorschau: 21 im eigenen Suchgebiet, 0 Exklusiv, 103 aus der aktiven Auswahl auszublenden.

## Begründung

Ein fehlender Mastereintrag ist kein ausreichender Grund, ein ausdrücklich lokal gepflegtes Grundstück aus der Auswahl zu entfernen. Eine dauerhafte Entscheidung am vorhandenen Grundstück erhält dessen `plotId`, Pool A/B und Verknüpfungen. Es gibt keine hart codierte Liste von Grundstücken in der Auswahlregel und keine neue Gebietslogik.

## Hürden und Risiken

Frühere Datensätze enthalten keinen verlässlichen Herkunftsnachweis für eine automatische Unterscheidung zwischen historischem und gewolltem lokalem Bestand. Deshalb werden ausschließlich die neun konkret benannten Grundstücke ausdrücklich behalten. Andere Altgrundstücke werden nicht automatisch wieder aktiviert. Das Merkmal wirkt nur innerhalb des vorhandenen Suchgebiets; außerhalb bleibt die separate Exklusiventscheidung erforderlich. Ungültige Adressen und archivierte Grundstücke werden weiterhin nicht auswählbar.

Die lokale Datenanpassung ergänzt ausschließlich das Merkmal an diesen neun Datensätzen. Historische Inserate, Bilder, Uploadhistorien, Lösch-Batches und Auditdaten bleiben erhalten. Ein später ausdrücklich gestarteter Masterabgleich kann die behaltenen lokalen Grundstücke über den bestehenden Pool-A/B-Weg übernehmen; diese Korrektur führt keinen Excel-Schreibzugriff oder Portalaufruf aus.

## Prüfung

Regressionen decken die Vorschau und bestätigte Auswahl nach Neustart, die Grenze zu externen/ungültigen Grundstücken sowie Normalisierung und Pool-A/B-Abgleich ab. Dazu Gesamtsuite, ESLint und Produktions-Build. Anschließend wird die aktualisierte Vorschau geöffnet; Pascal bestätigt die Bereinigung selbst.
