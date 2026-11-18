# Browserstand nach einem bestätigten Transfer

## Änderung

Die Ladeauswahl prüft einen neueren Browserstand mit dem vorhandenen
Katalog-Lebenszyklusschutz gegen den gespeicherten macOS-Stand. Ein neuerer
Zeitstempel kann bestätigte Transfers, Löschungen, Korrekturen oder
Nachschubreservierungen nicht zurücksetzen. Ein widersprüchlicher Browserstand
wird vor der Übernahme des Gerätekatalogs als vollständige Wiederherstellungskopie
in der vorhandenen Browserdatenbank gespeichert. Schlägt diese Sicherung fehl,
bleibt der Ladefehler sichtbar und der alte Browserstand erhalten.

Nach einem Sammelupload wartet die App zuerst noch ausstehende Speicherungen ab,
lädt danach den autoritativen Gerätekatalog und speichert ihn unmittelbar mit
seinem tatsächlichen Zeitstempel im Browser. Erst danach wird der Abschluss in
der Oberfläche übernommen. Vor Transferbeginn wird die Speicherwarteschlange
ebenfalls vollständig abgewartet.

## Ursache und Ansatz

Beim gemeldeten Inserat `0f5367b0-77ae-49ad-82c2-31eb1b514869` ist der Transfer
als `30460-036002` am 18.11.2026 um 09:38 Uhr belegt. Katalog, Variantenkopie,
Jobprotokoll und Reservierung stimmen überein. Die ursprüngliche vorbereitete
Nummer `30460-032037` wurde beim Wechsel des Uploadtags regulär abgelöst.

Die bisherige Ladeauswahl konnte dennoch einen zeitlich neueren Browsercache
mit älterem Lebenszyklusstatus bevorzugen. Mit einer Kopie des aktuellen Falls
ließ sich dadurch dieselbe Speichersperre reproduzieren. Ein Neustart allein
garantierte wegen dieser Auswahl keinen Ausweg. Nach dem Upload wurde der
aktuelle Gerätestand außerdem erst durch die spätere automatische Speicherung
im Browser gesichert. Der neue Ablauf schließt diese Lücke und schützt die
belegten Statuswerte mit derselben Prüfung wie der Helper.

## Hürden und Risiken

Unveröffentlichte Browserbearbeitungen dürfen bei einer Rückkehr zum
Gerätekatalog nicht verschwinden. Die Wiederherstellungskopie enthält deshalb
den vollständigen abweichenden Stand einschließlich Bildern und Texten; sie
ersetzt den Primäreintrag nicht. Derselbe Quellzeitstempel verwendet denselben
Sicherungsschlüssel. Gültige neuere Browserbearbeitungen bleiben weiterhin
bevorzugt. Ohne erreichbaren Gerätekatalog bleibt der normale Browserbetrieb
erhalten.

Der Transferbeleg darf nicht auf Entwurf zurückgesetzt oder nochmals übertragen
werden. Backendschutz, Uploadfilter, Nummernvergabe und Nachschublogik werden
nicht verändert. Die Überprüfung und das Deployment lösen keine Uploads,
Portallöschungen oder Bestandskorrekturen aus.

## Prüfung

Fokussierte Regressionen decken veralteten Entwurfsstatus, alte Objektnummern,
fehlende Reservierungen, gültige Textbearbeitung, Reihenfolge ausstehender
Speicherungen, fehlgeschlagene lokale Sicherung sowie den getrennten Erhalt
des Browser-Primärstands und der Wiederherstellungskopie ab. Der aktuelle
Produktionsfall wurde ausschließlich auf einer Kopie geprüft. 41 fokussierte
Tests bestanden. Gesamtsuite: 870 Tests, 869 bestanden, ein bestehender Skip,
keine Fehler. ESLint und Produktions-Build bestanden.
