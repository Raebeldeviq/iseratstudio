# Nachschubupload nach Manager-Bereinigung

## Report

Der Upload-Guard unterscheidet eine bestätigte Löschquelle von ihrer späteren Entfernung aus der Manageransicht. Eine bereits gespeicherte Einzelreservierung bleibt gültig, wenn die Quell-ID, Objektnummer, Grundstücks-ID, Hausposition und der Quellhaustyp weiterhin eindeutig passen und der erhaltene Löschbeleg die Buchung bestätigt.

Für bereinigte Quellen wird zusätzlich entweder der eindeutig gelöschte Batch-Eintrag oder der zugehörige Exportbericht-Beleg mit identischer Prüfsumme, Bestätigungszeit und Quellidentität geprüft. Die dokumentierte Managerbereinigung muss nach der Vorbereitung erfolgt sein. Die Anzeige-Korrektur wird nicht rückgängig gemacht.

Erhaltene Quellen im Resetarchiv können auf die unveränderliche Reservierung für historische Pool- und Positionsangaben zurückgreifen. Ein vollständig fehlender oder widersprüchlicher Quelldatensatz wird weiterhin blockiert. Die vorhandene Transferverbuchung kann eine solche erhaltene Archivquelle zuordnen und lässt das Archiv unverändert.

Keine Inserate, Nummern oder Reservierungen werden neu erzeugt oder geändert. Es entstehen keine zusätzlichen Gutschriften. Bereits übertragene Nachfolger bleiben ausgeschlossen. Dubletten-Korrekturen, fehlende Löschbestätigungen, Premium-Sperren und echte manuelle Sperren bleiben wirksam; auch Sperren im erhaltenen Archiv werden geprüft.

## Begründung

`historical()` schloss bisher jede Quelle mit `managerCleanup.removedAt` aus. Dieses Kennzeichen steuert jedoch die Manageransicht und widerspricht einer vorher belegten Portallöschung nicht. Eine ausdrücklich an Reservierung und unabhängigen Löschbeleg gebundene Prüfung erhält die Historie und vermeidet eine pauschale Freigabe historischer Dubletten.

Die Planung neuer Nachfolger und die Erzeugung von Löschgutschriften bleiben unverändert. Die Ausnahme gilt ausschließlich dem Upload bereits vorhandener Reservierungen.

## Hürden und Risiken

- Historische Dubletten und bestätigte tatsächliche Löschungen dürfen nicht gleich behandelt werden. `inventoryCorrection.active` bleibt deshalb ein Sperrgrund.
- Ältere Nummern besitzen keinen ursprünglichen Batch. Ihr Exportbericht-Beleg muss vollständig und exakt zur Gutschrift passen; ein Textstatus oder eine Managerbereinigung allein genügt nicht.
- Quellen im Archiv können ihre frühere Variantenzuordnung verloren haben. Die gespeicherte Einzelreservierung erhält Pool und Hausposition, ersetzt aber keine fehlende Quellidentität oder Löschbestätigung.
- Die nach regulärer Löschbestätigung gesetzte technische Automatik-Sperre bleibt von echten Premium-/manuellen Sperren unterschieden. Letztere werden weiterhin geprüft.

## Prüfung

Regressionen prüfen bereinigte Batch- und Exportbericht-Quellen, fehlende oder widersprüchliche Belege, Dubletten, Zeit- und Identitätskonflikte, Premium-/manuelle Sperren, erhaltene Archivquellen, unveränderte Daten sowie Doppelupload-Schutz. Die vier benannten Trechwitzer-Nachfolger werden auf einer isolierten Kopie des aktuellen Katalogs ohne FTPS-Aufruf geprüft.

Ergebnis: 74 fokussierte Tests bestanden. Gesamtsuite: 786 Tests, 785 bestanden, ein bestehender Skip, keine Fehler. ESLint und Produktions-Build bestanden; die bestehenden Upload-/OpenImmo-Regressionen sind enthalten.

Die aktuelle Datenprüfung bestätigt gültige Löschbelege für `30460-010011`, `30460-011007`, `30460-012002` und `30460-013002`. Alle 86 weiterhin vorbereiteten Nachfolger bestehen die Upload-Guard-Prüfung. Die vier bereits übertragenen Nachfolger `30460-011029` bis `30460-011032` bleiben ausgeschlossen. 90 bestehende Reservierungen und sämtliche derzeit 103 Gutschriften bleiben unverändert und eindeutig. Es wurde weder der Katalog repariert noch eine Objektnummer neu vergeben oder ein produktiver Upload ausgeführt.
