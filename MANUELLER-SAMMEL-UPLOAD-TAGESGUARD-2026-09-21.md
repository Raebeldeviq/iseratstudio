# Manueller Sammel-Upload: Tagesguard-Trennung

## Report

Der manuelle Sammel-Upload verwendet in `app/InseratStudio.tsx` die lokale Route `POST /upload-binary`. Diese Route hat bislang nach dem idempotenten Upload-Job-Claim ebenfalls `claimPlotDailyUpload(...)` aufgerufen. Dadurch griff der Grundstücks-Tagesguard auch bei explizit manuellen Sammelläufen: Das erste Inserat je Grundstück wurde übertragen, die weiteren Varianten wurden mit `PLOT_DAILY_UPLOAD_LIMIT_REACHED` blockiert.

Die Korrektur führt einen expliziten Ursprung `manual-batch` ein. Ausschließlich `/upload-binary` erhält diesen Ursprung und überspringt den Grundstücks-Tages-Claim. Der Rotationspfad `automaticRotationUpload(...)`, Scheduler, Canary und der Legacy-Pfad behalten ihren bisherigen Claim unverändert. Der Upload-Job-Ledger bleibt für alle Pfade aktiv und persistiert den Ursprung zusätzlich zur Job-ID.

Vor dem manuellen Lauf fragt die Oberfläche über den sitzungsgeschützten lokalen Endpunkt `GET /manual-batch-resumption` die bereits erfolgreich übertragenen Listings aus dem Upload-Job-Ledger ab. Die daraus gebildete Resumption-Planung schließt diese Listings aus, bevor die Bestätigung und die lokale Paketübergabe beginnen. Ein nicht verfügbarer Status sperrt den Lauf fail-closed.

## Nachweis des Ausgangszustands

Der lokale Upload-Job-Ledger enthielt genau zehn Einträge `transferred_pending_import` und dreißig Einträge `failed` mit `PLOT_DAILY_UPLOAD_LIMIT_REACHED`. Der lokale Grundstücks-Tagesguard enthielt dazu genau zehn abgeschlossene Claims. Die Katalog-`uploadHistory` war für diese erfolgreiche Übertragung noch nicht aktualisiert; deshalb ist der Job-Ledger die maßgebliche idempotente Evidenz.

Bereits erfolgreich und geschützt (10 Listing-IDs):

- `f8eedb6a-431b-45da-bff1-220cd65db915`
- `0ec2a5ae-0452-4a0a-b43f-b51b39169cc9`
- `6494a98f-434e-4122-b52a-a9297fe5fdc6`
- `efcff8ba-ddc4-4749-9460-8f9d682bcef7`
- `8fafef97-5681-4c21-8ab8-c08509201f4a`
- `7f843cba-faa3-4ccf-bf82-27000c931c8f`
- `b472b538-dc4b-4fd8-a0cd-b07d7eccef39`
- `8a8bea5b-5c8c-48f8-a8ca-ac1874a82215`
- `5525d9f4-d345-48ad-8462-d32271e1077e`
- `3b5488a4-ea70-4da5-adea-d3b86743db6f`

Noch offen (30 Listing-IDs):

- `f9e96fd4-6141-40ce-994a-1f94174f42ab`, `398047b3-2999-4031-879c-dbd65a1f62c3`, `33cd334e-e0e4-4ce2-8218-fe6a8d48484f`
- `c9241c9c-ce19-4477-91e8-fc35824bdd70`, `33a927a1-65a1-462f-9196-a5b1096cef7a`, `8aef3218-5ab6-411a-8890-2e067314b9b5`
- `86b890e8-a5ff-4dc0-91cc-38eecb5598e4`, `c01a58eb-90f3-4127-8ec7-3c7a4422f8e7`, `d641287c-e17c-43dc-b255-4072402f8bf3`
- `eb42390a-bb2d-47d4-8eeb-3a8cf5132e75`, `a3db2f52-abf6-41c7-95e5-d5757230fce4`, `fad5ec2b-1c79-4d15-979b-9ae64137bd7c`
- `89a212fa-e325-492d-bcf5-fbf7ca474b8d`, `29763d1d-0f50-4ddf-afba-88e9b72f4629`, `b5ba5079-0620-4e29-ba6a-4f679f57724a`
- `8da62635-679f-40c3-8296-4ad40b26d9c4`, `41553b5b-6c9b-46b7-b247-23aa9df1c079`, `dc025c2f-6170-4123-9721-d5ebccb93c59`
- `20f515b3-da8c-405a-b19e-8db96754c4be`, `3d5cd235-6d00-46d9-87a3-87d32faf40bf`, `7ee09373-f70a-443c-ba0a-3c3d09ba7405`
- `f302d88c-e48b-4092-93d1-dfd0d401e6d6`, `7e32e4f6-9dcf-44c0-9bef-578ba24029f3`, `497be308-caa2-4cf8-8dd8-daded2ff2a65`
- `c99f6e4a-c352-4d72-a11f-7d44fbdd343f`, `579bc711-7b7b-4190-8bbc-ee02f672b436`, `8a6651a2-ccec-4f23-8925-243167db1ea1`
- `e6a79bd9-64aa-41ea-9b0f-7834d8644382`, `57dc87ab-aea5-4160-bfab-5323ae863a99`, `5d22cdc2-ade2-4762-86d1-fb4576562cde`

## Tests und Dry-Run

Die Regressionstests decken ab:

- automatische Ursprünge beanspruchen weiterhin den Tagesguard;
- ein expliziter manueller Batch nimmt für vier Varianten desselben Grundstücks keinen Tages-Claim;
- bei einer erfolgreichen und drei offenen Varianten werden exakt die drei offenen gewählt;
- für zehn Grundstücke mit je einer erfolgreichen und drei offenen Varianten ergibt die Planung exakt 30 gewählte, 10 geschützte und null doppelte Listing-IDs.

Der reale, rein lokale Dry-Run gegen den aktuellen Katalog und Upload-Job-Ledger ergab: 30 zum Upload vorgesehen, 10 bereits erfolgreich/übersprungen, 0 Doppelübertragungen. Es wurde kein neues Paket erzeugt, kein Transfer gestartet und kein externer Dienst angesprochen.

## Technische Begründung

Die Ausnahme liegt am eindeutig manuellen HTTP-Endpunkt statt an einem globalen Schalter oder einem vom Browser frei wählbaren Flag. Damit bleibt der automatische Pfad fail-closed. Die Auswahl schützt sich zusätzlich über den persistenten Job-Ledger statt über kurzlebige Browserzustände.

## Hürden und Risiken

Die erfolgreiche FTPS-Übertragung ist noch keine Importbestätigung. Die zehn geschützten Einträge bleiben daher `transferred_pending_import`; sie werden nicht zu `published` hochgestuft. Die manuelle Ausnahme lockert ausschließlich das pro Grundstück tägliche Aufnahme-Limit. Sie deaktiviert weder Job-Idempotenz noch Katalogprüfung, Rotation, Scheduler, Portalexport oder Löschmechanismen.
