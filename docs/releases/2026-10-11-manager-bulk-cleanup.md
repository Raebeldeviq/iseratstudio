# Mehrfachbereinigung im Inseratsmanager – 11.10.2026

## Report

- Kleine Checkbox links an jeder Inseratskarte. Nicht sicher bereinigbare Einträge sind gesperrt; der Hinweis erklärt den Grund.
- „Alle gefilterten Treffer auswählen“ übernimmt ausschließlich bereinigbare Treffer. Bei Auswahl erscheint eine kompakte Leiste mit Anzahl, „Auswahl aufheben“ und „N ausgewählte Inserate entfernen“. Bestätigung nennt Anzahl und Objektnummern.
- Statusfilter: Alle, Aktive Inserate, Reset-Archiv, Fehlgeschlagen, Bestandskorrekturen. Die Objektnummernsuche wird zusätzlich angewendet. Filter- oder Suchwechsel hebt die Auswahl auf.
- Entfernung bedeutet Ausblenden aus dem normalen Inseratsmanager. Der komplette Datensatz einschließlich Upload-/Löschbelegen und früherer Bestandskorrekturen bleibt erhalten. Ein Auditkennzeichen speichert Zeitpunkt, Grund, Objektnummer und gemeinsame Vorgangs-ID.
- Helfer prüft die gesamte Auswahl atomar gegen den aktuellen Katalog. Ungültige, geschützte oder inzwischen geänderte Einträge verhindern die ganze Aktion. Wiederholung derselben Bereinigung ist wirkungslos.
- Keine Portallöschung, kein Upload, keine Poolumschaltung und keine Nachschubgutschrift. Entfernte Datensätze können nicht über veraltete Browserstände oder die Rücknahme einer Bestandskorrektur reaktiviert werden.
- Reguläre Batchbestätigung nutzt unverändert denselben Ablauf; der kleine Transaktionshandler ist jetzt auch mit isolierten HTTP-Tests aufrufbar.

## Begründung

Ein Kennzeichen am bestehenden Datensatz erhält alle Belege und verhindert ein versehentliches Neuerstellen oder Wiederverwenden. Es trennt das Entfernen einer Managerzeile von der tatsächlichen Portallöschung. Identität und operative Revision werden sowohl im Browser als auch im Helfer geprüft. Vor dem Schreiben wird jeder Eintrag validiert; der bestehende Katalogspeicher übernimmt Konflikterkennung und atomare Persistenz.

## Zulässige und geschützte Einträge

- Zulässig: ausdrücklich bestätigte Bestandskorrekturen, bestätigte Löschungen ohne offenen externen Löschauftrag, fehlgeschlagene/archivierte Entwürfe ohne Übertragungsbelege sowie nie übertragene Entwürfe aus Reset-Archiven.
- Ein Reset, ein Fehlerstatus oder ein inaktives Grundstück allein beweist keinen fehlenden Portalbestand. Übertragungs-/Importhinweise, Uploadprotokolle oder aktive Batchverweise verhindern deshalb die normale Bereinigung ungeklärter Einträge.
- Premium und laufende/eingeplante Vorgänge sind gesperrt. Gewöhnliche aktive/vorbereitete Inserate bleiben erhalten.

## Hürden und Risiken

- Browsernormalisierung ergänzt Kontrollfelder. Der Vergleich verwendet für operative Felder identische Standardwerte, damit eine zulässige Auswahl nicht wegen Darstellungsunterschieden abgewiesen wird.
- Bestandskorrekturen bleiben auch nach der Managerbereinigung gesetzt. Die vier realen Fritz-Zubeil-Objekte bleiben unverändert; alte Archivzeilen werden nicht reaktiviert.
- Gleichzeitige Batchbestätigungen werden durch die bestehende Katalogrevision abgefangen. Nur die erste erfolgreiche Bestätigung schreibt Löschungen und Plätze.
- Sammelbereinigung ist eine ausdrückliche Aktion. Dieses Release führt keine Sammelbereinigung am realen Bestand aus; eine anschließende Nutzerfreigabe ist erforderlich.

## Isolierte Verifikation

- Fall A: zehn aktive Inserate → zehn intern gelöscht, zehn Nachschubplätze.
- Fall B: sechs aktive, drei historische Dubletten, ein Premium-Inserat → genau sechs gelöscht und sechs Plätze; Premium und Dubletten unverändert.
- Fall C: wiederholte und gleichzeitig doppelte Bestätigung → keine zweite Änderung oder Gutschrift, auch nach erneutem Laden des Katalogs.
- Fall D: zwanzig historische aktuelle/archivierte Einträge → keine normalen Managerzeilen mehr, alle Datensätze/Audits erhalten, keine neuen Plätze und keine aktiven Löschpositionen dieser Einträge.
- Regression mit den exakten vier realen Fritz-Zubeil-Objekten, vier korrigierten aktuellen Einträgen und acht korrigierten Archivpositionen.
- Weitere Prüfungen: falsche Identität, veraltete Revision, atomare Ablehnung gemischter unsicherer Auswahl, kombinierte Filter, normalisierte Kontrollfelder, UI-Aktionsleiste und Persistenz.
- Die HTTP-Tests binden ausschließlich temporäre Testkataloge ein. Produktive Batches werden nicht bestätigt.

## Freigabeprüfung

- 48 fokussierte Regressionen bestanden.
- Gesamtsuite: 757 bestanden, 1 übersprungen, 0 fehlgeschlagen (758 insgesamt).
- ESLint und Produktions-Build erfolgreich.
- Lesender Vorabgleich des realen Fritz-Zubeil-Bestands: alle vier echten Objekte gesperrt, die zwölf zuvor bestätigten historischen Einträge bereinigbar. Keine reale Bereinigung ausgeführt.
