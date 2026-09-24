# Phase 2B.5 – Deterministische Teilbereinigung

## Kurzreport

Die neue Migration verarbeitet ausschließlich drei vorab durch Phase 2B.4
klassifizierte Segmenttypen: 40 I-KON-Umweltheadlines, 44 Effizienzhaus-/QNG-
Bausteine und einen teilbaren Energiekennwertsatz. Sie verwendet den
CAS-geschützten Katalogspeicher und erstellt davor einen eigenen,
byteidentischen Backup-Stand.

## Begründung

Jede Änderung ist an einen exakten Satz und eine verpflichtende Scope-Zahl
gebunden. Die QNG-Ersetzung stammt aus `seriesFactSentences`, also der zentral
freigegebenen Serien-Sachinformation; der Energiekennwert wird nur bei einem
verifizierten Projektierungswert der konkreten Hausvorlage erhalten. Damit gibt
es keine KI, keine freie Umformulierung und keinen Uploadpfad.

## Hürden und Risiken

Die 51 menschlich zu entscheidenden Technik- und Zertifizierungspassagen sind
als Satz-Snapshots geschützt. Vor dem Persistieren und nach dem erneuten Laden
wird ihre exakte Unverändertheit geprüft. Jede Scope-, Evidenz-, Policy-,
Normalisierungs- oder Idempotenzabweichung bricht die Migration ab.
