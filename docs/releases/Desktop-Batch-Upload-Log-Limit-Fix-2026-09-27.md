# Desktop-Batch-Upload-Log-Limit-Fix – 2026-09-27

## Report

Der Desktop-Uploadpfad importiert `BATCH_UPLOAD_LOG_LIMIT` wieder aus dem bestehenden zentralen Modul `batch-upload.mjs`. Dadurch kann die Katalognormalisierung beim Start der manuellen Uploadvorbereitung das Uploadprotokoll begrenzen, ohne einen `ReferenceError` auszulösen. Ein fokussierter Regressionstest sichert die zentrale Ableitung und den unveränderten Fail-Closed-Hinweis ab.

## Begründung

Die Konstante war weiterhin zentral definiert und wurde aus `MAX_UPLOAD_LOGS` abgeleitet. Der fehlende Import wurde deshalb wiederhergestellt, statt einen zweiten Wert im Frontend anzulegen. Uploadlogik, Katalogpersistenz, OpenImmo, FTPS, Rotation und Scheduler bleiben unverändert.

## Hürden und Risiken

Der Fehler entstand bei der Auslagerung der manuellen Upload-Persistenz: Der Import wurde zusammen mit nicht mehr benötigten Upload-Helfern entfernt, obwohl die Katalognormalisierung die Konstante weiterhin verwendete. Der Fix ist auf die Importverdrahtung begrenzt. Ein produktiver Upload ist ausdrücklich nicht Bestandteil der Prüfung; deshalb wird der Desktoppfad über fokussierte Tests, vollständige Suite, Lint und Produktions-Build verifiziert.
