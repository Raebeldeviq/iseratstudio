# Vier vorbereitete Inserate müssen vier aktuelle Entwürfe sein

## Änderung

Die normale Vierer-Vorbereitung verwendet keine bereits gelöschten, archivierten,
bestandskorrigierten, aus dem Manager entfernten, zurückgesetzten oder verworfenen
Inserate mehr als Vorlage mit derselben Identität. Für die betroffene Hausvariante
wird ein neuer Entwurf über die vorhandene Nummernvergabe angelegt. Vorhandene
aktuelle Entwürfe werden wiederverwendet; eine wiederholte Vorbereitung erzeugt
keine weiteren Inserate oder Nummern.

Ein veröffentlichter, übertragener, laufender, fehlgeschlagener oder gesperrter
Bestandseintrag wird nicht als frisch vorbereiteter Entwurf gezählt. Die Vorbereitung
bricht mit Objektnummer und Status ab, statt ihn zu duplizieren. Ein bereits
vorbereiteter, weiterhin uploadfähiger Eintrag bleibt erhalten.

## Ursache und Ansatz

Bei Am Großen Wannsee 59A enthielt der Katalog das bereits gelöschte SOL 229 V3
`30460-009003`. Die Auswahl des Vorgängers suchte nur nach dem Haustyp und nahm
dieses historische Inserat wieder in den vierten Slot auf. Der Lebenszyklusschutz
ließ es korrekt gelöscht, die Erfolgsmeldung zählte aber alle vier Slots. Der
Uploadfilter bot deshalb nur die drei neuen SUN-Entwürfe an.

Die Korrektur setzt bei dieser Vorgängerauswahl an. Der kanonische Katalogstatus
hat Vorrang vor einer veralteten Entwurfskopie im Slot. Die Erfolgsanzahl zählt
uploadfähige Entwürfe. Bestehender Lebenszyklusschutz, Uploadfilter, Nummernvergabe,
Löschbuchungen und die separate 1:1-Nachschubvorbereitung bleiben bestehen.

## Risiken und Abgrenzung

Historische Identitäten dürfen weder reaktiviert noch überschrieben werden.
Insbesondere darf die fehlende Variante nicht durch einen Reset aller vier
Inserate ersetzt werden. Die Prüfung mit einer isolierten Kopie des aktuellen
Wannsee-Bestands ergänzt genau einen SOL-229-V3-Entwurf; alle sieben vorhandenen
Inserate einschließlich der drei neuen Entwürfe bleiben vollständig unverändert.
Nachschubreservierungen, Uploadhistorie und Resetarchive bleiben gleich.

Das Deployment erzeugt keine produktiven Inserate und führt keinen Upload aus.
Nach Neuladen der App dieselbe bestehende Auswahl erneut über
„Verteilung übernehmen & Texte öffnen“ vorbereiten. Dadurch wird ausschließlich
die fehlende Variante ergänzt. Pooldaten werden nicht geändert oder ergänzt.

## Prüfung

- Sieben neue Regressionstests: fehlende vierte Variante, wiederholte Vorbereitung,
  vier geschlossene Varianten, veraltete Slotkopie, aktueller Entwurf hinter älterer
  Historie, historische Ausschlussmerkmale und Schutz nicht uploadfähiger Bestände.
- 58 fokussierte Vorbereitungs-, Rotations-, Nachschub- und Uploadtests bestanden.
- Gesamtsuite: 864 Tests, 863 bestanden, ein bestehender Skip, keine Fehler.
- ESLint und Produktions-Build bestanden.
- Realdaten ausschließlich als isolierte Kopie geprüft; kein produktiver Upload.
