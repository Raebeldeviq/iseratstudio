# Aktuelle Katalogtext-Bereinigung – 26. September 2026

## Report

Der reale Produktionskatalog enthielt nach dem kontrollierten Erstupload 24 aktive Inserate. Vier bereits vorbereitete Inserate waren claim-frei; die 20 übertragenen Inserate enthielten noch historische Objekt- und Standardtexte. Der zentrale Scanner meldete deshalb 245 `BLOCK` und 0 `REVIEW`.

Die einmalige Migration ist exakt an diese 24 aktiven Inserat-IDs sowie an kryptografische Hashes der 20 ausdrücklich zur Ersetzung freigegebenen Objektbeschreibungen und fünf Überschriften gebunden. Sie erzeugt für diese 20 Inserate die neue lokale, reproduzierbare Objektbeschreibung, ersetzt ausschließlich die fünf tatsächlich blockierenden Überschriften und überführt bekannte historische Systemstandards in die aktuelle zentrale statische Textfassung.

Vor jeder Speicherung wird ein byte-identischer Katalogbackup erstellt. Die Persistenz erfolgt atomar und CAS-geschützt. Ein zweiter Lauf ist idempotent. Die Migration besitzt keinen OpenImmo-, FTPS-, Portal-, KI- oder Uploadpfad.

## Begründung

Die vorhandenen historischen 44er-Migrationen bleiben unverändert und verweigern den abweichenden aktuellen 24er-Katalog weiterhin fail-closed. Eine neue, enger begrenzte Einmalmigration vermeidet deshalb jede Lockerung dieser früheren Freigabeverträge. Die Hashbindung verhindert, dass ein nach der Nutzerfreigabe veränderter Text überschrieben wird.

Die Objekttexte werden mit derselben zentralen Fallback-Logik erzeugt, die auch für neue Inserate getestet ist. Finanzierungshinweis und CTA werden genau einmal angefügt. Preise, interne Variantenkennungen und unbelegte Claims bleiben ausgeschlossen. Komfortlüftung erscheint ausschließlich bei vorhandener strukturierter Evidenz.

## Hürden und Risiken

- Die reale Kataloggröße wich vom historischen 44er-Migrationsumfang ab.
- 20 Ausstattungsfelder waren bekannte frühere Systemstandards, wurden von der neueren Feldherkunftsarchitektur aber konservativ als Abweichung angezeigt. Die zentrale Claim-Policy klassifizierte sie dennoch eindeutig als sicher deterministisch ersetzbare historische Standards.
- Jede Änderung an aktivem Inseratumfang, Ausgangstext-Hash, Claim-Anzahl oder Zielfeldmenge stoppt die Migration vor der Speicherung.
- Die Migration löst keine Portalaktion aus. Die Darstellung in Immoprofessional und ImmoScout muss nach einem separaten kontrollierten Upload geprüft werden.
