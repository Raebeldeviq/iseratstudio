# Objekttext-Neuausrichtung – 26. September 2026

## Kurzreport

Die automatische Objektbeschreibung wurde redaktionell auf einen kurzen, emotionalen Wohn- und Grundrisstext ausgerichtet. Die Änderung betrifft ausschließlich die dynamische Objektbeschreibung, ihren zentral angehängten Kontaktabschluss sowie den deterministischen Text-Fallback.

Nicht verändert wurden die zentrale Claim-Policy, das Faktenmodell, OpenImmo, FTPS/Upload, die Rotation und vorhandene Inseratdaten. Es wurde kein Bestandstext regeneriert und kein Portal- oder Sammel-Upload ausgelöst.

## Redaktionelle Struktur

| Bisher | Jetzt |
| --- | --- |
| Breiter Exposétext mit bis zu 6.000 Zeichen und optionalen Leistungs-, Technik- und Beratungsanteilen | Dynamischer Wohntext mit 185–245 Wörtern plus festem CTA; vollständig etwa 220–300, maximal 350 Wörter |
| Allgemeiner Call-to-Action | Einheitlicher CTA mit Telefonnummer und Terminlink |
| Zentral angehängter QNG-Satz in der Beschreibung | Keine DGNB-, QDF- oder QNG-Nennung im Marketingtext; der zentrale, belegte Titel-Scope bleibt unverändert |
| Angebots- und Varianteninformationen konnten im KI-Quellkontext stehen | Haus-, Grundstücks- und Gesamtpreise sowie interne Varianten werden aus dem KI-Quellkontext entfernt; die Ausgabeprüfung weist Preis- und Variantenangaben zurück |

Die neue Reihenfolge ist: emotionaler Einstieg, Haus- und Grundrissleben, wenige belegte Eckdaten, Grundstücksbezug, bei belegtem Paket eine kurze Komfortlüftungsinformation, Abschluss und CTA. Finanzierungsinformationen werden nicht erzeugt, weil hierfür derzeit kein konkreter strukturierter Freigabefakt im verwendeten Kontext vorhanden ist.

## Technischer Ansatz

- Der KI-Prompt verlangt nur belegte Haus-, Grundriss-, Grundstücks- und Lagefakten sowie direkte Du-Ansprache.
- Preisfelder, Anbieter-Kontaktdaten und Angebotsgesamtwerte werden nicht mehr an die KI-Textgeneration übergeben. Variantenkennungen werden für die kundenseitige Hausbezeichnung bereinigt.
- Die bestehende Claim-Policy wird weiterhin unverändert als zentrale fachliche Freigabe verwendet. Die Komfortlüftung wird im Fallback ausschließlich über `releasedTechnicalFacts` und damit über den vorhandenen strukturierten Paket-Scope zugelassen.
- Der neue CTA lautet vollständig:

  `Du möchtest wissen, ob dieses Haus zu deinen Vorstellungen und deinem Budget passt? Ruf mich direkt unter +49 160 930 87 202 an oder buche dir bequem einen persönlichen Telefontermin: https://calendly.com/pascal-froehlich-livinghaus/erstinfo-via-telefon`

  Danach folgt der vereinbarte Abschlusssatz.

## Prüfung

| Prüfung | Ergebnis |
| --- | --- |
| Fokussierte Text-, Claim- und Copy-Tests | 44 bestanden, 0 fehlgeschlagen |
| Vollständige Testsuite | 611 bestanden, 0 fehlgeschlagen, 1 erwarteter Windows-Skip |
| ESLint | 0 Fehler, 0 Warnungen |
| Produktions-Build | bestanden |
| Fünf unterschiedliche Fallback-Objekttexte | 235, 235, 256, 245 und 247 Wörter |
| Read-only Claim-Scan der fünf Texte | 5/5 gescannt, BLOCK 0, REVIEW 0 |

Die fünf Testfälle prüfen jeweils den emotionalen Einstieg, Raum-/Grundrissbezug, bereinigte Hausnamen, fehlende Preis- und Variantenangaben, CTA-Telefonnummer und Terminlink. Nur der Fall mit dem belegten I-KON-Paket enthält die Komfortlüftung mit Wärmerückgewinnung; Kosten-, Energie-, Klima- und Umweltwirkungen werden dort nicht behauptet.

## Risiken und kontrollierter Rollout

Die Wortlängen und Compliance-Eigenschaften sind durch die Ausgabeprüfung abgesichert. Das konkrete sprachliche Erscheinungsbild einer externen LLM-Antwort bleibt modellbedingt variabel. Vor einer breiteren Nutzung sollte deshalb ein Nutzer bewusst eine einzelne normale Textgeneration anstoßen und die Ausgabe fachlich lesen; dieser Code-Change führt selbst weder eine Generation noch einen Upload aus.

Die Modellkonfiguration blieb absichtlich unverändert. Eine separate Modellmigration kann nach ihrem eigenen Branch und Testprotokoll mit dieser Änderung zusammengeführt werden.
