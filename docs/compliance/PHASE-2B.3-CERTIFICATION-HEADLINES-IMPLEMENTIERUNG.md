# Phase 2B.3 – DGNB-/QNG-Überschriftenbereinigung

## Kurzreport

Die Migration ersetzt ausschließlich die 18 exakten Titelpassagen
`DGNB-Gold` und `QNG-Potenzial` durch die bereits verifizierten,
serienbezogenen Fakten `DGNB-Serienzertifizierung` beziehungsweise
`QNG-Serienmerkmal`. Sieben technische Überschriften bleiben unverändert und
werden per Text und Hash geschützt.

## Begründung

Die zentralen Living-Haus-Serienfakten sind mit `verified_series`,
`house_series` und `verified` modelliert. Die Migration übernimmt exakt deren
Faktwert statt eine neue Marketingaussage zu erzeugen und validiert jede ganze
Überschrift vor dem kanonischen Compare-and-Swap-Write.

## Hürden und Risiken

Ein abweichender Ausgangsscope, fehlender Serienfakt, mehrfache Zielpassage,
eine geblockte vollständige Überschrift oder eine notwendige
Katalognormalisierung führt zum vollständigen Abbruch. Wärmepumpe und
Komfortlüftung erhalten ohne eigene strukturierte Evidenz weder einen neuen
Fact noch eine Textänderung.
