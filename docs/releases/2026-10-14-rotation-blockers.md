# Rotationsprüfung für bereinigte Bestände und fehlende Pools

## Report

Die Oberfläche und die zentrale Vierer-Vorbereitung verwenden dieselbe Vorprüfung aus `address-rotation.mjs`. Als nicht im Portal vorhandene Bestandskorrekturen und exakt belegte Löschungen werden von noch aktiven Inseraten unterschieden. Die bloße Entfernung aus der Manageransicht ersetzt keinen Löschbeleg.

Bei Fritz-Zubeil blockierte die bisherige Oberfläche vier korrigierte Dubletten, weil deren historische Transferzeit und Status erhalten geblieben waren. Die Grundstückszählung blendete diese Einträge bereits korrekt aus. Der neue Guard berücksichtigt die Korrektur und die vier bestätigten tatsächlichen Löschungen. Ein neuer Erstzyklus nutzt den aktuellen Pool A des über seine ID verknüpften Grundstücks. Historische Projektbezeichnungen und Inserate bleiben erhalten; Adressen 23 und 23A werden nicht über Textähnlichkeit gleichgesetzt.

Beim Rothenbücherweg sind der falsche Viererzyklus und seine Reservierungen bereits korrekt aufgehoben. Sein Historieneintrag bleibt nachvollziehbar gespeichert. Tatsächlich fehlt im aktuellen Grundstücksdatensatz Pool B; auch im gespeicherten Masterbestand ist für diese ID kein ergänzender Pool vorhanden. Diese fachliche Sperre bleibt bestehen. Statt einer irreführenden Sammelmeldung mit „0/4“ wird konkret „Pool B fehlt“ angezeigt. Es werden keine Werte erfunden oder automatisch übernommen.

## Begründung

Der vorherige UI-Guard prüfte nur Transfermerkmale und `status !== deleted`, ohne Bestandskorrekturen zu beachten. Die zentrale Vorbereitung besaß diese Vorprüfung nicht. Die gemeinsame, reine Prüfung vereinheitlicht beide Eintrittswege und blockiert vor der Erzeugung neuer Nummern oder Varianten.

Bestands- und Archivzuordnungen erfolgen über Grundstücks-, Projekt- und Inserats-IDs. Aktuelle Datensätze haben Vorrang vor alten Variantenkopien. Löschbelege müssen mit Projekt-ID, Inserats-ID, Objektnummer und Zeitpunkt übereinstimmen. Eine tatsächlich bestätigte Löschung bleibt auch nach einer späteren Korrektur abgeschlossen; eine Korrektur allein bestätigt keine Löschung und erzeugt keine Nachschubgutschrift.

## Hürden und Risiken

- Historische Transfermerkmale müssen für den Audit erhalten bleiben. Sie dürfen bereinigte Dubletten nicht pauschal als aktuelle Portalobjekte ausweisen.
- Tatsächlich aktive oder vorbereitete Inserate, laufende Vorgänge, Premium-/Löschschutz und nicht aufgehobene Nachschubreservierungen bleiben geschützt. Fehlende reservierte Inseratsreferenzen werden nicht stillschweigend freigegeben.
- Die nach einer bestätigten Löschung gesetzte technische Abschlusssperre wird von einer echten manuellen Sperre unterschieden.
- Ein leerer Zähler oder eine leere Referenzliste ist kein Beleg für einen abgeschlossenen laufenden Viererzyklus. Fehlende/mehrdeutige Referenzen erfordern Prüfung.
- Fehlende oder unvollständige Pooladressen und offene Pool-B-Prüffälle werden konkret benannt. Die vorhandene ausdrücklich angeforderte Erstzyklus-Ausnahme `initialPoolAOnly` bleibt erhalten; die normale Oberfläche benötigt weiterhin das vollständige Poolpaar.
- Die 1:1-Nachschubvorbereitung wird nicht verändert. Ihr bestehender `replacements`-Pfad und sämtliche Löschgutschriften, Reservierungen, Uploads und Nummern bleiben erhalten.

## Prüfung

Fokussierte Regressionen decken die Fritz-Zubeil-Konstellation, getrennte Adressen/Grundstücks-IDs, belegte Archivlöschungen, fehlende Löschbelege, echte Schutzflags, laufende Uploads, gültige und aufgehobene Reservierungen, den verworfenen Rothen-Zyklus und fehlende/unvollständige Pools ab. Eine neue Vierergruppe wird ausschließlich in isolierten Testdaten bzw. einer Speicherkopie des aktuellen Katalogs erzeugt. Es wird kein produktiver Bestand geändert und kein Upload ausgeführt.

Ergebnis: 58 fokussierte Tests bestanden. Gesamtsuite: 804 Tests, 803 bestanden, ein bestehender Skip, keine Fehler. ESLint und Produktions-Build bestanden; die bestehenden Nachschub-, Upload-, Lösch-Batch- und Bestandskorrekturtests sind enthalten.
