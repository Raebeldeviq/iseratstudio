# Sicherheitsgrenzen der Inseratrotation

## Report

- Rotation und Produktions-DELETE besitzen getrennte persistente globale
  Schalter. Beide fallen bei fehlender oder ungültiger Konfiguration auf
  `off` zurück.
- `active` benötigt zusätzlich eine gültige Produktions-Policy mit höchstens
  drei Inseraten je Schedulerlauf. Startup ist standardmäßig `detect-only`.
- Uploads sind deterministisch dedupliziert, persistent geclaimt und durch
  den Daily-Plot-Guard auf ein Haus je Grundstück und Berliner Kalendertag
  begrenzt.
- Ein Produktions-DELETE setzt eine beim konkreten Schedulerlauf gespeicherte
  Lifecycle-Autorisierung, einen positiven Importbericht und ein eindeutiges
  Source-/Replacement-Paar voraus.
- Nur ein positiver, exakt zugeordneter Immoprofessional-Löschbericht darf die
  alte Quelle auf `deleted` setzen. FTPS-Erfolg, Zeitablauf oder fehlende
  Fehlermeldungen sind keine Bestätigung.
- Offene Löschberichte belegen dasselbe Dreierbudget wie neue Transfers;
  unterbrochene oder unklare Deletejobs sperren jeden weiteren Delete-Transfer.
- Die Mailadapter sind read-only. Sie verschieben, löschen, markieren oder
  erstellen keine Nachricht und keinen Ordner.

## Begründung

Die externen Immoprofessional-Schritte sind asynchron. Der sichere Vertrag
trennt daher Planung, Transfer, Importbestätigung, Delete-Transfer und
Delete-Bestätigung in persistente, idempotente Zustandsübergänge. Eine spätere
Stufe darf niemals aus dem Erfolg einer früheren Stufe gefolgert werden.

## Hürden und Risiken

- Ein nach Transferbeginn abgebrochener FTPS-Vorgang ist unklar und darf nicht
  automatisch wiederholt werden.
- Neue oder veränderte Providerberichte bleiben bis zur Parserfreigabe
  blockiert.
- Zugangsdaten verbleiben ausschließlich im lokalen Credential Vault und
  dürfen weder protokolliert noch in Git aufgenommen werden.
- Historische Quellen ohne Produktions-Lifecycle-Marker sind absichtlich vom
  automatischen Delete-Catch-up ausgeschlossen.
