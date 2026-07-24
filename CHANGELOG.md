# Änderungsprotokoll

## Vollständiger Medien- und Preiskatalog – 24. Juli 2026

- Pascals neuen GitHub-Medienstand vollständig übernommen: 665 Originalbilder
  in `bundled-media`, versioniert über Git LFS.
- Den unter macOS zulässigen, unter Windows ungültigen Dateinamen
  `Deine 5* Küche.jpg` Windows-sicher als `Deine 5 Sterne Küche.jpg`
  integriert und ein unsichtbares Leerzeichen am Ordner `Sun 130` entfernt.
- Alle 18 Haustypen gegen den neuen Bestand geprüft. Sie erhalten jeweils 12
  oder 13 Bilder ohne fehlende Titelbilder, Grundrisse oder Bildrollen.
- Die 61 tatsächlich verwendeten Bilder als 9,5 MB große WebP-Dateien
  vorbereitet, damit der Browserkatalog nicht erneut an zu großen
  Base64-Zeichenketten scheitert.
- Die vollständige neutrale Preisliste mit 30 Modellen in Schritt 1 sichtbar
  gemacht und SUN 113 mit 355.122 €, 106,15 m², vier Zimmern und drei
  Schlafzimmern ergänzt.
- Die Anwendungsversion auf 0.10.0 angehoben. Windows-Speicherung,
  25-Haustypen-Grenze, Aktionsbilder und Totalabgleich bleiben erhalten.
- Den gezielt installierten Gerätekatalog beim Laden priorisiert, damit ein
  älterer Browser-Speicherstand die neuen Haustypen nicht zurückrollen kann.
- Archivierte Historienbilder bleiben vollständig in der Gerätesicherung,
  werden aber nicht mehr beim Start als mehrere hundert Megabyte Base64 in den
  Browser geladen. Aktive Haus- und Aktionsbilder werden dabei dedupliziert.
- Grundstücksadressen, Zugangsdaten, Upload-Historie und bestehende Inserate
  gehören weiterhin ausschließlich zum lokalen Gerätekatalog und nicht zu
  GitHub.
