# Phase 2B.1 – sichere Bestandsbereinigung

## Kurzreport

Die Migration leitet ihren Scope ausschließlich aus `SAFE_DETERMINISTIC_REPLACEMENT` der zentralen Phase-2B-Policy ab. Sie ersetzt nur für das jeweilige freigegebene Feld hinterlegte kanonische Phase-2A-Textbausteine und validiert jedes resultierende Feld vor dem atomaren Katalog-Commit erneut.

## Begründung

Der produktive Write nutzt den vorhandenen V2-Katalogpfad mit Pending-Snapshot, Compare-and-Swap und Sperre. Vor einem Write wird ein byteidentischer, nicht überschreibbarer Manifest-Backup abgelegt. Ein Integritätsvergleich erlaubt nach dem Commit ausschließlich die zuvor geplanten Textfelder.

## Hürden und Risiken

Der Katalog enthält weiterhin manuelle BLOCK-Treffer. Diese werden nicht umformuliert oder gespeichert. Ändert eine andere App-Sitzung den Katalog zwischen Planung und Commit, schlägt der Compare-and-Swap fehl und die Migration stoppt. Fehlende Bilder oder eine notwendige globale Normalisierung stoppen den Vorgang ebenfalls vor dem Commit.
