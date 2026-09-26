# Finanzierungshinweis im Objekttext – 26. September 2026

## Report

- Generierte Objektbeschreibungen erhalten vor dem bestehenden CTA exakt einen
  zentralen Hinweis auf mögliche Fördermöglichkeiten und das
  Zuhause-Darlehen als weitere Finanzierungsoption mit Living Haus.
- Der Absatz nennt weder Darlehenshöhe noch Rate, Förder- oder
  Finanzierungszusage und behauptet keine allgemeine Eignung. Die sinnvolle
  Kombination wird ausdrücklich dem persönlichen Gespräch zugeordnet.
- Der Hinweis wird nach der dynamischen Textgeneration deterministisch ergänzt.
  Die KI darf keinen eigenen Finanzierungsabsatz erzeugen; eine solche Ausgabe
  wird durch die bestehende Textvalidierung zurückgewiesen.
- OpenImmo, Claim-Policy, Datenmodell, Objektfelder und Uploadlogik wurden nicht
  verändert.

## Begründung

Die zentrale Einfügung nutzt denselben bestehenden Abschlussmechanismus wie der
Telefon-/Calendly-CTA. Damit gilt der Wortlaut identisch für den LLM-Pfad und
den lokalen Fallback, erscheint bei Regeneration nicht doppelt und benötigt
weder einen neuen Faktentyp noch eine neue Finanzierungsarchitektur.

Die dynamische LLM-Ziellänge wurde von 185–245 auf 160–215 Wörter reduziert,
weil der feste Finanzierungshinweis zusätzlichen Umfang erzeugt. Der komplette
Objekttext bleibt dadurch im bisherigen Zielkorridor von ungefähr 220–300
Wörtern und weiterhin unter dem harten Maximum von 350 Wörtern.

## Hürden und Risiken

- Die Aussage wird als zentral freigegebener Geschäftshinweis behandelt, nicht
  als individuelle Finanzierungsberatung oder Zusage.
- Sprachliche Variationen des dynamischen Textes dürfen den festen Absatz nicht
  verändern oder duplizieren.
- Die fachliche Verfügbarkeit des Zuhause-Darlehens ist Grundlage dieses
  Auftrags. Konditionen und individuelle Eignung bleiben ausdrücklich außerhalb
  des Inserattexts und sind persönlich zu klären.

## Verifikation

- Fokussierte Text- und Claim-Tests: 45/45 bestanden
- Fünf Objekttexte: 264, 264, 272, 274 und 276 Wörter
- Finanzierungshinweis je Text: exakt einmal
- Claim-Scan: `BLOCK = 0`, `REVIEW = 0`
- Vollständige Suite: 613 Tests, 612 bestanden, 0 fehlgeschlagen,
  1 erwarteter Windows-Skip
- ESLint: 0 Fehler, 0 Warnungen
- Produktions-Build: PASS
