# Runtime-Retention und Speicherbereinigung

## Report

Der Helper prüft nach dem Start maximal eine Minute lang, ob App und Helper aus derselben installierten Produktionsruntime erreichbar sind und der Helper-Commit zur Produktionsfreigabe passt. Erst nach erfolgreicher Prüfung werden ältere, abgeschlossene Runtime-Verzeichnisse entfernt. Die aktuelle Runtime bleibt erhalten.

Die Retention ist direkt in den vorhandenen Helper-Start integriert und benötigt weder einen weiteren Dienst noch eine neue Konfiguration. Sie verändert weder Katalog noch Uploads, Reservierungen, Rotationshistorie oder Löschbuchungen.

Die einmalige Speicherbereinigung entfernt nachweislich unbenutzte Altversionen tatsächlich. Vorher werden laufende Dienste, LaunchAgents, Prozessreferenzen, Produktionsdaten und Entwicklungsstände geprüft. Evidenz aus abgeschlossenen Arbeitsverzeichnissen bleibt im Speicherbericht erhalten. Nicht eindeutig entbehrliche oder ungesicherte Entwicklungsstände werden nicht gelöscht.

## Begründung

Jedes Deployment erzeugte bisher eine vollständige, eigenständige Runtime samt Medien und Abhängigkeiten. Eine anschließende Retention fehlte. Über 30 Releases sammelten sich an. APFS-Klondateien teilen teilweise Datenblöcke; die Summe der Verzeichnisgrößen und der tatsächlich freigegebene Datenträgerspeicher unterscheiden sich daher. Der Abschlussbericht erfasst beides getrennt.

Die Aufräumaktion folgt einer erfolgreichen Produktionsprüfung. Ein fehlgeschlagener oder nur bereitgestellter neuer Release darf eine funktionsfähige ältere Runtime nicht entfernen.

## Hürden und Risiken

- Bei fehlender Health-Prüfung oder Prozessinspektion bleibt die alte Runtime erhalten.
- Beide LaunchAgents müssen dieselbe aktuelle Runtime referenzieren. Eine noch geöffnete oder laufende alte Version bleibt geschützt.
- Unbekannte Verzeichnisse, Symlinks, neuere vorbereitete Releases, ungültige Manifeste oder zusätzliche Arbeitsdaten/Secrets werden nicht pauschal entfernt.
- Nur direkte, nachweislich eigenständige `release-*`-Verzeichnisse innerhalb des Runtime-Ordners sind zulässig. Quellcode, Git-Historie und Produktionsdaten außerhalb dieses Ordners werden nicht berührt.
- Ungesicherte Entwicklungsarbeiten und fachliche Audit-/Medienartefakte bleiben erhalten. Die Retention schützt die vorhandene Produktionsversion bis zur erfolgreichen Aktivierung des Nachfolgers.

## Prüfung

Regressionstests prüfen erfolgreiche und wiederholte Bereinigung, fehlende oder verlorene Health-Bestätigung, aktive Referenzen, unbekannte/neue Releases, zusätzliche Secrets, Symlinks und fehlgeschlagene Prozessinspektion. Die bestehenden Runtime-, LaunchAgent- und Ownership-Tests bleiben enthalten. Gesamtsuite, ESLint und Produktions-Build werden vor der Integration ausgeführt. Der abschließende Produktionsvergleich prüft Katalog, vorbereitete Nachfolger, Reservierungen, Historie, Medien und Dienste ohne produktive Uploads.
