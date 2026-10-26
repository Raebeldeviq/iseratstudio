# Nachschub nach Managerbereinigung und Hauspool-Diagnose

## Report

Die Nachschubplanung berücksichtigt bereits belegte Löschungen auch dann, wenn der Quelldatensatz nach der Löschbestätigung aus der normalen Manageransicht entfernt wurde. Planung und Upload verwenden dieselbe Belegprüfung. Technisch normalisierte Abschlusssperren mit Kontrollstatus `archived` werden nur für eine belegte Löschquelle wie die entsprechende `deleted`-Sperre behandelt.

Für Gertraudstraße 1 waren die zwei ursprünglichen Quellen `30460-93` und `30460-94` trotz gültiger Exportbericht-Belege noch nicht reserviert. `historical()` wertete die Sichtbarkeitsbereinigung als ungültige Löschquelle. Zusätzlich sah die normalisierte technische Archiv-Sperre wie eine manuelle Sperre aus. Nach dem Fix sind genau zwei neue 1:1-Nachfolger vorbereitbar. Die bereits übertragenen Inserate `30460-018008` und `30460-022001` werden erhalten und nicht erneut übertragen.

Bei Am Großen Wannsee 59A war die gespeicherte Viererauswahl veraltet: SOL 242 V4 ist freigegeben und vollständig, aber nicht im gemeinsamen Hauspool ausgewählt. Die Fehlermeldung nennt jetzt Grundstück, Haus und konkreten Grund sowie die vorhandene Aktion „Neu verteilen“. Ein gespeicherter, inzwischen unzulässiger Wert bleibt im Auswahlfeld sichtbar, statt als anderer gültiger Eintrag zu erscheinen. Die Hauspoolauswahl und Hausfreigaben werden nicht automatisch geändert.

Die Wannsee-Nachschubplätze bleiben zusätzlich wegen der fehlenden Pool-B-Hausnummer blockiert. Die Planung benennt jetzt konkret „Pool B: Hausnummer fehlt“. Eine alphanumerische Nummer wie 59A wird nicht automatisch hochgezählt. Es werden keine Ersatzadressen erfunden.

## Begründung

Die Entfernung aus der Manageransicht ändert weder eine bestätigte Portallöschung noch deren eindeutige Quelle. Eine fehlende Nachfolgeplanung muss dieselben vorhandenen Belege verwenden können wie ein bereits reservierter Nachfolger. Die Belegprüfung bindet Projekt, Inserats-ID, Objektnummer, Löschzeitpunkt und gegebenenfalls Bericht-Prüfsumme zusammen. Die Bereinigung muss nach der tatsächlichen Löschbestätigung erfolgt sein; sie darf sowohl vor als auch nach der Vorbereitung liegen.

Die aktuell laufende Runtime enthielt die drei bereits produktiv eingesetzten Monitor-Commits bis `42ce7551`, während main und die erwartete Produktionsfreigabe noch auf `d4e75ada` standen. Der Fix übernimmt diese bereits laufende Basis in den regulären main-Verlauf. Die späteren, nicht in der Runtime enthaltenen Monitor-Entwicklungsstände werden nicht mit ausgerollt. Es erfolgt kein Rücksetzen auf die ältere App.

## Hürden und Risiken

- Bestandskorrekturen, verworfene Vorbereitungen, fehlende oder widersprüchliche Löschbelege und mehrdeutige Quellen bleiben gesperrt.
- Premium, echte manuelle Sperren, Sperrgrund und Sperrfrist bleiben wirksam. Die Archiv-Ausnahme gilt nur nach erfolgreicher Löschbelegprüfung und bei den unveränderten technischen Abschlussmerkmalen.
- Neue Planung erfordert einen eindeutigen Quelldatensatz. Ein alleiniger Status oder ein Managerbereinigungskennzeichen genügt nicht.
- Bestehende Inserate, Gutschriften, Reservierungen, Nummern und Uploadhistorie werden nicht umgeschrieben. Die Planung erzeugt ausschließlich auf explizite Nutzeraktion neue Reservierungen für bestehende freie Belege.
- Die Monitor-Erweiterung stellte weitere erlaubte Routen vor die bisherige Routenprüfung. Der bestehende Regressionstest erkennt die unveränderte Inventarkorrektur-/Batch-Allowlist deshalb nun unabhängig von deren Position.

## Prüfung

75 fokussierte Tests bestanden. Gesamtsuite: 857 Tests, 856 bestanden, ein bestehender Skip, keine Fehler. ESLint und Produktions-Build bestanden. Regressionen prüfen Bereinigung vor der Vorbereitung, technische Archivkontrollen, fehlende/duplizierte Belege, echte Sperren, Mehrfachzuordnung sowie unveränderte vorhandene Inserate und Gutschriften.

Die Prüfung auf einer isolierten Speicherkopie des aktuellen Katalogs liefert genau zwei zusätzliche Gertraud-Nachfolger und vier unterschiedliche Haustypen zusammen mit den zwei bestehenden Inseraten. Uploadplanung und Übergangsprüfung bestehen, ohne FTPS aufzurufen. Produktive Inserate werden nicht erzeugt; Pooldaten und Katalogbestand bleiben unverändert.
