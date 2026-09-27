# Wiederherstellung produktionskritischer Inseratestudio-Funktionen – 27. September 2026

## Report

Der Stabilisierungsbranch stellt vier bereits früher vorhandene Verträge wieder her:

- Der lokale Arbeitsbestand eines Grundstücks kann über den wiederhergestellten Desktop-Dialog auf null gesetzt werden. Grundstück, Auditdaten, belegte Facts, Nummernfolge und andere Projekte bleiben erhalten; der Reset besitzt keinen Netzwerkpfad.
- Neue reguläre Inserate erhalten eine global persistierte, kollisionsgeprüfte Nummer im Format `30460-N`. `objektnr_extern`, `openimmo_obid` und `kennung_ursprung` verwenden dieselbe Nummer. Zusätzlich prüft jeder FTPS-Pfad das fertige ZIP und blockiert `FPI-...`, unvollständige oder voneinander abweichende IDs.
- Verifizierte `energy_certificate`-Facts bleiben in Normalisierung, Textregeneration, Batchvorbereitung und Rotation erhalten. Beim Reset liegen sie unverändert im bestehenden Resetarchiv und werden für dieselbe Projekt-/Hauskombination wieder aufgenommen. Ohne verifizierte Facts erzeugt der Serializer weiterhin keinen Energieausweis.
- Der feste Provisionstext wird sowohl über `courtage_hinweis` als auch über das für das ausführliche Immoprofessional-Feld bestätigte Property-Level-Feld `user_defined_simplefield feldname="anklickbar"` ausgegeben. Der historische 5,8-Prozent-Text bleibt ausgeschlossen.

## Begründung des Ansatzes

Die Git-Historie zeigt, dass Reset und persistenter Nummernkreis bereits in den Commits `939e26c`, `2dbb33a` und `e536f2f` implementiert und getestet waren. Diese Linie zweigte bei `a4b234b` ab und wurde nie in die spätere Produktionslinie bis `5e1adc1` integriert. Es gab daher keinen einzelnen späteren Lösch-Commit; die Funktionen gingen beim Fortführen der anderen Branch-Linie verloren.

Die bewährten Module und UI-Verträge wurden auf den aktuellen Produktionsstand übertragen und an dessen inzwischen vorhandene Lifecycle-, Compliance-, Energie-Fact- und Upload-Guard-Architektur angebunden. Provision und Energie-Serializer wurden nicht neu erfunden: Das vorhandene Mapping aus `82ebe20` und die evidenzgebundene Energiepasslogik aus `17b50c4` wurden durch Golden-Tests und Lifecycle-Erhalt abgesichert.

## Hürden und Risiken

- Der aktuelle persistierte Katalog enthält noch einen batchfähigen historischen Entwurf mit `FPI-...`-Kennung. Ein Smoke-Test direkt auf dem rohen Snapshot wird deshalb korrekt fail-closed blockiert. Dieselbe In-Memory-Normalisierung wie beim App-Start vergibt dafür die nächste persistierte `30460-N`; danach bestehen alle vier aktuell batchfähigen Inserate den OpenImmo- und ZIP-Guard. Der reale Katalog wurde bei dieser Prüfung nicht geschrieben.
- Ein Reset darf Beweis- und Lifecycle-Daten nicht physisch vernichten. Die aktiven Datensätze werden deshalb aus dem Arbeitsbestand entfernt, aber vollständig im vorhandenen unveränderlichen `listingResetHistory` archiviert. Verifizierte Facts werden bei einer neuen Variante derselben Projekt-/Hauskombination als Kopie wieder aufgenommen.
- Historische bereits veröffentlichte `FPI-...`-Objekte bleiben als Auditbestand lesbar. Sie können jedoch nicht erneut regulär exportiert werden, solange sie nicht bewusst in einen neuen `30460-N`-Arbeitsdatensatz überführt wurden.

## Verifikation

- fokussierte Golden-/Reset-/Objekt-ID-/Energie-/Provisionstests: PASS;
- vollständige Testsuite: 635 Tests insgesamt, 634 bestanden, 0 fehlgeschlagen, 1 erwarteter Windows-Skip;
- ESLint: 0 Fehler, 0 Warnungen;
- Produktions-Build: PASS;
- isolierter Start des gebauten Webteils auf einem alternativen lokalen Port: HTTP 200;
- read-only Compliance-Scan: 30 Inserate, `BLOCK = 0`, `REVIEW = 0`;
- OpenImmo-Smoke nach ausschließlich flüchtiger App-Normalisierung: 4/4 batchfähige Inserate in einem Projekt, 52 Bilder nur im Arbeitsspeicher, kein Schreiben und kein Upload;
- produktiver Upload, Portaländerung, Löschung, Rotation oder Änderung von `main`/`origin/main`: nicht durchgeführt.
