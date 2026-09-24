# Phase 2B.2 – sichere CTA-Bereinigung

## Kurzreport

Die Migration entfernt ausschließlich den exakt bekannten historischen Abschluss-CTA am Ende einer Objektbeschreibung. Der verbleibende Text wird nicht erzeugt oder umformuliert, sondern nur am Ende technisch bereinigt.

## Begründung

Der Scope wird aus den verbleibenden MANUAL_REVIEW-Feldern abgeleitet und ist auf 44 Objektbeschreibungen sowie 25 geschützte Überschriften fest verdrahtet. Jeder Write nutzt den kanonischen Pending-Snapshot- und Compare-and-Swap-Pfad; ein separater, nicht überschreibbarer Backup wird zuvor erstellt.

## Hürden und Risiken

CTA-Entfernung kann verbleibende BLOCK-Treffer im individuellen Beschreibungskörper nicht auflösen. Solche Treffer bleiben ausdrücklich bestehen. Eine fehlende exakte CTA-Endposition, unvollständige Satzstruktur, notwendige globale Normalisierung oder Scope-Abweichung stoppt die Migration vollständig.
