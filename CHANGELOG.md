# Änderungsprotokoll

## Unreleased · Globale Bildrollenübernahme – 22. September 2026

### Report

- Die Bildkarten **Emotionaler Catch**, **Auszeichnungen**,
  **Vertrauensbild** und **QR-Abschluss** erhalten im Haustyp-Editor eine
  bestätigte Aktion „Auf alle Haustypen anwenden“.
- Die Übernahme ersetzt vorhandene Karten derselben Rolle vollständig,
  ergänzt fehlende Karten und entfernt nur Dubletten dieser einen Rolle.
  Andere Bildkarten bleiben unverändert.
- Die komplette fachliche Bildkarte einschließlich Asset-ID/-Referenz,
  Beschriftung, MIME-Typ und Metadaten wird in allen vorhandenen Haustypen
  referenziert. Die transaktionale Katalogsicherung speichert das gemeinsame
  Asset daher nur einmal.
- Vor dem Erfolgshinweis werden Browser- und – sofern verfügbar – die
  transaktionale macOS-Katalogsicherung aktualisiert. Fehler belassen die
  sichtbare Katalogansicht unverändert und werden verständlich angezeigt.

### Begründung

Die globale Regel ist als geschlossene, explizite Rollenliste umgesetzt. So
bleiben haustypspezifische Rollen wie Büro, Außenansicht und Grundrisse
unberührt. Die bestehende kanonische Rollensortierung bleibt zuständig für die
Positionen: Sie verhindert Positionskonflikte, ohne fremde Bildkarten zu
löschen, und erhält die Innenraumreihenfolge.

### Hürden und Risiken

- Die Position einer Karte ist im Katalog kein separates Feld, sondern die
  geordnete Stelle im Bildarray. Die Übernahme verwendet deshalb bewusst die
  vorhandene `orderHouseImages`-Logik statt eine konkurrierende Positionierung
  einzuführen.
- Die Dualspeicherung besteht aus einer Browserkopie und einer atomaren
  macOS-Katalogsicherung. Der Gerätekatalog wird bei erreichbarem Helfer zuerst
  transaktional bestätigt; bei einem Fehler gibt es keinen Erfolgshinweis.
- Neue Tests decken die Rollenbegrenzung, Ersetzen und Ergänzen, den
  Dublettenschutz, die Reihenfolge, die Sperre normaler Rollen und die
  persistente Einmalablage des gemeinsamen Assets ab.
- Die Integritätsprüfung lässt unveränderliche `dataUrl`-Nutzdaten beim
  Zustandsvergleich aus. Damit wird beim Laden eines Katalogs mit global
  referenzierten Bildkarten kein mehrere hundert Megabyte großer Vergleichsstring
  aufgebaut; die Bilddaten selbst bleiben unverändert erhalten.

## Unreleased · Lokale Installation – 15. September 2026

- Projekt, Abhängigkeiten und Sicherungsnachweise außerhalb von iCloud kopiert; alte Arbeitsordner nicht gelöscht oder übernommen.
- Excel-Abgleich verwendet eine lokale Application-Support-Arbeitsquelle. Der implizite Rückfall der Medienbibliothek auf iCloud entfällt.
- Grund: Ausgelagerte Dateien blockierten selbst Git, Tests und Desktopstart. Ein lokaler Release darf nicht von nachträglichen Cloud-Downloads abhängen.
- Grenze: Ein lokaler Dateipfad ersetzt keine fachliche Gebiets- oder Providerprüfung. Ungeklärte historische Vorgänge bleiben produktiv gesperrt; pausierte Aufgaben werden nicht still aktiviert.

## Unreleased · Katalogintegrität und sichere Wiederinbetriebnahme – 14. September 2026

### Report

- UI-Normalisierung erhält vollständige Lifecycle-Datensätze und terminale Historie, statt aktive Varianten als reduzierte Kopien zurückzuschreiben. Widersprüchliche Dubletten stoppen das Laden; nach Ladefehlern wird kein leerer Zustand gespeichert.
- Katalog-Commits verwenden einen persistenten exklusiven Claim und atomaren Austausch nach CAS-Prüfung. Browser dürfen bestätigte Status-/Löschprovenienz nicht überschreiben. Bildbereinigung während konkurrierender Sicherungen entfällt.
- Ein beleggebundener, rein lokaler Reparaturplan trennt eindeutig rekonstruierbare historische Löschungen von fehlenden Originaldatensätzen. Ungeklärte Daten sperren Scheduler, Upload und Production-DELETE zusätzlich zu den Betriebsmodi.
- Reparierte Gerätesicherungen haben Vorrang vor älteren Browserständen. Der separate Grundstücks-Sync hat eine sichtbare persistente Pause; fehlende oder beschädigte Einstellung bedeutet pausiert.
- Der Startknopf nutzt ausschließlich installierte Release-LaunchAgents. Er führt keinen Katalog-Bootstrap, keine Paketinstallation und keinen Working-Directory-Helperstart mehr aus. Releases können die vorgebaute Oberfläche einschließlich ihrer Laufzeitabhängigkeiten mitführen.

### Begründung

Die Browseransicht darf nicht die allein im Hintergrund geführte Veröffentlichungshistorie zerstören. Reparatur und Wiederanlauf bleiben deshalb getrennt: belegte interne Korrekturen sind möglich, externe Mutationen erst nach geklärtem Bestand.

### Hürden und Risiken

- Fehlende Originalinserate sind ohne belastbare Sicherung bzw. Providerdaten nicht rekonstruierbar. Die Reparatur erfindet keine Inserate oder Importbestätigungen.
- Ein nach Prozessabbruch übrig gebliebener Commit-Claim wird nicht blind gelöscht. Er erfordert eine Eigentümerprüfung.
- Der neue Pause-Schalter steuert ausschließlich den Helper-Sync, nicht unabhängige Codex-Automationen. Keine PLZ- oder Grundstücksbereinigung wird aus fehlender Historie abgeleitet.
- Die vorhandenen Zeitfenster, Tageslimits, Mail-Serialisierung, FTPS-Deduplizierung und Providerbestätigungsverträge bleiben erhalten. Es wurden keine realen Uploads oder Löschungen als Tests ausgeführt.

## Unreleased · Exklusive 21:00-Schedulergrenze – 7. September 2026

### Report

- Das Produktionszeitfenster wird nun als halboffenes Intervall
  `08:00–21:00 Europe/Berlin` ausgewertet: Starts bis `20:59:59` sind zulässig,
  ab `21:00:00` darf kein neuer Lifecycle mehr beginnen.
- Die bestehenden Scheduler- und seriellen Lifecycle-Tests prüfen die Grenze
  jetzt ausdrücklich bei `21:00:00`, `21:00:02` und `21:00:59` in Sommer- und
  Winterzeit.

### Begründung

Die bisher minutengenaue inklusive Endprüfung ließ die gesamte Minute 21:00
noch als Startzeit zu. Dadurch konnte nach Abschluss einer vorher gestarteten
Kette um `21:00:02` ein weiterer Lifecycle beansprucht und übertragen werden.
Die exklusive Endgrenze setzt den dokumentierten Vertrag „ab 21:00 kein neuer
Start“ direkt in der zentralen Zeitfensterprüfung um.

### Hürden und Risiken

- Bereits vor 21:00 sicher gestartete Import- und DELETE-Bestätigungsketten
  dürfen weiterhin nach 21:00 abschließen; nur der Start eines neuen
  Lifecycles wird blockiert.
- Der Fix verändert weder Schedulerlimits noch Upload-, DELETE-, Mail-,
  Creative-, Claim-, Lease-, Lock- oder Portalexport-Verträge.

## Unreleased · Prozessweite Apple-Mail-Serialisierung – 6. September 2026

### Report

- Sämtliche read-only Apple-Mail-Aufrufe der Import- und
  DELETE-Bestätigungsadapter laufen nun über denselben prozessweiten,
  FIFO-basierten Access-Guard. Lifecycle-Coordinator, periodischer
  Hintergrunddienst, Startup-/Recovery-Prüfung und Runtime-Probe teilen damit
  innerhalb eines Helper-Prozesses exakt einen aktiven AppleEvent-Zugriff.
- Der Guard begrenzt Warteschlange und Wartezeit, gibt den Zugriff in jedem
  Erfolgs- und Fehlerpfad frei und hinterlässt bei einem Prozessabbruch keinen
  persistenten Lock.
- Ausschließlich die eindeutig klassifizierte AppleEvent-Signatur `-609`
  („Verbindung ist ungültig“) erhält für read-only Mailabfragen höchstens zwei
  kurze Wiederholungen. Permission-, Timeout-, Setup-, Parser- und unbekannte
  Fehler bleiben ohne pauschalen Retry fail-closed.
- Regressionstests decken beide Zugriffsrichtungen, Exception-/Timeout-
  Freigabe, `-609`-Erfolg und -Erschöpfung, unbekannte Fehler sowie drei
  serielle Lifecycles bei gleichzeitig aktivem Hintergrundtimer ab. FTPS- und
  DELETE-Transferzähler bleiben dabei je Lifecycle exakt eins.

### Begründung

Import- und DELETE-Bestätigung verwendeten bislang getrennte lokale
Single-Flight-Grenzen. Ein gemeinsamer Guard direkt am AppleScript-
Ausführungspunkt erfasst alle bestehenden Caller, ohne Scheduler-, Lifecycle-,
FTPS- oder DELETE-Verträge zu verändern. Der Retry liegt ebenfalls innerhalb
der read-only Ausführung; dadurch kann er keine vorgelagerte externe Mutation
wiederholen.

### Hürden und Risiken

- Die Warteschlange muss lang laufende AppleEvents aufnehmen, ohne unbegrenzt
  zu wachsen oder dauerhaft zu blockieren. Kapazität und Wartezeit sind daher
  fest begrenzt; ein Überschreiten erzeugt einen expliziten fail-closed
  Mailfehler.
- Zwischen zwei `-609`-Versuchen wird der Guard freigegeben. So kann ein bereits
  wartender read-only Caller fair fortfahren; Message-ID-/Hash-/Ledger-Dedupe
  bleibt für eine doppelt sichtbare Providermail unverändert zuständig.
- Dieser Entwicklungsstand führt keine Rotation, keinen Upload, keinen DELETE
  und keinen Portalexport aus. Der produktive Runtime-Wechsel erfolgt erst nach
  vollständig grünem QA- und Runtime-Preflight.

## Unreleased · 9-Tage-Produktionsstart-Guards – 4. September 2026

### Report

- Der automatische Upload-Guard unterscheidet nun reguläre, exakt an die
  persistente Production-Policy gebundene Schedulerläufe bis zum globalen
  Tageslimit von 40 von einem separat autorisierten One-Shot. Schedulerlauf,
  ursprünglicher Produktions-Lifecycle und effektives Limit müssen
  widerspruchsfrei belegt sein.
- Deterministische Rotationskopien sind zusätzlich an die konkrete
  Schedulerlauf-ID gebunden. Eine vorhandene Kopie darf nur im selben offenen
  Lifecycle und ausschließlich in einem fortsetzbaren Zustand wiederverwendet
  werden; `published`, `transferred_pending_import`, `archived`, `deleted` und
  andere terminale Zustände sind ausgeschlossen.
- Einen einmaligen, fail-closed und idempotenten internen
  Reconciliation-Vertrag für `30460-108038 → 30460-674991` ergänzt. Er verlangt
  die unveränderte 85er-Scope-, Evidence- und Classification-Provenienz,
  `repair_completed` sowie den positiven objektgebundenen Provider-Löschbeleg.
  Er stellt ausschließlich B intern auf `deleted` und die Scheduler-Ownership
  von A auf `published` zurück.
- Regressionstests decken Policy-Limit 40, unveränderten One-Shot-Schutz,
  terminale Kopien, zulässige Restart-/Resume-Kopien und die lokale
  A/B-Reconciliation ohne externen Transfer ab.

### Begründung

Der reguläre Tagesvertrag und der historische One-Shot besitzen verschiedene
Provenienzketten. Der Guard prüft deshalb den persistierten Policywert direkt
gegen den in der Kopie gespeicherten Produktions-Lifecycle, statt ein Limit
größer drei pauschal als One-Shot zu interpretieren. Die Lauf-ID im
deterministischen Kopieschlüssel verhindert zugleich, dass ein neuer Zyklus auf
eine abgeschlossene historische Kopie zeigt.

Die Katalogkorrektur bleibt bewusst ein exakt kompiliertes Einzelwerkzeug. Sie
leitet keinen Status aus Vermutungen ab, sondern verlangt Kampagnenabschluss,
Löschbericht und DELETE-Ledger gemeinsam und verändert weder Provider noch
FTPS, Mail oder Portal.

### Hürden und Risiken

- Eine Restart-Wiederaufnahme besitzt eine neue überwachende Schedulerlauf-ID,
  darf aber nur den unveränderten ursprünglichen Produktions-Lifecycle
  fortsetzen. Beide IDs werden getrennt geführt; Policy und Lifecycle-Limit
  müssen weiterhin exakt übereinstimmen.
- Die Reconciliation stoppt bei jeder Abweichung des A/B-Schadenbilds oder der
  historischen Belege. Sie darf nur bei Rotation, Production-DELETE und
  Portalexport auf `off` sowie ohne offene Jobs, Claims oder Leases laufen.
- Dieser Stand startet keine Rotation und führt keinen FTPS-, DELETE- oder
  Portaltransfer aus. Ein produktiver Start benötigt nach dem Release-Preview
  eine neue ausdrückliche Freigabe.

## Unreleased · 9-Tage-Rotationsbetrieb – 2. September 2026

### Report

- Das intern persistierte `schedulerDate` ist jetzt die alleinige
  Fälligkeitsbasis. Bestehende Kataloge migrieren dieses Feld verlustfrei aus
  dem bisherigen internen `lastSuccessAt`/`lastUpdatedAt`; Portalalter,
  Maildatum und externe Zeitstempel fließen nicht in die Auswahl ein.
- Die Fälligkeit liegt exakt neun lokale Kalendertage später zur selben
  Uhrzeit in `Europe/Berlin`. Die Auswahl ist global nach dem ältesten
  Schedulerdatum sowie stabil nach Projekt- und Listing-ID sortiert.
- Einen im Katalog persistierten, CAS-atomaren und auditierbaren Tages-Claim
  ergänzt. Er erlaubt höchstens 40 neu gestartete Rotationslifecycles je
  Berliner Kalendertag, bleibt bei Restart erhalten und zählt einen Fehler
  nicht zurück. Wiederaufnahmen verbrauchen keinen zweiten Claim.
- Das produktive Per-Run-Limit akzeptiert nun bis zu 40 Einträge. Die
  bestehende serielle Import-/Handover-/DELETE-Kette arbeitet diese ohne
  künstliche Pause zwischen den Grundstücken ab; der unabhängige Plot-Guard
  bleibt bei einem Hausupload je Grundstück und Tag.
- Importbestätigungen setzen das Schedulerdatum des neuen Owners auf den
  bestätigten Provider-Importzeitpunkt. CreativeSelection, Payload-Guard,
  FTPS-/DELETE-Deduplizierung und der manuell deaktivierte Portalexport bleiben
  unverändert.
- Den historischen `REGRESSION_85`-Worker einschließlich Startup-Aufruf,
  Intervall und Importbericht-Campaign-Watcher aus dem normalen Helperpfad
  entfernt. Die geschlossene Kampagne bleibt als Audit- und Mutationsevidenz
  erhalten, startet jedoch nie wieder automatisch.
- Einen einmaligen, fail-closed und hashgebundenen internen
  Scheduler-Owner-Reconciliation-Vertrag ergänzt. Er erkennt exakt 39
  inaktive Alt-Owner der abgeschlossenen 85er-Kampagne, deaktiviert nur deren
  automatische Aktualisierung und protokolliert jede Änderung auditierbar.
  Inserate, Veröffentlichungsstatus und externe Systeme bleiben unverändert.
- Die vollständige Klassifikation aller 41 inaktiven Scheduler-Owner in
  `NINE_DAY_ROTATION_BLOCKER_REVIEW.md` dokumentiert. Die zwei regulären,
  extern weiterhin vorhandenen Objekte bleiben unveränderte fachliche
  Ausnahmen und blockieren die übrige Due-Queue nicht.
- Auswahlregressionen für 39/40 gültige Kandidaten, 40 gültige aus 50 mit zehn
  Blockern und den übersprungenen ältesten Blocker ergänzt. Die
  `schedulerDate`-Migration ist zusätzlich auf deterministischen,
  restart-idempotenten Betrieb ohne Zähleränderung geprüft.

### Begründung

Der Katalog besitzt bereits einen atomaren CAS-Speicher und eine bewährte
serielle Lifecycle-Barriere. Der Tageszähler wurde deshalb dort als
idempotenter Start-Claim ergänzt, statt eine zweite Scheduler- oder
Parallelarchitektur einzuführen. Die vorhandene zentrale Zeitzonenhilfe wurde
um lokale Kalendertage erweitert, damit Sommer-/Winterzeit keine Stunde
verschiebt.

Die 85er-Reconciliation ist bewusst kein allgemeiner Filter für inaktive
Varianten. Sie akzeptiert ausschließlich den unveränderten abgeschlossenen
85er-Vertrag und verlangt pro Alt-Owner einen aktiven veröffentlichten
Alternativ-Owner desselben Grundstücks. Echte Datenfehler bleiben damit
sichtbar und werden lediglich lokal vom Scheduler übersprungen.

### Hürden und Risiken

- Der 40er-Betrieb darf erst nach
  `REGRESSION_85_CLOSED_MANUAL_RECONCILIATION`, grünem Production Preview und
  expliziter Runtime-Freigabe aktiviert werden. Dieser Entwicklungsstand führt
  keine produktive Rotation, keinen Upload und keinen DELETE aus.
- Ein gestarteter Lifecycle verbraucht sein Tagesbudget auch bei einem späteren
  Fehler. Das ist absichtlich fail-closed und verhindert Retry-bedingte
  Überschreitungen.
- Automatischer Portalexport bleibt `off`; die nachgelagerten Plattformen
  werden weiterhin manuell bedient.
- Die interne 39er-Reconciliation ist ein kontrollierter Deployment-Schritt
  und wird in diesem Entwicklungsstand nicht gegen den Produktionskatalog
  ausgeführt. Hash-, Abschluss-, Scope- oder Statusabweichungen stoppen sie
  vollständig. Die zwei regulären Ausnahmen `30460-131712` und
  `30460-628198` benötigen weiterhin eine separate fachliche Entscheidung.

## Unreleased · 85er-Resume-Gate – 30. August 2026

### Report

- Das Operational Gate zählt den unveränderlichen 85er-Scope nun als Summe aus
  noch aktiven Reparatureinträgen und vollständig evidenzgebunden
  abgeschlossenen Rollbacks. Dadurch kann eine pausierte Kampagne nach einem
  bestätigten Zwischenstand wie `1/85` sicher fortgesetzt werden.
- Ein abgeschlossener Rollback wird nur anerkannt, wenn A weiterhin
  `published` und alleiniger Scheduler-Owner ist, B eindeutig `deleted` ist
  und genau ein terminaler DELETE-Job samt exakt zugeordnetem positivem
  Löschbericht existiert. Offene Leases, Scheduler-Claims, Uploadjobs,
  doppelte DELETE-Jobs oder widersprüchliche A→B-Daten blockieren.
- Die CLI-Aktivierung bindet zusätzlich den unveränderten
  Classification-Fingerprint an den freigegebenen 85er-Vertrag. Bei `85/85`
  wird die Kampagne unmittelbar terminal `completed`; ein neuer Lifecycle wird
  nicht mehr gestartet.
- Regressionstests für `1/85`, `2/85`, `84/85`, `85/85`, mehrfachen Restart,
  fehlenden Marker ohne Abschluss, fehlenden Löschbeleg, falsche B-Zuordnung,
  Fremdmarker, abweichende Hashes, fehlerhafte Scheduler-Ownership, aktive
  Uploadjobs und doppelte DELETE-Evidenz ergänzt.

### Begründung

Die Rollback-Finalisierung entfernt den historischen Marker von A absichtlich,
nachdem B positiv bestätigt gelöscht und A als Scheduler-Owner wiederhergestellt
wurde. Das bisherige Aktivierungs-Gate interpretierte genau diesen korrekten
terminalen Zustand beim Resume fälschlich als Scope-Verlust. Die neue Prüfung
akzeptiert nicht den fehlenden Marker selbst, sondern ausschließlich den
vollständig belegten Abschlusszustand des unveränderten Scope-Eintrags.

### Hürden und Risiken

- Markerfreiheit allein bleibt ausdrücklich unzureichend. Fehlt nur ein
  Bestandteil der Job-, Bericht-, A→B-, Scheduler- oder Hash-Provenienz, stoppt
  das Gate fail-closed.
- Bereits abgeschlossene Einträge werden weder zurückgesetzt noch erneut
  ausgewählt. Die Änderung erzeugt keine Upload-, DELETE-, Creative- oder
  Portalaktion und ändert keine persistierten Scope- oder Evidenz-Hashes.
- Eine produktive Wiederaufnahme bleibt an einen separat integrierten und als
  Release-Runtime verifizierten Commit gebunden.

## Unreleased · Never-exported DELETE-Bestätigungsvertrag – 28. August 2026

### Report

- Den Production-DELETE-Parser um den getrennten Bestätigungstyp
  `provider_object_delete_confirmed_non_exported` ergänzt. Der normale
  Börsen-Löschnachweis bleibt für alle regulären portalexportierten Objekte
  weiterhin verpflichtend.
- Eine atomare und unveränderliche 85er-Attestation eingeführt. Sie bindet den
  festen Scope-, Evidence- und Klassifikations-Fingerprint an exakt 85
  Portalstatussätze mit dreimal `not_transferred` sowie an den Negativabgleich
  gegen Portaljob-Ledger und Portalprotokoll.
- Die Portalprovenienz wird auch nach Erstellung der Attestation bei jeder
  Berichtbestätigung erneut geprüft. Jede spätere Scope-Referenz, jeder
  unbekannte Portalstatus und jede Hash-/Job-/A→B-Abweichung blockiert
  fail-closed.
- DELETE-Ledger, gelöschtes Listing und Katalogbericht speichern den echten
  Bestätigungstyp und den Attestation-Hash getrennt vom normalen
  Börsenlöschpfad.
- Einen einmaligen, FTPS-freien Maintainerpfad für den bereits übertragenen
  DELETE `30460-423286 → 30460-755080` ergänzt. Er verlangt pausierte Kampagne,
  alle produktiven Modi `off`, exakt einen bestehenden Pending-Job sowie einen
  aktuellen read-only Presence-Nachweis und kann die übrigen 84 Vorgänge nicht
  starten.
- Tests A–H für reguläre Börsenlöschung, fehlenden Börsennachweis,
  Never-exported-Erfolg, unbekannte/übertragene Portalzustände, falsche
  Objektnummer, falschen Fingerprint sowie Providerfehler/-warnungen ergänzt.
  Restart- und Deduplizierungstests bestätigen zusätzlich null zweite
  Übertragung.

### Begründung

Der reale Providerbericht bestätigt die objektbezogene Löschung eindeutig,
enthält für das nachweislich nie exportierte Rogue-B aber keinen Börsenabschnitt.
Die historischen Vergleichsberichte portalexportierter Objekte enthalten
dagegen dieselbe positive Objektzeile plus vier Börsenzeilen. Die getrennten
Verträge bilden diese reale Semantik ab, ohne die allgemeine
DELETE-Sicherheitsprüfung zu lockern.

### Hürden und Risiken

- Ein bloßes Flag `targetWasNeverPortalExported` genügt ausdrücklich nicht.
  Nur ein vom Resolver erzeugter, zur Laufzeit validierter Kontext wird vom
  Parser akzeptiert.
- Eine beschädigte, fehlende oder abweichende Attestation sowie jede neue
  Portalprovenienz blockiert. Es gibt keinen Fallback auf die positive
  Objektzeile allein.
- Der Maintainerpfad führt keinen zweiten DELETE aus. Ein partieller interner
  Abschluss ist über Ledger-, Katalog- und Kampagnenpersistenz idempotent
  fortsetzbar; externe Mutationen bleiben ausgeschlossen.

## Unreleased · Rollback-Aktivierungs-Gate – 28. August 2026

### Report

- Das Aktivierungs-Gate der exakten 85er-Reparatur zählt weiterhin alle 85
  klassifizierten Scope-Einträge, prüft die Creative-Mindestvariation jedoch
  nur noch gegen die tatsächlich als `REPLACEMENT_REQUIRED` klassifizierten
  Vorgänge.
- Eine vollständig rollbackfähige Kampagne mit 85 × `ROLLBACK_ELIGIBLE` und
  null Creative-Kandidaten wird dadurch nicht mehr fälschlich vor der ersten
  Mutation abgewiesen.
- Einen Integrationstest für die CLI-Aktivierung der reinen Rollbackkampagne
  ergänzt. Er bestätigt 85 Scope-Einträge, null Creative-Kandidaten und den
  kontrollierten Übergang von `off` nach `active`.

### Begründung

`candidateCount` beschreibt ausschließlich neu zu erzeugende C-Replacements.
Bei einem sicheren A-behalten/B-löschen-Rollback ist dieser Wert fachlich null.
Die bisherige Gleichsetzung mit der Gesamtzahl 85 vermischte Scope-Vollständigkeit
und Creative-Planung und blockierte deshalb den korrekten Minimalrepair.

### Hürden und Risiken

- Die Scope-Vollständigkeit bleibt separat auf exakt 85 gebunden; eine kleinere
  oder beschädigte Klassifikation wird weiterhin fail-closed abgewiesen.
- Creative-Diversitätsregeln bleiben für jeden echten Replacementfall aktiv.
  Der Fix lockert weder Runtime-Ownership noch Marker-, DELETE-, Lease-, CAS-
  oder Serialisierungsprüfungen.
- Vor einer neuen produktiven Runtime sind vollständige Tests, Build und eine
  erneute explizite Deploymentfreigabe erforderlich. Bis dahin bleiben
  Kampagne und Production-DELETE auf `off`.

## Unreleased · Klassifizierter 85er-Rollback/Replacement-Repair – 26. August 2026

### Report

- Die exakte 85er-Allowlist auf den freigegebenen Scope-Hash
  `abcf59c654f573bc13906e555badeb13e090eb67d9c971cfb0216b5a4abace58`
  festgelegt und zusätzlich mit einem unveränderlichen Hash der rekonstruierten
  A→B-, Listing-, Plot-, Scheduler- und Uploadprovenienz gebunden.
- Monotone Rogue-Replacements im Zustand `published` werden ausschließlich bei
  exakt positivem Importbericht und passendem ursprünglichem Uploadjob als
  gültige Scope-Mitglieder akzeptiert. Außerhalb dieses 85er-Vertrags wurde
  keine Statuslockerung eingeführt.
- Einen vollständigen read-only Klassifikator für `ROLLBACK_ELIGIBLE`,
  `REPLACEMENT_REQUIRED` und `AMBIGUOUS` ergänzt. Klassifikation, Grund,
  Evidenz-Hash, Zeitpunkt, Strategie und Repairzustand werden persistent und
  nachträglich unveränderlich gespeichert.
- Das Operational Gate akzeptiert exakt die bekannten In-Scope-Marker, sperrt
  84/86 sowie jeden Fremdmarker und erlaubt eine fehlende Markierung nur bei
  einer als `REPLACEMENT_REQUIRED` klassifizierten, positiv bestätigt
  gelöschten A-Source.
- Für Rollbackfälle den bestehenden Production-DELETE-Vertrag eng auf B
  erweitert: A bleibt published, B ist das einzige DELETE-Ziel, A wird erst
  nach positivem B-Löschbericht wieder Scheduler-Owner und es entstehen weder
  C, FTPS-Hausupload noch Daily-Plot-Guard-Verbrauch.
- Der bisherige B→C-Pfad bleibt ausschließlich für nachweislich gelöschte A
  erhalten. AMBIGUOUS-Einträge sind terminal blockiert und lösen keine
  Katalog-, Upload-, Portal- oder DELETE-Mutation aus.
- Tests für 85/86/84+Fremdmarker, vollständige A→B-Provenienz, externe
  Abwesenheit ohne Deleteconfirmation, positive Replacement-Evidenz,
  Rollback-DELETE, positive Bestätigung, Restart/Idempotenz und null neue
  Rollback-Uploads ergänzt.

### Begründung

Die 85 Marker gehören zum bekannten Rogue-Batch und sind deshalb kein
unbekannter Fremdzustand. Gleichzeitig wäre ein pauschales Zurücksetzen der
Marker oder ein drittes Inserat für jeden Vorgang unnötig und riskant. Die
Klassifikation trennt die unveränderliche technische A→B-Provenienz von der
zeitabhängigen externen Präsenzbeobachtung. Damit kann der kleinste sichere
Repair gewählt werden: B löschen und A behalten, sofern A eindeutig noch
existiert; B nur dann durch C ersetzen, wenn A nachweislich gelöscht wurde.

### Hürden und Risiken

- Die externe A-Präsenz und die drei B-Portalstatuswerte benötigen eine
  authentifizierte read-only Immoprofessional-Sitzung. Ohne diese Original-
  beobachtung bleibt der jeweilige Vorgang `AMBIGUOUS`; lokale Katalogwerte
  werden nicht als Ersatz für externe Präsenz ausgegeben.
- Beim Rollback tragen zunächst 85 alte A-Marker die historische A→B-Kette.
  Der exakte DELETE-Pfad filtert daher vor der Identitätsbildung auf das eine
  freigegebene B-Ziel; der Mutationsguard und die serielle Campaign-Lease
  bleiben zusätzlich verbindlich.
- Ein Marker wird erst nach positivem B-Löschbericht bereinigt. Transferfehler,
  Mailfehler oder widersprüchliche Evidenz lassen A und alle übrigen Einträge
  fail-closed unverändert.
- Dieser Branch führt vor QA, Commit, Maintainer-Fast-Forward und neuer staged
  Release-Runtime keinerlei Live-Upload, DELETE oder Portalmutation aus.

## Unreleased · Exakte 85er-Regressionsreparatur und Runtime-Ownership – 25. August 2026

### Report

- Den vollständig belegten Rogue-Batch als unveränderliche Allowlist mit exakt
  85 Listing-/Objektnummern, Prozess `4460`, Uploadjob-, Scheduler-, Plot-,
  Haus-, Hero- und read-only Portalprovenienz modelliert. 84, 86, Dubletten,
  fehlende Portalzeilen und eine abweichende Hausverteilung blockieren
  fail-closed.
- Einen persistenten seriellen B→C-Reparaturworker ergänzt. Er verwendet die
  bestehende Creative-/Rotationsengine, den Daily-Plot-Guard, das Uploadledger,
  die positive Importbestätigung und den bestehenden Production-DELETE. Erst
  nach bestätigtem Ersatzimport darf B gelöscht werden; erst der positive
  Löschbericht schließt einen Datensatz ab.
- Produktionsmutationen zusätzlich an genau eine saubere staged
  `helper-runtime/release-*`-Runtime, deren Manifest-Commit, Launcher,
  Arbeitsverzeichnis, alleinigen Helperprozess und alleinigen Port-Owner auf
  `43182` gebunden. Alte oder direkt aus einer Source-Arbeitskopie gestartete
  Helper bleiben mit `PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH` beziehungsweise
  `PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED` gesperrt.
- Den Creative-Payload-Vertrag verschärft: Eine fehlende persistierte
  `creativeSelection` blockiert jeden produktiven Transfer mit
  `PRODUCTION_CREATIVE_SELECTION_MISSING`; die vorhandene ZIP-/XML-/Bildprüfung
  bleibt danach unverändert verpflichtend.
- Einen reinen Production-DELETE-Bestätigungslauf ergänzt. Der Helper prüft
  bereits übertragene DELETEs vor neuen Import-/DELETE-Aktionen und darf bei
  noch offener Bestätigung keinen weiteren DELETE starten.
- Read-only Gesamtpreview, persistente Kampagnenstufen, atomaren
  Kampagnen-Claim, Scheduler-Lease, Restart-/Deduplizierungslogik, Checkpoints
  nach 5/10/20/40/60/80 und exakte Portal-Exclusions für die alten 85 ergänzt.

### Begründung

Die Regression entstand nicht in der Creative-Auswahl, sondern durch einen
veralteten, manuell im Hintergrund gestarteten Helper aus einer alten
Arbeitskopie. Eine reine Datenkorrektur hätte deshalb die Wiederholung nicht
verhindert. Der neue Vertrag verbindet Prozess-Ownership und unveränderliche
Scope-Provenienz mit einem vollständig seriellen Replacement-first-Lifecycle.
Die fehlerhafte B-Kopie wird für die Creative-Verteilung am nachgewiesenen
ursprünglichen Hausplatz simuliert; dadurch werden keine legitimen
SOL-242-Inserate außerhalb der Allowlist angefasst.

### Hürden und Risiken

- Die deklarierte Europe/Berlin-Zeitspanne und die tatsächlichen ISO-Belege
  weichen am Ende voneinander ab. Der Scope wird deshalb ausschließlich aus
  den 85 konkreten erfolgreichen Jobs von Prozess `4460` gebildet; beide
  Zeitangaben bleiben getrennt auditierbar.
- Die Immoprofessional-Sammelansicht zeigte einen Zähler von 85, renderte aber
  nur 73 Zeilen. Die fehlenden zwölf Objektnummern wurden einzeln read-only
  nachgeschlagen und ebenfalls als nicht übertragen belegt.
- Die bereits übertragene DELETE-Kette `30460-325676 → 30460-819458` bleibt
  ohne positiven Löschbericht offen. Die Kampagne kann deshalb nicht aktiviert
  werden, bis diese fremde offene Kette eindeutig reconciliert ist.
- Der Reparaturcode führt vor Maintainer-Integration und Bau einer neuen
  sauberen Release-Runtime keine Live-Reparatur, keinen FTPS-Transfer und keine
  Portalmutation aus.

## Unreleased · Monotone Scheduler-Lease und abgeschlossener offener Lifecycle – 23. August 2026

### Report

- Die Ursache des `ENOENT listing-scheduler.lock` bei langen seriellen
  Produktionsläufen behoben. `runIfDue` trennt nun den festen
  Fälligkeit-/Startzeitpunkt von den laufenden Schrittzeitpunkten; spätere
  Lease-Erneuerungen verwenden Live-Zeit und können die Ablaufzeit niemals auf
  den Runstart zurücksetzen.
- Das persistente Leaseformat um Scheduler-Run, Owner-PID, Runtime-Identität,
  Revision und monotone Zeitfelder erweitert. Renewal schreibt atomar,
  Besitzverlust ist explizit fatal und parallele Stale-Recovery wird durch
  einen eigenen atomaren Recovery-Claim serialisiert.
- Stale-Übernahme und kontrollierte Bereinigung verlangen abgelaufene Lease,
  eindeutig inaktiven Owner, unveränderte Revision und einen persistent
  nachgewiesenen unterbrochenen oder terminalen Scheduler-Run. Unklare
  Prozessaktivität, unbekannter Runzustand und fehlender Owner-Lock bleiben
  fail-closed.
- Strukturiertes Lease-Audit sowie ein exaktes Wartungs-CLI für verwaiste
  Scheduler-Claims ergänzt. Das CLI verlangt Rotation und Production-DELETE
  auf `off` und bindet die Mutation an die vorab benannte Run-/Owner-Paarung.
- Einen einmaligen, hart auf den unterbrochenen Lifecycle
  `30460-261429 → 30460-918100` begrenzten Reconciliation-Vertrag ergänzt. Er
  beweist genau einen bestehenden Upload, verhindert jeden Doppelupload und
  jeden zweiten DELETE und finalisiert erst nach dem eindeutig positiven
  Immoprofessional-Bericht.
- Regressionstests decken 25 lange Lifecycle-Schritte, zurückdatierte
  Renewals, parallele Stale-Contender, aktive und unbekannte Owner,
  Lockverlust, exakten CLI-Vertrag, doppelte Uploadevidenz sowie idempotente
  Lifecycle-Finalisierung ab.

### Begründung

Der periodische Helper-Timer hatte einen noch laufenden Scheduler-Claim als
stale angesehen, weil der feste Startzeitpunkt bei späteren Item-Renewals die
Lease rückwärts verkürzte. Die Korrektur trennt fachliche Startzeit und
technische Fortschrittszeit und bindet jede Recovery zusätzlich an Prozess-,
Runtime-, Revisions- und Katalogevidenz. Dadurch bleibt Restart-Recovery
möglich, ohne einem parallelen Helper oder einer Zeitregression einen zweiten
Writer zu erlauben.

### Hürden und Risiken

- Dateisystemoperationen besitzen keinen nativen Compare-and-Swap für
  JSON-Dateien. Der separate atomare Recovery-Claim schließt deshalb das
  Cross-Process-Fenster zwischen Stale-Prüfung und Lease-Ersatz; sein Owner-PID
  wird bei einer verwaisten Recovery ebenfalls fail-closed geprüft.
- Der historische One-Shot bleibt `consumed` und wird nicht neu armiert. Die
  Reconciliation ist auf genau eine vorhandene Source-/Replacement-Kette
  kompiliert und kein allgemeiner Produktions- oder Bulkpfad.
- Rotation und globaler Production-DELETE blieben während der Bereinigung auf
  `off`. Der einmalig autorisierte DELETE wurde exakt einmal übertragen; erst
  der positive read-only Mailbericht finalisierte die Quelle. Der Ersatz blieb
  unverändert veröffentlicht.

## Unreleased · Monotone Lifecycle-Reconciliation – 22. August 2026

### Report

- Die Race Condition zwischen seriellem Lifecycle-Koordinator und periodischem
  Import-/DELETE-Recovery-Timer behoben. Der Koordinator rekonstruiert nun die
  höchste sicher belegte Stufe und akzeptiert bereits weiter fortgeschrittene
  Zustände, statt auf einen früheren, nicht mehr sichtbaren Zwischenzustand zu
  warten.
- Zentralisierte Evidenzprädikate für FTPS, positiven Import, DELETE-
  Autorisierung, übertragenen DELETE, positiven Löschbericht und final
  gelöschte Quelle ergänzt. Die Prüfung bindet weiterhin exakt Source,
  Replacement, Schedulerlauf, Uploadjob, Importbericht, DELETE-Job und
  Löschbericht zusammen.
- Persistierte Lifecycle-Stufen ausschließlich monoton aktualisiert. Kein
  bereits fortgeschrittener Katalogzustand wird zurückgesetzt; ein bestätigter
  oder übertragener DELETE wird nie erneut übertragen.
- Telemetrie um `observedStage`, `expectedStage`, `highestVerifiedStage`,
  `reconciledForward` und `reconciliationReason` ergänzt.
- Einen idempotenten, hart auf `30460-379797 → 30460-590537` begrenzten
  internen Reconciliation-Befehl ergänzt. Er verlangt alle Betriebsmodi auf
  `off`, einen konfliktfreien Katalog und vollständige vorhandene Evidenz und
  führt ausdrücklich null externe Mutationen aus.
- Regressionstests bilden den realen Timer-Race, `published`-ahead,
  `delete_transferred`-ahead, `deleted`-ahead, widersprüchliche Evidenz,
  Restart-Recovery, Persistenz nach bestätigtem DELETE und idempotente
  Reconciliation ab.

### Begründung

Importbericht- und DELETE-Recovery müssen auch nach Helper-Neustarts unabhängig
weiterarbeiten können. Deshalb bleiben beide Beobachter bestehen. Die sichere
Korrektur ist eine monotone Evidenzordnung: Ein späterer vollständig belegter
Zustand erfüllt frühere Lifecycle-Barrieren, ohne deren Sicherheitsnachweise zu
überspringen.

### Hürden und Risiken

- Ein bloßes `published` oder `deleted` genügt weiterhin nicht. Fehlende oder
  widersprüchliche Provenienz führt zu `LIFECYCLE_RECONCILIATION_REQUIRED` und
  sperrt die nächste Rotation.
- Upload- und DELETE-Einmaligkeit werden weiterhin durch bestehende Job-IDs,
  Claims, CAS und Ledgers erzwungen. Der Fix fügt keine alternative externe
  Mutation und keine allgemeine Bulk-Reconciliation hinzu.
- Während Implementierung, Tests und interner Reconciliation bleiben Rotation,
  Canary und Production-DELETE auf `off`; es wird kein neuer Produktionslauf
  gestartet.

## Unreleased · Serielle Produktions-Lifecycle-Barriere – 21. August 2026

### Report

- Den produktiven Background-Scheduler von einer uploadorientierten Schleife
  auf strikt serielle End-to-End-Ketten umgestellt. Jede Rotation wartet nach
  exakt einem FTPS-Auftrag auf den eindeutigen positiven Importbericht, den
  persistierten Handover, exakt einen Production-DELETE und den eindeutigen
  positiven Löschbericht. Erst `replacement published` plus `source deleted`
  erlaubt die nächste Katalogmutation.
- Einen persistent protokollierten Lifecycle-Koordinator mit den Stufen
  `awaiting_import_confirmation`, `post_import_pre_delete`,
  `awaiting_delete_confirmation` und `completed` ergänzt. Die vorhandenen
  Importbericht-, Uploadledger-, Production-DELETE-, DELETE-Ledger-, Claim-,
  Lease-, CAS- und Deduplizierungsverträge werden wiederverwendet.
- Asynchrone Prüfzyklen von fünf Minuten und getrennte fail-closed Zeitlimits
  von jeweils 30 Minuten für Import- und Löschbestätigung eingeführt. Offene
  Vorgängerketten, Mailfehler, Timeouts, Payload-/FTPS-Fehler oder unvollständige
  Abschlussbelege stoppen den gesamten Lauf vor der nächsten Rotation.
- Den zielgebundenen internen DELETE-Aufruf so erweitert, dass ein bereits
  übertragener exakter Job nur weiter geprüft und niemals ein zweites Mal
  übertragen wird. Das normale Dreierlimit und die provenance-gebundene
  One-Shot-Obergrenze bis 25 bleiben unverändert.
- Laufmetriken um gestartete und vollständig abgeschlossene Lifecycles,
  fehlgeschlagenen Lifecycle-Index, Gesamtdauer und Stufenprotokolle ergänzt.
  Canary bleibt weiterhin beim Zustand `transferred_pending_import` und nutzt
  die produktive automatische Löschkette nicht.

### Begründung

Ein erfolgreicher FTPS-Transfer beweist weder den Portalimport noch die externe
Löschung der alten Quelle. Die explizite Lifecycle-Barriere bindet deshalb jede
weitere produktive Mutation an beide positiven Providerberichte und an den
vollständig konsistenten Katalog-/Ledgerzustand. Die bestehenden spezialisierten
Dienste bleiben die einzigen Stellen für Mailauswertung, Upload und DELETE.

### Hürden und Risiken

- Providerantworten sind zeitlich verzögert. Das asynchrone Polling hält den
  Eventloop frei. Neun ausgewertete Importberichte lagen bei 0,844 Minuten
  Median und 1,265 Minuten Maximum; neun DELETE-Berichte bei 4,972 Minuten
  Median und 9,607 Minuten Maximum. Die 30-Minuten-Grenzen geben Reserve, ohne
  unbegrenzt zu warten. Bei Ablauf bleibt der reale Zwischenzustand unverändert
  und der nächste Schedulerlauf gesperrt.
- Ein Helper-Abbruch kann eine Kette zwischen Provideraktion und Bericht
  hinterlassen. Persistente Job-IDs, Ledgers und offene Lifecycle-Provenienz
  verhindern einen zweiten Transfer; der vorhandene Timer darf ausschließlich
  diese Kette reconciliieren, bevor neue Arbeit startet.
- Während Implementierung und Tests wurden weder Helper noch Scheduler,
  produktives FTPS, Production-DELETE oder Portalaktionen gestartet. Rotation
  und Production-DELETE blieben im produktiven System auf `off`.

## Unreleased · Produktionszeitfenster bis 21:00 – 21. August 2026

### Report

- Das reguläre Produktionszeitfenster dauerhaft von `08:00–18:00` auf
  `08:00–21:00 Europe/Berlin` erweitert. Bestehende persistierte
  `18:00`-Konfigurationen werden beim Laden auf den neuen Vertrag migriert;
  Standard und produktive Validierung verwenden anschließend `21:00`.
- Die Zeitfensterprüfung von der Rechnerzeitzone entkoppelt und ausdrücklich an
  `Europe/Berlin` gebunden. Grenztests decken Sommer- und Winterzeit sowie
  `07:59`, `08:00`, `17:59`, `18:00`, `19:00`, `20:00`, `20:59`, `21:00` und
  `21:01` ab.
- Zusätzlich zur Laufprüfung wird das Fenster unmittelbar vor jeder neuen
  Rotation erneut geprüft. Bis `21:00:59` darf eine neue Kette starten; ab
  `21:01` werden noch nicht begonnene Auswahlen freigegeben und mit eindeutigem
  Skip-Grund protokolliert. Eine bereits vorher sicher gestartete Kette darf
  ihre bestehenden FTPS-, Import- und DELETE-Bestätigungsstufen abschließen.
- Normaler Dreierlauf, Mindestabstand von einer Stunde, Daily-Plot-Guard,
  `detect-only`-Startup und der einmalige One-Shot mit maximal 25 Einträgen und
  60-Minuten-TTL bleiben unverändert. Der One-Shot erhält keinen Zeit-Bypass.

### Begründung

Eine reine Anpassung des Defaultwerts hätte laufende persistierte
`18:00`-Konfigurationen und bereits ausgewählte Mehrfachläufe nicht sicher
erfasst. Die Kombination aus verlustarmer Migration, expliziter Berliner
Zeitzone und erneuter Prüfung vor jedem Einzelstart stellt den fachlichen
Vertrag auch bei langen seriellen Läufen und Zeitzonenwechseln zuverlässig her.

### Hürden und Risiken

- Die Grenze folgt der bereits vorhandenen Minutensemantik: Die gesamte Minute
  `21:00` ist offen, `21:01` ist geschlossen. Dieser Vertrag ist nun explizit
  dokumentiert und getestet.
- Eine vor der Grenze gestartete Produktionskette wird nicht künstlich um
  21:00 Uhr abgebrochen. Alle nachgelagerten Stufen bleiben jedoch weiterhin an
  positive Berichte, Idempotenz, Claims, Leases, CAS und DELETE-Schutzgrenzen
  gebunden.
- Während Implementierung und Tests wurden weder Scheduler noch Helper, FTPS,
  Importbestätigung, Production-DELETE oder Portalaktionen produktiv gestartet.

## Unreleased · One-Shot-Produktionsbatch – 21. August 2026

### Report

- Einen persistenten Operatorvertrag für exakt einen Produktionsschedulerlauf
  mit einem ganzzahligen Limit von vier bis höchstens 25 ergänzt. Der normale
  Produktionsvertrag und seine Policy bleiben unverändert bei maximal drei.
- Override-ID, TTL, Runtime-Commit, atomarer Scheduler-Claim, Lauf-ID,
  Abschlusszählwerte und die Zustände `armed`, `claimed`, `consumed`,
  `cancelled` und `expired` werden auditierbar gespeichert. Status, Armieren und
  Abbruch eines noch nicht beanspruchten Overrides besitzen ein separates CLI.
- Schedulerkopien, Uploadübergabe und Production-DELETE tragen die exakte
  Override-/Scheduler-/Runtime-Provenienz. Nur der zugehörige Batch darf beim
  seriellen DELETE über drei hinausgehen; falsche IDs, anderer Schedulerlauf,
  andere Runtime oder mehr als 25 Ketten stoppen vor FTPS.
- Tests decken Grenzen `3/4/24/25/26`, konkurrierende Claims, TTL,
  Runtime-Mismatch, Startup/Preview, Erfolg mit 25, Abbruch nach sieben,
  Restart-Fortsetzung, automatischen Rückfall auf drei und provenance-gebundene
  25er-DELETEs ab.

### Begründung

Eine dauerhafte Erhöhung der Produktions-Policy würde jeden späteren Lauf und
auch den Löschdienst unbeabsichtigt erweitern. Der separate One-Shot-Datensatz
ist dagegen kurzlebig, commit-gebunden und wird vor der ersten Mutation exklusiv
einem Schedulerlauf zugeordnet. Dadurch ist die Ausnahme nach Erfolg, Fehler
oder Restart nicht wiederverwendbar, während vorhandene Idempotenz- und
Reconciliation-Pfade erhalten bleiben.

### Hürden und Risiken

- Ein harter Helper-Abbruch lässt den Override absichtlich `claimed`. Das ist
  fail-closed und erfordert für einen weiteren großen Batch eine neue, separat
  geprüfte Operatorfreigabe; es entsteht niemals automatisch ein zweiter Lauf.
- Bereits vorbereitete Batchkopien können unter dem normalen Dreierlimit
  fortgesetzt werden, müssen dabei aber weiterhin den ursprünglichen
  historischen Claim und Runtime-Commit nachweisen. Ein Runtime-Wechsel mit
  offenen Batchketten blockiert deren Upload-/DELETE-Fortsetzung deshalb
  absichtlich bis zur expliziten Reconciliation.
- Die Ausnahme umgeht weder Zeitfenster, Stundenabstand, Daily-Plot-Guard,
  Creative-Payload-Guard, positive Import-/Deleteberichte noch die Sperre bei
  unklaren Transfers. Vor der Maintainer-Integration wurde kein produktiver
  Scheduler-, FTPS- oder DELETE-Lauf ausgeführt.

## Unreleased · Creative-Payload- und Runtime-Provenienz-Guard – 21. August 2026

### Report

- Den Background-Upload so abgesichert, dass die persistierte Creative-Auswahl
  das tatsächlich erzeugte OpenImmo-ZIP bestimmt. Haus, hausabhängige Fakten,
  Kaufpreis, Texte, Bildsatz und führendes Hero-Asset werden unmittelbar vor
  FTPS gegen XML und ZIP-Inhalt geprüft; `CREATIVE_PAYLOAD_MISMATCH` stoppt vor
  Zugangsdaten- und Netzwerkzugriff.
- Aktionsheros im Background-Pfad aktivieren `promotionImageEnabled` nur für
  die konkret persistierte Aktion. Hausheros bleiben auf dem kuratierten
  Hausbildpfad; ein späterer SOL-242- oder anderer Standardhaus-Fallback ist
  bei gültiger Creative-Auswahl nicht zulässig.
- Isolierte Helper-Runtimes erhalten ein Manifest mit sauberem Source-Commit,
  Release-ID, Buildzeit und Code-Fingerprint. Die Produktions-Policy bindet
  `active` und `canary` an exakt diesen erwarteten Commit. Abweichungen sperren
  Scheduler und automatischen Upload fail-closed.
- Runtime-Provenienz, Helper-Startzeit und Prozess-ID sind über den geschützten
  Diagnosepfad sowie in Scheduler- und Uploadlogs nachvollziehbar. Tests decken
  House-/Action-Hero, tatsächlichen ZIP-Inhalt, Mismatch, Runtime-Mismatch,
  Restart-Persistenz und unveränderte Schedulerlimits ab.

### Begründung

Die drei realen SOL-242-Übertragungen vom 16. August 2026 liefen nachweislich
vor dem Creative-Commit vom 17. August. Persistierte Auswahl und Runtime-Commit
fehlten damals in den Laufzeitdaten. Der neue Vertrag beseitigt beide blinden
Flecken: Die Auswahl wird vor dem Upload fixiert und der reale Payload wird
gegen sie verifiziert; zugleich kann unbekannter oder älterer Helper-Code keine
automatische Rotation mehr ausführen.

### Hürden und Risiken

- Eine neue Runtime kann erst produktiv werden, nachdem ihr finaler Git-Commit
  ausdrücklich in der Produktions-Policy hinterlegt wurde. Fehlende, alte oder
  ungültige Policy-Dateien bleiben bewusst vollständig gesperrt.
- Der Guard prüft den erzeugten Uploadinhalt, ersetzt aber nicht die weiterhin
  erforderliche positive Immoprofessional-Importbestätigung. Production-DELETE
  und seine bestätigten Sicherheitsverträge wurden nicht verändert.

## Unreleased · Einmalige Pre-FTPS-Delete-Reconciliation – 20. August 2026

### Report

- Einen einmaligen Reconciliation-Pfad ergänzt, der ausschließlich das fest
  gebundene Triple `30460-462061` → `30460-131712` →
  `production-delete:338e05d2…` wieder auf genau einen normalen
  Production-DELETE-Versuch vorbereitet.
- Die Freigabe verlangt fehlende Transfer- und Berichtsbelege, den exakten
  lokalen Sidecar-Fehler, die nachgewiesene Code-Reihenfolge vor
  FTPS-Client-Erzeugung, einen read-only Mailgegencheck und beide globalen Modi
  auf `off`. Ledger- und Katalogmutation bleiben idempotent und auditierbar.
- Einen sessiongeschützten exakten Operatorlauf ergänzt, der ausschließlich die
  ausdrücklich freigegebenen Sources `30460-574320` und `30460-268065` über
  den unveränderten Production-DELETE-Service sequenziell verarbeiten kann.
  Rotation `off`, Delete-Modus `active`, freier Scheduler-Lock,
  `maxRunItems=1` und In-Process-Single-Flight sind zwingend.

### Begründung

Der persistente Claim-Marker wurde vor dem Aufruf des Uploadadapters gesetzt.
Der Adapter scheiterte anschließend beim Laden des Keychain-Sidecars, bevor ein
FTPS-Client entstehen konnte. Nur dieser technisch belegte Pre-Transfer-Fall
darf deshalb eng reconciliiert werden; der allgemeine Unsicherheitsvertrag
bleibt unverändert fail-closed.

Die zwei verbleibenden Sources besitzen denselben Autorisierungszeitpunkt. Ein
exakter Operatorlauf hält die gewünschte Reihenfolge ein, ohne fachliche
Zeitstempel umzuschreiben oder den allgemeinen Kandidatensortierer zu ändern.

### Hürden und Risiken

- Source, Replacement, Projekt, Listing-IDs, Job-ID, Payloadname, SHA-256,
  Größe und alte Runtime sind fest kompiliert. Jede Abweichung stoppt.
- Der Pfad führt selbst weder FTPS noch DELETE aus und ist an keinen Scheduler
  angeschlossen. Ein späterer Transfer erfolgt ausschließlich über den normalen
  Production-DELETE-Dienst.
- Der Operatorpfad erteilt keine neue Löschberechtigung und akzeptiert keine
  freie Objektnummer. Ohne alle bestehenden Produktionsguards oder bei einem
  parallelen Dienstlauf stoppt er fail-closed.

## Unreleased · Keychain-Sidecar in isolierter Helper-Runtime – 20. August 2026

### Report

- `macos-keychain.swift` als explizit allowlistete und zwingend erforderliche
  Supportdatei in die isolierte Helper-Runtime aufgenommen.
- Die Datei fließt in den Runtime-Fingerprint ein; ihr Fehlen stoppt das
  Staging fail-closed. Tests prüfen Kopie, Manifest und fehlende Sidecar.

### Begründung

`credential-vault.mjs` startet die Swift-Datei dynamisch und importiert sie
nicht als JavaScript-Modul. Die bisherige Modul-Sammlung konnte diese
Laufzeitabhängigkeit daher nicht erkennen. Ohne Sidecar konnte der Helper den
Keychain-Tresor bereits vor Aufbau einer FTPS-Verbindung nicht öffnen.

### Hürden und Risiken

- Die Supportdatei wird bewusst nicht über eine breite Dateiendungsregel
  eingesammelt, sondern exakt allowlistet. Dadurch gelangen keine fremden
  Skripte oder Arbeitsartefakte in die Runtime.

## Unreleased · Historische Delete-State-Reconciliation – 20. August 2026

### Report

- Einen fail-closed, exakt auf `30460-287191` begrenzten internen
  Reconciliation-Vertrag ergänzt. Er verwendet ausschließlich den bereits
  positiv bestätigten deterministischen Delete-Canary-Beleg und führt keine
  externe Aktion aus.
- Die Mutation verlangt Rotation und Production-DELETE auf `off`, einen freien
  Scheduler-Lock sowie das Fehlen von Reservations, Leases, Pending-Rotationen
  und offenen Upload-/Deletejobs. Danach sind Listing und Control konsistent
  `deleted` und automatische Aktualisierungen deaktiviert.

### Begründung

Der historische externe Delete-Canary war beim Provider bestätigt, sein alter
lokaler Veröffentlichungsstatus blieb jedoch schedulerfähig. Die enge
Reconciliation überträgt ausschließlich diesen vorhandenen Beleg in das
bestehende finale Statusmodell, ohne einen zweiten DELETE zu riskieren.

### Hürden und Risiken

- Objekt-, Projekt-, Listing-, Job- und Berichtidentität müssen gemeinsam
  stimmen; jede Abweichung stoppt fail-closed.
- Tests decken Zielbindung, Belegprüfung, Idempotenz, Scheduler-Ausschluss und
  alle relevanten Sperren ab. Der CLI-Pfad ist nicht an Helper oder Scheduler
  angeschlossen.

## Unreleased · Persistente Apple-Mail-Helper-Runtime – 17. August 2026

### Report

- Den lokalen Helper als einzelnen, persistenten Aqua-/Interactive-LaunchAgent
  mit isolierter, fingerprintierter Runtime bereitgestellt. Secrets, Tests,
  Arbeitsdaten und Git-Metadaten werden nicht in die Runtime kopiert.
- Die Apple-Mail-Ausführung von `execFile` auf einen kontrollierten
  `spawn`-Lebenszyklus mit begrenztem Buffer, `SIGTERM`, anschließendem
  `SIGKILL` und Warten auf das tatsächliche Prozessende umgestellt.
- Die read-only Ordnerabfrage auf höchstens 500 Nachrichten begrenzt und die
  Metadaten sequenziell gefiltert. Überschreitungen stoppen fail-closed.
- Adapter und Importberichtdienst gegen überlappende Mailabfragen mit
  Single-Flight abgesichert und Laufzeit, Timeoutklasse und Exit-Signal
  strukturiert protokolliert.
- Einen sessiongeschützten, ausdrücklich read-only Mail-Runtime-Probe ergänzt.
  Der reale Nachweis vor und nach einem kontrollierten Helper-Neustart ergab
  15 von 15 erfolgreiche Läufe bei null Mailmutationen.

### Begründung

macOS bindet die Automationserlaubnis an den konkreten Prozesskontext. Ein
persistenter Aqua-LaunchAgent mit stabiler Node-Runtime stellt diesen Kontext
reproduzierbar her. Begrenzte Abfragen, eindeutige Fehlerklassen und ein
vollständig kontrollierter Child-Prozess verhindern, dass Mail-Timeouts einen
weiteren Lauf blockieren oder fälschlich als Setupfehler erscheinen.

### Hürden und Risiken

- Die Freigabe `node → Mail` muss für die tatsächlich verwendete Node-Runtime
  bestehen. Fehlt sie, bleibt der Importpfad ohne Status- oder Mailmutation
  fail-closed.
- Der dedizierte Berichtordner darf höchstens 500 Nachrichten enthalten;
  größere Bestände müssen administrativ serverseitig bereinigt werden.
- Der Runtime-Probe prüft nur Erreichbarkeit und Kandidatenmetadaten. Er
  bestätigt keinen Import und liest keine Nachrichtentexte.

## Unreleased · Creative-Diversifizierung der Background-Rotation – 17. August 2026

### Report

- Die Haus- und Hero-Auswahl als getrennte deterministische Creative-Stufe in
  den bestehenden Rotationspfad integriert. Grundstücks- und globale LRU-
  Historien verhindern direkte Haus- und Bildserien, ohne Schedulerumfang oder
  Produktionsguards zu verändern.
- Jede vorbereitete Rotationskopie speichert Haus, Hero-Typ, Hero-ID,
  Aktionsbild-ID, Auswahlzeitpunkt, Begründungen und Diagnosen. Ein Restart
  übernimmt damit exakt dieselbe Creative-Entscheidung.
- Freigegebene zentrale Aktionsbilder werden in einem festen, nicht zufälligen
  Vierer-Takt gelegentlich als Hero verwendet. Inaktive, gesperrte,
  ungeeignete oder nicht automatisch freigegebene Motive bleiben ausgeschlossen.
- Der Background-Upload übernimmt das persistierte Hero und Aktionsbild in den
  OpenImmo-Export. Die deterministische Upload-Job-ID enthält die persistierte
  Aktionsbild-ID und bleibt damit deduplizierbar.
- Positive Importberichte schreiben die Haus- und Aktionsbildnutzung atomar und
  idempotent zurück. Eine doppelte Mail erzeugt weder einen zweiten fachlichen
  Nutzungsdatensatz noch einen neuen Rotationsentscheid.
- Eine rein lesende Vorschau-CLI für die nächsten zehn oder zwanzig fälligen
  Kandidaten ergänzt. Sie lädt den Katalog einmalig, simuliert ausschließlich
  im Speicher und besitzt keinen Store-Update- oder Uploadpfad.

### Begründung

Der Background-Pfad bestätigte neue Kopien bislang ohne den im manuellen
UI-Pfad vorhandenen Aufruf von `recordHouseRotation`. Dadurch blieb insbesondere
`SOL 242 V4` in der zentralen Statistik künstlich selten und gewann die
gewichtete Auswahl wiederholt. Zusätzlich deaktivierte der automatische Upload
Aktionsbilder hart. Die neue Stufe nutzt die bereits persistenten Listings als
kompatible Historie, fixiert die Entscheidung vor dem Upload und ergänzt die
fehlende Rückschreibung erst bei der positiven Importbestätigung.

### Hürden und Risiken

- Bestehende Häuser besitzen jeweils nur ein als `cover` markiertes Standard-
  Hero. Sichtbare Bildvariation entsteht deshalb aktuell überwiegend durch die
  Hausvariation und die sechs zentral freigegebenen Aktionsbilder. Weitere
  Hausperspektiven benötigen eine explizite Hero-Freigabe.
- Die Aktionsbildquote ist bewusst deterministisch und nicht zufällig. Sie ist
  eine nachvollziehbare Anti-Monotonie-Regel, keine garantierte Marketingquote.
- Während der Implementierung wurden weder Helper noch Scheduler gestartet und
  weder FTPS-, Mail-, Portal- noch DELETE-Aktionen ausgeführt. Die produktiven
  Betriebsmodi blieben `off`.

## Unreleased · Einmalige Legacy-Import-Reconciliation – 15. August 2026

### Report

- Einen separaten, hart auf `30460-652921` und `30460-056361` sowie deren
  konkrete Projekt-, Source-, Replacement- und Uploadjob-IDs begrenzten
  Reconciliation-Vertrag ergänzt.
- Aktuelle, manuell anhand der exakten externen Objektnummer bestätigte
  Providerexistenz, historisch eindeutiger FTPS-Transfer,
  konsistente Source-Replacement-Beziehung, fehlende Normalberichte und freie
  Claims werden vor jeder Katalogmutation gemeinsam geprüft.
- Die Provenance `legacy_provider_presence_verification` strikt vom normalen
  `import_report` getrennt. Es werden keine Message-ID, kein Report-Hash und
  kein Provider-Importzeitpunkt synthetisiert; der historische Transferzeitpunkt
  ist ausdrücklich als solcher gekennzeichnet.
- Die Benutzerbestätigung wird ausschließlich als
  `manual_immoprofessional_exact_object_number` durch
  `user_confirmed_provider_presence` protokolliert.
- Scheduler-Handover und Folgetermin verwenden dieselbe Logik wie eine normal
  bestätigte Kopie. Ein eigenes deterministisches Legacy-Deleteledger verhindert
  Überschneidungen mit dem regulären Active-Deletepfad und sperrt jeden Retry
  nach Transferbeginn.
- Tests für die 36 geforderten Eligibility-, Provenance-, Handover-, Delete-
  und Nicht-Aufweichungsbedingungen ergänzt. Normale Importberichte speichern
  künftig explizit `confirmationSource: import_report`; Altdaten ohne das Feld
  bleiben lesbar.
- Den letzten historischen Produktions-Delete `30460-032963` strikt an das
  bestätigte Replacement `30460-810978` im isolierten Einzel-Delete-Pfad
  gebunden. Deterministische Jobs protokollieren zusätzlich `createdAt` und das
  persistente `transportTarget`; Payload, Zielpfad und Jobidentität müssen vor
  FTPS byte- und feldgenau übereinstimmen.

### Begründung

Die zwei historischen Canarys entstanden vor dem maschinenlesbaren
Importberichtvertrag. Eine generalisierte Zeit- oder FTPS-Ausnahme würde die
heutige Sicherheitsgrenze aufweichen. Die explizite Identitäts-Allowlist und
der aktuelle Providerbestand schließen ausschließlich diese bekannte Altlast,
ohne einen wiederverwendbaren Bestätigungspfad für neue Uploads zu schaffen.

### Hürden und Risiken

- Die Reconciliation darf erst nach einer neuen exakten Providerprüfung real
  ausgeführt werden. Ohne sicheren read-only Zugriff bleibt sie gesperrt.
- Historisch nicht persistierte Bildanzahl- oder Hashwerte werden nicht
  nachträglich erfunden.
- Ein Delete-Transfer bestätigt keine Löschung. Die alte Quelle bleibt bis zum
  positiven exakten Löschbericht veröffentlicht und wird nicht erneut gesendet.

### Kontrollierte Produktionsdurchführung

- Am 15. August 2026 wurden die beiden allowlisteten Fälle strikt sequenziell
  reconciliiert. Die Replacements `30460-652921` und `30460-056361` sind
  `published`; die Quellen `30460-095107` und `30460-028212` wurden jeweils
  nach genau einem DELETE-Transfer und einem eindeutigen positiven Bericht als
  `deleted` finalisiert.
- Es erfolgte kein erneuter Replacement-Upload, kein Rotationslauf und keine
  Mailmutation. Rotations- und Produktions-Delete-Modus blieben durchgehend
  gültig `off`.
- Der letzte vorher vorhandene Readiness-Blocker `30460-032963` wurde danach
  mit genau einem fest gebundenen DELETE-Paket übertragen und erst nach dem
  eindeutigen positiven Providerbericht als `deleted` finalisiert. Das
  Replacement `30460-810978` blieb bytegleich `published`; es gab keinen
  Replacement-Upload, keine Rotation und keine Mailmutation.

## 0.19.0 · Kontrollierter Active-Rollout – 14. August 2026

### Report

- Eine persistente Produktions-Policy ergänzt. `active` ist nur mit gültigem
  `maxRunItems` von eins bis höchstens drei zulässig; fehlende, beschädigte
  oder unbekannte Werte sperren Rotation und Upload fail-closed.
- Startup-Catch-up in `detect-only` und `guarded` getrennt. Der sichere
  Erststart erkennt ausschließlich Fälligkeiten. `guarded` verwendet später
  denselben regulären Zeit-, Abstands-, Claim-, Tages- und Daily-Plot-Vertrag
  wie ein normaler Schedulerlauf und besitzt keinen Unlimited-Catch-up.
- Die maximale Run-Reichweite umfasst neue Selektionen und fortzusetzende
  Kopien gemeinsam. Drei unterschiedliche Grundstücke bleiben durch
  Adresslimit und persistenten Daily-Plot-Guard gesichert.
- Offene Löschberichte und neue Löschtransfers teilen sich ebenfalls dasselbe
  persistente Dreierbudget. Unterbrochene oder unklare Deletejobs sperren jeden
  weiteren externen Löschtransfer bis zur manuellen Klärung.
- Nur im neuen Produktionslauf markierte Rotationskopien dürfen nach einem
  eindeutig positiven Importbericht eine Delete-Autorisierung an die alte
  Quelle übergeben. Historische `externalDeletionPending`-Quellen werden nicht
  nachträglich in den Deletepfad aufgenommen.
- Einen separaten fail-closed Produktions-Delete-Modus, ein atomar gesperrtes
  idempotentes Ledger, deterministische Job-IDs und strikt sequenzielle
  Einzelobjekt-DELETE-Transfers ergänzt.
- Die alte Quelle bleibt bis zu einem exakten positiven Löschbericht
  `published`. Transferfehler oder unklare Zustände werden nie automatisch
  wiederholt; das bestätigte Replacement bleibt unverändert.
- Read-only Apple-Mail-Verarbeitung, strikte Anbieter-/SPF-/Objektnummer-
  Zuordnung und Import-/Löschbericht-Deduplizierung unverändert beibehalten.

### Begründung

Ein globaler Modus allein begrenzt die Menge eines zulässigen `active`-Laufs
nicht. Die zusätzliche persistente Policy schließt diese Lücke auch nach einem
Helper-Neustart. Die Löschung wird nicht aus einem Katalogstatus abgeleitet,
sondern aus einer beim konkreten Produktionslauf gespeicherten
Lifecycle-Autorisierung und zwei getrennten positiven Providerberichten.

### Hürden und Risiken

- FTPS bestätigt nur den Dateitransfer, niemals Import oder Löschung. Beide
  Folgezustände bleiben bis zum jeweiligen Originalbericht offen.
- Ein Transferabbruch nach Start ist nicht sicher wiederholbar und wird daher
  als unklarer Zustand dauerhaft blockiert.
- Apple Mail und Immoprofessional bleiben externe asynchrone Abhängigkeiten.
  Nicht erreichbare oder unbekannte Berichtsformate stoppen die Kette
  fail-closed und verändern die veröffentlichte Quelle nicht.
- Der Produktionsmodus ist standardmäßig `off`; ein Release- oder Helperstart
  allein führt deshalb keine Portalmutation aus.

## Unreleased · Apple-Mail-Timeout und Live-Canary-Recovery – 14. August 2026

### Report

- Die Apple-Mail-Fehlerklassifizierung auf einen strukturierten
  `FPI_OK`-/`FPI_ERROR`-Prozessvertrag umgestellt. Setupfehler werden nur noch
  aus der tatsächlich ausgegebenen Adapterantwort abgeleitet, nicht aus dem in
  Node-Fehlermeldungen eingebetteten AppleScript-Quelltext.
- Prozess-/AppleEvent-Timeout, nicht verfügbare Automation, explizite
  macOS-Berechtigungsverweigerung, Setupfehler und Parserfehler in getrennte
  fail-closed Fehlercodes überführt.
- Die verschachtelte AppleScript-Auflösung der Mailbox-Account-ID explizit
  geklammert. Damit kompiliert der read-only Account-Guard zuverlässig und
  weist einen Ordner unter einem abweichenden Account weiterhin fail-closed ab.
- Alle drei read-only Mail-Skripte adressieren Mail über die stabile Bundle-ID
  `com.apple.mail`. Damit bleibt die AppleScript-Terminologie unabhängig von
  lokalisierter oder fehlerhafter App-Namensauflösung verfügbar.
- Recoverytests ergänzt: Ein Timeout lässt bestehende
  `transferred_pending_import`-Kopien und Uploadjobs unverändert; ein späterer
  positiver Bericht bestätigt denselben Job genau einmal und übergibt die
  Scheduler-Verantwortung idempotent.
- Den Daily-Guard-Test um den konkreten Tageswechsel 13.08. → 14.08. erweitert.
  Der historische Transferbeleg bleibt unverändert, während ein neuer Tag
  einen eigenen stabilen Guard-Key erhält.

### Begründung

Node kann bei einem `osascript`-Timeout den vollständigen Prozessaufruf samt
Script in `error.message` einbetten. Eine freie Stringsuche verwechselte dadurch
im Script deklarierte Sentinelwerte mit real ausgegebenen Setupfehlern. Der
strukturierte stdout-Vertrag und die vorgelagerte Prozessklassifizierung
trennen Transport- und Fachfehler eindeutig.

### Hürden und Risiken

- Ein Apple-Mail-Timeout beweist weder einen fehlenden Account noch einen
  fehlenden Serverordner. Die Recovery bleibt deshalb ohne positiven Bericht
  vollständig gesperrt.
- Mail.app wird nicht automatisch beendet oder neu gestartet. Bleibt der
  bounded Minimaltest ohne Antwort, ist ein kontrollierter Nutzerneustart
  erforderlich.
- Diese Korrektur erlaubt weder einen erneuten Upload der bestehenden Kopie
  noch eine Importbestätigung aus FTPS-Erfolg oder Zeitablauf.

## Unreleased · Begrenzte vollständige 3er-Inseratrotation – 13. August 2026

### Report

- Einen zentralen persistenten Daily-Plot-Guard für alle produktiven
  Listing-Uploadpfade ergänzt. Pro stabiler `plotId` und
  `Europe/Berlin`-Kalendertag ist höchstens ein erfolgreicher oder nach
  Transferbeginn unklarer FTPS-Vorgang zulässig.
- Die Daily-Evidenz aus Katalog, `lastUploadedAt`, Rotationshistorie,
  bestätigten Importen und Uploadledger zusammengeführt. Rein vorbereitete,
  sicher unübertragene Jobs geben den Tag frei; unklare Transfers blockieren
  mit `PLOT_DAILY_UPLOAD_LIMIT_REACHED` fail-closed.
- Eine read-only Kandidatenauswahl nach ältestem effektivem externem
  Veröffentlichungszeitpunkt ergänzt. Sie verlangt exakt drei fällige,
  vollständig eligible Listings auf drei unterschiedlichen, heute unbenutzten
  Grundstücken und validiert die erwarteten Pakete ohne Upload.
- Einen strikt einmaligen manuellen Rotationsrunner ergänzt. Er akzeptiert nur
  eines von drei fest vorab bestimmten Source-/Replacement-Paaren, verwendet
  den Zeitfenster-Override ausschließlich im aktuellen Prozess und setzt den
  globalen Modus in jedem Abschluss- und Fehlerpfad wieder auf `off`.
- Die Importberichtprüfung für den Livetest auf exakt eine neue externe
  Objektnummer begrenzt. Andere offene Imports und ihre Mails bleiben
  unverändert.
- Den real bewiesenen OpenImmo-DELETE-Vertrag in einem separaten,
  fest allowlisteten 3er-Testpfad wiederverwendet. DELETE ist erst nach
  positiver Importbestätigung und Scheduler-Handover möglich, zielt hart auf
  die alte Objektnummer und wird nach Transfer nie automatisch wiederholt.
- Einen vorbereiteten Live-Canary-Deletejob an seinen persistenten
  Payload-Zeitpunkt gebunden. Wiederholte Preflight-/Transferaufrufe müssen
  Dateiname, SHA-256 und Paketgröße exakt reproduzieren und stoppen bei jeder
  Abweichung vor FTPS fail-closed.
- Eine bounded read-only Löschberichtsuche in genau
  `Livinghaus / Inseratestudio – Importberichte` und
  `Livinghaus / Posteingang` ergänzt. Ein eindeutiger positiver Bericht genügt;
  zusätzliche Berichte werden nur als idempotente Evidenz gespeichert.
- Die 30 geforderten Daily-, Import-before-delete-, Source-/Replacement-,
  Restart-, Idempotenz- und Katalogintegritätsszenarien sowie zusätzliche
  Modus- und Randfalltests ergänzt.

### Begründung

Die fachliche Grundstücksgrenze muss oberhalb einzelner Scheduler- und
UI-Pfade liegen. Ein persistenter atomarer Guard mit stabiler `plotId` verhindert
auch nach Neustart doppelte Tagesuploads. Die externe Löschung bleibt bewusst
ein enges Canary-Werkzeug: Import und DELETE werden getrennt bestätigt, und
keine Beobachtung wird aus bloßem FTPS-Erfolg oder Zeitablauf abgeleitet.

### Hürden und Risiken

- Ein Transferabbruch nach FTPS-Start ist nicht sicher als „nicht übertragen“
  beweisbar und verbraucht deshalb den Tag fail-closed.
- Apple Mail stellt Löschbestätigungen in zwei beobachteten Ordnern bereit; der
  begrenzte Adapter liest beide, verändert aber weder Nachrichten noch Ordner.
- Die drei Source-/Replacement-Zuordnungen sind absichtlich statisch. Jede
  weitere Objektnummer erfordert einen neuen read-only Preflight und darf nicht
  stillschweigend in diesen Canary aufgenommen werden.
- Der reale 3er-Produktionsnachweis und seine Resultate werden erst nach
  vollständig grüner lokaler Qualitätsprüfung dokumentiert. Daraus folgt auch
  bei Erfolg keine Freigabe von `active` oder einer allgemeinen Löschautomation.

## Unreleased · Reale Immoprofessional-Delete-Bestätigung – 13. August 2026

### Report

- Genau einen ausdrücklich autorisierten OpenImmo-DELETE-Canary für
  `30460-287191` über den bestehenden expliziten FTPS-Kanal übertragen: ein
  Objekt, ein DELETE, 794 Bytes, kein Retry und keine weitere externe Mutation.
- Den separaten Delete-Modus unmittelbar danach auf `off` zurückgesetzt; ein
  `active`-Modus, Batch-Delete, Scheduleranschluss oder automatische
  Altinseratlöschung wurde nicht ergänzt.
- Den echten Immoprofessional-Löschbericht im read-only Berichtordner
  beweisgesichert und einen engen Einzelobjektparser ergänzt. Bestätigt wird nur
  bei gültigem server22-Transport, `SPF=pass`, exakter Anbieter-/Senderkennung,
  Objektanzahl eins, exakter Nummer `30460-287191`, eindeutigem Status
  `Erfolgreich gelöscht` und konsistenten Börsen-Löschzeilen.
- Eine zusätzliche Immowelt-Nachricht read-only verifiziert: ein gelöschtes
  Objekt, Referenz `30460-287191`, Status `gelöscht`. Die vom Nutzer bestätigte
  Kleinanzeigen-Quittung und die anschließende manuelle read-only
  Immoprofessional-Portalkontrolle als zusätzliche, klar gekennzeichnete
  Evidenz dokumentiert.
- Den eigenen Delete-Job idempotent von `delete_pending_confirmation` auf
  `delete_confirmed` überführbar gemacht. Message-ID und Raw-Hash binden den
  Beleg; ein abweichender Zweitbericht stoppt als Konflikt.
- Synthetische Parser-, Ziel-, Transport-, Warnungs-, Fehler-, Deduplizierungs-
  und CLI-Tests ergänzt. Die echte `.eml` bleibt außerhalb des Repositories.

### Begründung

Der reale Providerbericht bestätigt erstmals den konkreten
Immoprofessional-Vertrag aus `TEIL` + `modus="DELETE"` + objektbezogenem
`aktionart="DELETE"`. Die Bestätigung bleibt absichtlich vom FTPS-Erfolg
getrennt und ist an genau einen bereits übertragenen Canary-Job gebunden.

### Hürden und Risiken

- Apple Mail lieferte im beweisgesicherten Raw-Quelltext die Umlaute der
  Löschzeilen doppelt UTF-8-kodiert. Der Parser normalisiert ausschließlich die
  real beobachteten Sequenzen vor der weiterhin exakten Statusprüfung.
- Eine read-only Portalbestätigung war mangels autorisierter Sitzung nicht
  möglich. Es wurde weder ein Login noch eine Portalaktion versucht.
- Der bestätigte Einzelvertrag darf nicht als Freigabe einer allgemeinen
  Löschautomation ausgelegt werden. Eligibility und Source-/Replacement-
  Vertrag für einen späteren Produktionspfad bleiben ein separater Auftrag.

## Unreleased · Immoprofessional Delete Contract Discovery – 13. August 2026

### Report

- Den vorhandenen OpenImmo-, FTPS-, Uploadledger-, Rotations-, Katalog- und
  Importbestätigungspfad vollständig auf Delete-Fähigkeiten geprüft, ohne eine
  externe oder lokale Fachmutation auszuführen.
- Belegt, dass der OpenImmo-1.2.7d-Standard einen objektbezogenen
  `aktionart="DELETE"`-Wert kennt. Für den konkret verwendeten
  Immoprofessional-Importer fehlen weiterhin ein bestätigter Delete-Payload und
  ein positiver Lösch-Rückkanal.
- Den einmalig zulässigen FTPS-Check strikt auf Connect/PWD/LIST begrenzt. Das
  konfigurierte Root-Verzeichnis war leer; es gab keinen Upload, Move, Rename,
  Mkdir oder Delete.
- Die zukünftige Jobidentität, Eligibility, Source-/Replacement-Hard-Guards,
  Idempotenz, Claim-/CAS-Abfolge, Statusmaschine und einen 28-teiligen
  Sicherheitstestplan in `IMMOPROFESSIONAL_DELETE_CONTRACT.md` dokumentiert.
- `30460-032963 → 30460-810978` read-only als fachlich geeigneten zukünftigen
  Einzel-Canary bewertet. Diese Bewertung ist keine Ausführungsfreigabe;
  automatische Löschung und `automaticDeletionEnabled` bleiben deaktiviert.

### Begründung

Der allgemeine OpenImmo-Standard beweist nicht automatisch die Unterstützung
desselben Delete-Vertrags durch einen konkreten Importer. Ebenso darf ein
Transporterfolg niemals als erfolgreiche Providerlöschung gelten. Die
Discovery trennt deshalb Standard, Immoprofessional-Akzeptanz und fachliche
Bestätigung und stoppt bis zu einem belastbaren Providerbeleg fail-closed.

### Hürden und Risiken

- Die öffentliche Immoprofessional-Dokumentation bestätigt OpenImmo-Importe und
  Änderungen, beschreibt aber weder Delete-Payload noch Löschbericht.
- Der aktuelle CHANGE-Export wird produktiv akzeptiert, weicht jedoch in
  einzelnen Verwaltungsfeldern vom offiziellen OpenImmo-1.2.7d-Schema ab. Diese
  Provider-Toleranz darf nicht auf DELETE extrapoliert werden.
- Das leere FTPS-Verzeichnis beweist weder Unterstützung noch Nichtunterstützung
  von Delete. Ohne positive, objektbezogene Providerbestätigung bleibt die
  Abschlussentscheidung `DELETE_CONTRACT_NEEDS_MORE_PROVIDER_INFORMATION`.

## Unreleased · Read-only Importberichtordner – 13. August 2026

### Report

- Den produktiven Importberichtpfad vom direkten Livinghaus-Posteingang auf den
  serverseitig durch Outlook/Exchange gepflegten Ordner
  `Inseratestudio – Importberichte` umgestellt. Ein automatischer Inbox-Fallback
  wurde ausdrücklich nicht ergänzt.
- Die Account- und Ordnerauflösung fail-closed gehärtet: genau ein Account
  `Livinghaus`, genau ein gleichnamiger Ordner in dessen Accounthierarchie und
  stabile Account-ID. Der Exchange-Accounttyp `unknown` ist allein kein
  Fehlergrund; lokale oder fremde gleichnamige Ordner werden nicht verwendet.
- Sämtliche Mailmutationen aus dem Produktionspfad entfernt. Der Adapter bietet
  ausschließlich Setup-Prüfung, Kandidatensuche und Raw-Mail-Lesen; weder Move,
  Delete, Copy, Read/Unread, Flag, Kategorie, Ordneranlage noch Rename sind
  implementiert.
- Neue erfolgreiche Belege direkt mit `processingStatus: confirmed` abgelegt.
  Historische `confirmed_mail_move_pending`, `confirmed_mail_moved` und
  `mail_move_*`-Zustände bleiben ohne Migration lesbar und lösen keine
  Mailaktion oder Blockade neuer Imports aus.
- Die bestehende strikte Immoprofessional-Validierung, Message-ID-/Raw-Hash-
  Deduplizierung, Uploadledger-Zuordnung und atomare Katalog-CAS-Bestätigung
  unverändert erhalten. Die alte Quelle bleibt extern veröffentlicht und als
  „Ersetzt – externe Löschung ausstehend“ markiert; es gibt weiterhin keinen
  DELETE-, Archivierungs- oder Portal-Löschpfad.
- UI und Betriebsdokumentation auf **Import bestätigt** beziehungsweise
  **Importbericht-Ordner nicht verfügbar** umgestellt. Der Helper prüft beim
  Start und danach moderat alle fünf Minuten, berührt Apple Mail aber nur bei
  mindestens einer offenen `transferred_pending_import`-Kopie.

### Begründung

Eine serverseitige Exchange-Regel ist für die dauerhafte Ablage zuverlässiger
als ein lokaler Apple-Mail-Move. Die klare Verantwortungstrennung reduziert die
lokalen Berechtigungen auf Lesen: Exchange sortiert, das Inseratestudio
validiert und bestätigt. Die direkte Account-/Ordnerbindung verhindert, dass
ein gleichnamiger lokaler Ordner oder ein fremdes Konto versehentlich als
Vertrauensgrenze verwendet wird.

### Hürden und Risiken

- Die Outlook-/Exchange-Regel wird außerhalb des Inseratestudios verwaltet. Ein
  Regel- oder Synchronisationsfehler bleibt sichtbar als ausstehende
  Importbestätigung; die Anwendung verändert weder Regel noch Mailablage.
- Apple Mail muss den serverseitigen Ordner und dessen Raw-Nachrichten unter
  macOS zuverlässig read-only bereitstellen. Der abschließende Realtest
  entscheidet, ob diese Transportebene produktionsreif ist oder separat eine
  serverseitige Read-only-API bewertet werden muss.
- Historische Mail-Move-Diagnosezustände bleiben bewusst unverändert. Eine
  riskante Katalogmigration und jeder erneute Move alter Berichte wurden
  ausgeschlossen.

### Tests

- Synthetische Account-/Ordner-, Read-only-, Parser-, Matching-, CAS-,
  Deduplizierungs-, Restart- und Scheduler-Handovertests; keine produktive
  `.eml`, keine Zugangsdaten und keine Mail-, FTPS- oder Portalmutation.

## Unreleased · Immoprofessional-Importbestätigung aus Livinghaus-Mail – 13. August 2026

### Report

- Einen abgegrenzten lokalen Apple-Mail-Adapter für den eindeutig aufgelösten
  Account `Livinghaus`, dessen eindeutigen direkten Posteingang (`Posteingang`
  oder `INBOX`) und den serverseitigen Ordner `Inseratestudio – Importberichte`
  ergänzt. Es werden weder neue Mailzugänge noch Graph-, IMAP-, OAuth- oder
  Cloud-Dienste eingeführt.
- Den realen Multipart-Bericht strikt nach Headertransport, `SPF=pass`,
  Plaintext-vor-HTML, Sendersoftware, Einzelobjektanzahl, Anbieter-ID,
  Importzeitpunkt und exakter Erfolgszeile geparst. Unbekannte Fehler- und
  Batchformate bleiben geschlossen.
- Die Objektnummer gegen genau eine `transferred_pending_import`-Kopie, deren
  Quelle, Katalogbeleg und deterministischen abgeschlossenen Uploadjob geprüft.
  Reportbeleg, `published`-Übergang und Scheduler-Handover werden atomar über
  den vorhandenen Katalog-CAS gespeichert.
- Die alte Quelle bleibt tatsächlich `published`, rotiert intern nicht erneut
  und erhält persistente Replacement-Metadaten sowie den Hinweis „Ersetzt –
  externe Löschung ausstehend“. Kein DELETE-, Archivierungs- oder
  Portal-Löschpfad wurde ergänzt.
- Message-ID und SHA-256 des relevanten Raw-Inhalts deduplizieren den Vorgang.
  Die einzelne Mail wird erst nach erfolgreicher Katalogpersistenz verschoben;
  ein unterbrochener Mail-Move wird nach Helper-Neustart idempotent nachgeholt.
- Den Background-Helper um einen bedingten Fünf-Minuten-Check ergänzt. Apple
  Mail wird ausschließlich bei offenen Importen angesprochen; ohne Pending-
  Kopie erfolgt kein Postfachscan.
- UI-Hinweise für bestätigte Kopien, ersetzte Quellen und prüfpflichtige
  Berichte sowie synthetische Parser-, Matching-, Mail-, CAS-, Restart-,
  Deduplizierungs- und Scheduler-Handovertests ergänzt.
- Explizite Scheduler-Test-/Laufzeitpunkte werden nun auch für alle internen
  Verarbeitungsschritte verwendet. Dadurch bleibt der Tagesabstand bei
  Wiederholungsläufen deterministisch und ein identischer Lauf erzeugt keinen
  zweiten Upload nur wegen einer abweichenden Systemuhr.

### Begründung

Die externe Objektnummer ist der kollisionsgeprüfte fachliche Schlüssel zwischen
OpenImmo-Paket, Uploadledger und Importbericht. Das katalogweite CAS ist der
kleinste vorhandene atomare Speicherort für Reportbeleg und Zustandsübergabe.
Apple Mail nutzt die bereits eingerichtete lokale Kontositzung, ohne zusätzliche
Secrets zu erzeugen. Zusätzliche Replacement-Metadaten bewahren die korrekte
Wahrheit, dass die alte Quelle extern noch veröffentlicht ist.

### Hürden und Risiken

- Das reale Fehler- und Batchberichtformat ist nicht bekannt und wird deshalb
  bewusst nicht geraten.
- Apple-Mail-Automation kann eine einmalige macOS-Berechtigung benötigen; eine
  fehlende oder mehrdeutige Konto-/Ordnerauflösung stoppt fail-closed.
- Eine künftige Änderung von Betreff, MIME-Struktur, Sendersoftware oder
  Erfolgszeile verlangt eine neue reale Prüfung.
- Die Basisrevision enthielt einen nicht aufgelösten leeren FTPS-Benutzernamen-
  Export und eine React-Lint-Vorwärtsreferenz. Beide wurden ohne eingebettete
  Zugangsdaten minimal bereinigt, damit TypeScript und ESLint reproduzierbar
  laufen.

### Tests

- Synthetische, anonymisierte Multipart-EML; keine produktive E-Mail im
  Repository und keine echten Zugangsdaten in Fixtures.
- Parser-, Transport-, Matching-, Uploadledger-, Idempotenz-, Mailmove-,
  Katalogfehler-, Helper-Restart- und Scheduler-Handoverprüfungen ohne Mail-,
  FTPS- oder Portalzugriff.

## Unreleased · Persistente automatische Inseratrotation – 12. August 2026

### Report

- Den automatischen Inserat-Scheduler aus dem Browser-`useEffect` in den
  persistenten lokalen Background-Helper verlegt. Der Helper führt beim Start
  einen Catch-up-Lauf aus und prüft danach seinen Zeitplan unabhängig von einer
  geöffneten Browserseite.
- Die automatische Reichweite verwendet alle aktiven verwalteten Inserate mit
  eingeschalteter automatischer Aktualisierung. `selectedPlotIds` bleibt
  ausschließlich UI-/Arbeitsauswahl für manuelle Abläufe.
- Einen persistenten, während langer Läufe token-geprüft erneuerten
  Scheduler-Claim mit Ablaufzeit und Crash-Recovery sowie
  vollständige strukturierte Laufprotokolle für Start, Ende, Fälligkeit,
  Auswahl, Fortsetzung, Überspringen, Fehler und Abbruchgrund ergänzt.
- Den Rotationsablauf auf `scheduled → processing → prepared →
  transferred_pending_import → published` bereinigt. `published` wird nur
  durch eine explizite Importbestätigung gesetzt; ein FTPS-Transfer allein
  bleibt „Importbestätigung ausstehend“.
- Rotationskopien erhalten weiterhin kollisionsgeprüfte neue Objektnummern.
  Uploadaufträge verwenden die vorhandene deterministische Job-ID,
  Job-Deduplizierung und Lease-Logik.
- Externe und automatische Löschung bleiben deaktiviert. Weder FTPS-Fehler
  noch Helper-Abbruch oder unklarer Importzustand archivieren oder verändern
  das alte veröffentlichte Inserat.
- Einen persistenten globalen Betriebsmodus `off | canary | active` ergänzt.
  Fehlende, beschädigte und unbekannte Konfigurationen fallen geschlossen auf
  `off` zurück; dies gilt auch für Startup-Catch-up und wiederaufzunehmende
  vorbereitete Rotationen.
- Im Canary-Modus werden nur explizit konfigurierte interne Listing-IDs oder
  externe Objektnummern verarbeitet. Weitere fällige Inserate werden mit
  eindeutigem Skip-Grund protokolliert.
- Ein separates lokales CLI für Status und explizite Moduswechsel ergänzt. Das
  CLI startet keinen Helper und löst selbst keinen Upload aus.
- Integrationsprüfungen für leere UI-Auswahl, Betrieb ohne Browser,
  Helper-Neustart, Catch-up, identische Wiederholung, eindeutige
  Objektnummern, mehrere Fälligkeiten, FTPS-Fehler, Jobabbruch, persistenten
  Lock und ausgeschlossene externe Löschung ergänzt.

### Begründung

Ein Browser-Effekt ist kein zuverlässiger Scheduler: Er existiert nur bei
geöffneter Seite und koppelt fachliche Automatik irrtümlich an UI-Zustand. Der
lokale Helper besitzt bereits die persistente Katalog-, Upload-, Credential-
und FTPS-Infrastruktur und ist daher der kleinste belastbare Ausführungsort.
Fälligkeit bleibt dynamisch berechnet, damit veröffentlichte Altdaten nicht
allein durch Zeitablauf in einen migrationsanfälligen `due`-Status umgeschrieben
werden. Der explizite Zwischenstatus trennt Transporterfolg sauber von einer
noch nicht bestätigten Veröffentlichung.

### Hürden und Risiken

- Immoprofessional liefert im vorhandenen Workflow noch keinen automatisch
  zurücklesbaren, belastbaren Importstatus. Erfolgreiche Transfers bleiben
  deshalb absichtlich `transferred_pending_import`, bis ein eindeutig
  zugeordnetes `import-confirmed`-Ereignis vorliegt.
- Der Helper schreibt Scheduler-Zustände über katalogweite Compare-and-swap-
  Snapshots. Konflikte werden wiederholt; ein dauerhafter konkurrierender
  Schreiber führt geschlossen zum Abbruch und wird protokolliert.
- Ein produktiver FTPS-Test und jede Portalaktion wurden bewusst ausgelassen.
  Die Tests verwenden ausschließlich lokale Zustände und injizierte
  Uploadadapter.
- Die persistente Modusdatei wird absichtlich nicht automatisch auf `active`
  migriert. Vor dem ersten Helper-Neustart bleibt der produktive Fallback
  dadurch `off`.
- Keine bestehende Sicherheits-, Lock-, Deduplizierungs- oder
  Katalogmigrationslogik wurde gelockert. Es gibt weiterhin keinen
  automatischen `DELETE`-Pfad.

### Tests

- TypeScript-Prüfung mit lokal installiertem Compiler.
- Scheduler-, Status-, Lock-, Restart-, Deduplizierungs-, Batch- und
  Workflow-Integrationstests lokal ohne Netzwerk- oder Portalzugriff.
- Betriebsmodus-Tests für fehlende, beschädigte und unbekannte Konfiguration,
  Startup-Catch-up bei `off`, selektive Canary-Verarbeitung, Helper-Neustart
  im Canary-Modus und den Wechsel `canary → active`.

## Version 0.18.0 · Grundstücksauswahl als zentraler Workflow-Einstieg – 25. Juli 2026

### Report

- Die Navigation auf fünf eindeutige Bereiche reduziert: **Grundstücke &
  Auswahl**, **Haustypen**, **Texte & Vorschau**, **Inseratsmanager** und
  **Export & Upload**. Der frühere sichtbare Projektierungsschritt samt seiner
  doppelten Grundstücksauswahl wurde entfernt.
- Grundstücksverwaltung, Excel-/PDF-Import, Exposé-Verwaltung und persistierte
  Mehrfachauswahl in einer regional gruppierten Liste zusammengeführt. Jeder
  Eintrag zeigt Adresse, Fläche, Kaufpreis, letztes Plattform-Uploaddatum,
  Inseratsanzahl und die unveränderte neutrale/gelbe/grüne Statuslogik.
- Den gemeinsamen Hauspool und die vorhandene gewichtete Vierer-Rotation direkt
  unter die zentrale Auswahl verschoben. Nachgelagerte Text-, Manager-,
  Scheduler- und Upload-Funktionen verwenden ausschließlich dieselben
  Grundstücks-IDs.
- Sämtliche Textfunktionen einschließlich Überschrift, Kurz-/Langtext,
  Lagefakten, festen Textbausteinen, Energieangaben, KI-Erzeugung und
  Portalvorschau im dritten Schritt gebündelt.
- Die Hausbibliothek alphabetisch sortiert. Den Inseratsmanager um optionale
  Gruppierung je Grundstück sowie Sortierung nach Ort, Upload, letzter und
  nächster Aktualisierung, Health Score und Status ergänzt.

### Begründung

`StudioState.selectedPlotIds` ist jetzt die persistierte, kanonische Auswahl.
Interne Arbeitsstände bleiben aus Kompatibilitätsgründen erhalten, werden aber
nur noch als abhängige Inseratsdaten aus den gewählten Grundstücken erzeugt.
Dadurch gibt es keinen zweiten langlebigen Auswahlzustand und keinen Übergabe-
Dialog mehr; alle späteren Schritte filtern gegen dieselben Grundstücks-IDs.

### Hürden und Risiken

- Historische Arbeitsstände und Rotationsprotokolle durften nicht gelöscht
  werden. Die Oberfläche wurde deshalb entfernt, während das bestehende interne
  Datenmodell für Export-, Upload- und Verlaufskompatibilität erhalten bleibt.
- Eine gespeicherte Auswahl kann auf inzwischen gelöschte oder deaktivierte
  Grundstücke zeigen. Die zentrale Normalisierung entfernt solche IDs beim
  Laden und nach einer Kaskadenlöschung, ohne aktive Benutzerdaten zu verändern.
- Bereits veröffentlichte Inserate werden weiterhin niemals automatisch extern
  gelöscht; die Änderung betrifft ausschließlich Auswahl und Darstellung.
- Der vorhandene Next.js-ESLint-Konfigurationsimport bleibt in dieser lokalen
  Installation beim Laden hängen. Die geänderten MJS-Tests wurden deshalb
  zusätzlich mit einer isolierten ESLint-Prüfung validiert; TypeScript,
  Produktions-Build und Testsuite sind davon nicht betroffen.

### Tests

- Auswahlmigration, unbekannte/deaktivierte Grundstücks-IDs und Kaskadenlöschung.
- Vertragstests für die fünf Navigationsschritte, genau eine Grundstücksauswahl,
  gemeinsamen Hauspool, alle Sortieroptionen und alphabetische Hausbibliothek.
- Vollständige Node-Test-Suite mit 136 Tests (135 bestanden, ein ausschließlich
  unter Windows ausführbarer Test übersprungen), TypeScript-Prüfung, isolierter
  ESLint-Lauf der geänderten MJS-Tests, Vinext-Produktions-Build und visueller
  Browser-Dry-Test der lokalen Mac-App ohne Browser-Konsolenfehler.

## Version 0.17.0 · Zentrale Grundstücke und Excel-Abgleich – 25. Juli 2026

### Report

- Grundstücksverwaltung und Projektierungsauswahl verwenden nun ausschließlich
  `state.plots` als zentrale Adressquelle. Der erste Bereich enthält getrennte
  Unteransichten zum Verwalten und zur gebietsweise gruppierten Mehrfachauswahl;
  Bereich 03 verarbeitet nur die von dort übergebenen aktiven Grundstücke.
- Die bisherige manuelle Soft-Löschung wurde durch eine bestätigte, vollständige
  interne Kaskadenlöschung ersetzt. Verknüpfte Projektierungen, Hausverteilungs-
  referenzen, Aktionsbildnutzungen, Uploadhistorien und Scheduler-Verweise werden
  entfernt. Externe Inserate werden dabei technisch nicht angesprochen.
- Datenschema 4 entfernt einmalig die Altlasten der früheren Soft-Löschung. Im
  produktiven Katalog wurden 12 archivierte Grundstückshüllen und 11 daran
  verknüpfte Projektierungsreste entfernt; danach bestanden keine verwaisten
  Grundstücksreferenzen mehr.
- Die Auswahl zeigt die Inseratsanzahl je Grundstück: null neutral, eins bis
  drei gelb, ab vier grün und über vier zusätzlich mit Warnhinweis.
- Auch frisch aus Excel übernommene Grundstücke werden vor ihrer ersten
  Projektierung anhand von Postleitzahl und Ort direkt nach Bundesland und
  Landkreis gruppiert; nur nicht eindeutig auflösbare Adressen nutzen den
  sichtbaren PLZ-/Ort-Rückfall.
- SOL 204 V4, SOL 229 V3, SOL 230 V6 und SOL 242 V4 wurden aus der vorhandenen
  Preis-, Medien- und Grundrissbasis vollständig ergänzt. Der Startkatalog kann
  diese stabilen Vorlagen jetzt auch in einen bestehenden Katalog nachinstallieren,
  ohne Benutzerinhalte zu überschreiben.
- Der lokale Helfer synchronisiert die zentral konfigurierte
  `KI_Grundstuecke.xlsx` sofort beziehungsweise persistent alle drei Tage um
  07:00 Uhr in `Europe/Berlin`. Interne ID, normalisierter Inseratslink und eine
  nur bei fehlenden IDs verwendete eindeutige Adresse bilden den priorisierten
  Dublettenschutz. Datei- und Prozess-Lock, atomarer Katalog-Commit sowie
  strukturierte Laufprotokolle schützen vor Parallel- und Teillaufzuständen.
- `Neu` legt nur fehlende Grundstücke an, `Vorhanden` aktualisiert sichere
  Treffer und `Nicht mehr vorhanden` deaktiviert Grundstück und Projektierung
  für neue Abläufe, ohne Historie oder externe Inserate zu löschen.
- Der Statusbereich zeigt Quelle, letzten Erfolg, nächsten Lauf, Ergebniszahlen,
  manuellen Dry-Run, manuellen Echtlauf und das letzte Detailprotokoll.
- Erster produktiver Lauf am 25.07.2026 um 22:23 Uhr MESZ: 10 Zeilen gelesen,
  5 neu angelegt, 0 aktualisiert, 0 deaktiviert, 0 übersprungen und 5 wegen
  fehlender vollständiger Straße/Hausnummer nicht verwendet. Ein anschließender
  Dry-Run erzeugte 0 neue Datensätze, übersprang dieselben 5 sicheren Treffer
  und verhinderte 5 Dubletten. Die Quelldatei blieb in allen Läufen unverändert.

### Begründung

Die alte Projektliste war eine zweite, langlebige Kopie der Adressdaten. Das
neue Modell behält Projektobjekte nur als abhängige Arbeits- und Historienebene;
Sichtbarkeit, Auswahl und neue Abläufe werden immer vom kanonischen Grundstück
gesteuert. Die Excel-Integration läuft im lokalen Helfer statt im Browser, weil
nur dieser persistent planen, den iCloud-Pfad lesen, atomar speichern und einen
prozessübergreifenden Lock halten kann.

### Hürden und Risiken

- Fünf aktuelle Excel-Zeilen enthalten keine vollständige Straße mit
  Hausnummer. Sie wurden entsprechend der Vorgabe weder ergänzt noch importiert
  und bleiben als Prüfungsfälle protokolliert.
- Der lokale macOS-Helfer holt einen während Ausschalten oder Ruhezustand
  verpassten Termin beim nächsten Start nach. Vercel kann den lokalen iCloud-
  Pfad nicht lesen; für Cloud-Hosting sind authentifizierter Objektspeicher oder
  ein gemountetes Laufwerk sowie ein externer Cron erforderlich.
- Im Integritätsbericht bleiben 18 bereits vorhandene, nur über Varianten
  referenzierte Steuerdatensätze bewusst als manuelle Prüfpunkte erhalten. Sie
  wurden nicht automatisch gelöscht, weil sie produktive Historie tragen können.

### Tests

- Kaskadenlöschung samt Reload-/Migrationsschutz und Entfernung aller internen
  Beziehungen; externe Löschung bleibt ausgeschlossen.
- Farbgrenzen 0, 1–3, 4 und mehr als 4; bestehende Gebietsgruppierung und
  PLZ-Sortierung.
- Alle vier SOL-Häuser mit Preis, Wohnfläche, Zimmern und vollständiger
  13-Bilder-Sequenz einschließlich versionsgenauer Grundrisse.
- Status Neu/Vorhanden/Nicht mehr vorhanden, ID-/URL-/Adressabgleich,
  URL-Normalisierung, unbekannter Status, fehlerhafte Zeile, fehlende Datei,
  Parallel-Lock, unveränderte Quelle und wiederholter Lauf.
- 200 Grundstücke plus Wiederholung ohne Dubletten; Zeitzonenprüfung über
  Sommer-/Winterzeit; vollständiger TypeScript-, ESLint-, Produktions-Build und
  130 Node-Tests.

## Version 0.16.1 · Katalog-Wiederherstellungsschutz – 25. Juli 2026

### Report

- Die Startlogik schützt den vollständigen macOS-Gerätekatalog jetzt vor einem
  neueren, aber inhaltlich leeren Browser-Zwischenstand.
- Ein Browser-Zwischenstand ohne vorbereitete Haustypen oder ohne adressierte
  Projektierungen darf die jeweils vorhandenen produktiven Gerätedaten nicht
  mehr verdrängen. Normale, inhaltlich vollständige Browser-Änderungen bleiben
  weiterhin zeitstempelbasiert und werden wie bisher gespeichert.
- Der versehentlich verdrängte Gerätestand wurde aus der automatischen
  Vor-Migrationssicherung wiederhergestellt. Dabei werden neu importierte
  Grundstücksdatensätze adressbasiert zusammengeführt und die zugehörigen
  Haus- und Aktionsbilder aus den lokalen Medienquellen rekonstruiert.

### Begründung

Browser- und Gerätesicherung bleiben bewusst zwei lokale Schutzebenen. Ein
Zeitstempel allein kann jedoch einen frisch angelegten Browser-Speicher nicht
von einem echten Arbeitsstand unterscheiden. Die zusätzliche Inhaltsprüfung
greift deshalb nur bei einem vollständigen Verlust einer produktiven
Katalogkategorie und verändert den üblichen Neuester-Stand-gewinnt-Ablauf
nicht.

### Hürden und Risiken

- Die Gerätesicherung trennt Bildmetadaten und Binärdateien. Nach der
  Fehlüberschreibung mussten die Bilddateien anhand stabiler Quellen-IDs und
  der Aktionsbildnamen neu aufgebaut werden.
- Ein absichtlich vollständig geleerter Browserkatalog wird nicht automatisch
  über eine ältere produktive Gerätesicherung geschrieben. Ein solcher
  Löschvorgang muss über den regulären, synchronisierten App-Workflow erfolgen.

### Tests

- Neuerer leerer Browser-Zwischenstand gegen produktiven Gerätekatalog
- Neuerer produktiver Browser-Zwischenstand mit regulären Änderungen
- Reguläre Auswahl eines neueren Gerätekatalogs
- Vollständiger Produktions-Build und bestehende Node-Test-Suite

## Version 0.16.0 · Schlanke Grundstücksverwaltung – 25. Juli 2026

### Report

- Der neue erste Arbeitsbereich **Grundstücke** verwaltet Grundstücke als
  eigene, dauerhaft gespeicherte Datensätze. Suche, Ortsfilter,
  Mehrfachauswahl, manuelle Anlage, Bearbeitung und logische Archivierung sind
  direkt in der App verfügbar.
- Die bestehende Excel-Struktur wird weiterverwendet. Vor jeder Übernahme zeigt
  die App nun eine Prüfansicht, markiert unvollständige Zeilen und lässt bei
  möglichen Adressdubletten ausdrücklich zwischen Aktualisieren, neu Anlegen
  und Überspringen wählen. Ohne Auswahl wird kein bestehender Datensatz
  überschrieben.
- Ausgewählte Grundstücke werden gesammelt an den vorhandenen
  Projektierungs- und Hausverteilungsprozess übergeben. Änderungen an Straße,
  PLZ, Ort, Grundstücksgröße oder Kaufpreis werden zentral an verknüpfte
  Projektierungen weitergereicht.
- PDF-Exposés können per Dateiauswahl oder Drag-and-drop lokal hinterlegt,
  geöffnet, ersetzt und recoverbar archiviert werden. Die Auslesung beschränkt
  sich auf Straße, Postleitzahl, Ort, Grundstücksgröße und Kaufpreis; jeder Wert
  muss in einer Prüfansicht bestätigt oder korrigiert werden.
- Der Lageverkaufstext wird unabhängig vom PDF erzeugt und entfernt
  Bebaubarkeits-, Positionierungs- und spätere Abstimmungsformulierungen. Der
  verbindliche Bebaubarkeitshinweis steht separat in Vorschau und
  OpenImmo-Export.
- Bestehende Projektadressen werden durch Datenschema 3 idempotent in die neue
  Grundstücksstruktur migriert. Inserate, Varianten, Bilder, Aktionsbilder,
  Scheduler- und Uploaddaten bleiben erhalten.

### Begründung

Das Grundstück ist nun die kanonische Quelle für die fünf im Alltag
benötigten Kerndaten. Die bisherigen Projektobjekte behalten aus
Kompatibilitätsgründen ihre Felder, werden jedoch kontrolliert mit dem
verknüpften Grundstück synchronisiert. So bleiben OpenImmo-Export,
Hausverteilung und Sammel-Upload unverändert nutzbar, während eine spätere
Supabase-Persistenz ohne erneute fachliche Modelländerung möglich bleibt.
PDF-Dateien liegen außerhalb des Katalogmanifests in einer eigenen lokalen,
sitzungsgeschützten Ablage; dadurch werden sie weder veröffentlicht noch in
Inseratpakete oder Git-Daten aufgenommen.

### Hürden und Risiken

- Exposé-PDFs besitzen sehr unterschiedliche Textlayouts. Der Reader
  rekonstruiert deshalb auch einzeln gesetzte und gesperrte Buchstaben, erfindet
  bei nicht sicher erkannten Angaben jedoch keinen Ersatzwert. Die sichtbare
  Prüfansicht bleibt zwingend.
- Archivierte Grundstücke werden nicht mehr angeboten, bereits verknüpfte
  Projektierungen und Inserate bleiben aber absichtlich bestehen. Eine echte
  physische Löschung wäre ohne bestätigte Abhängigkeitskette riskant.
- Die Persistenz bleibt in dieser Version lokal. Das Modell ist backendfähig,
  enthält aber noch keine Supabase-Tabellen, RLS-Regeln oder Cloud-Dateiablage.
- macOS blockierte beim ersten Prüflauf einzelne frisch installierte
  Abhängigkeitsdateien minutenlang im Lesezugriff. Nach vollständigem Laden
  lief der Produktions-Build reproduzierbar in unter zwei Sekunden; die
  Quellprüfung wurde deshalb zusätzlich direkt über TypeScript und
  `node --check` abgesichert.

### Tests

- Idempotente Migration bestehender Projektadressen und Synchronisierung
- Excel-Vorschau mit gültigen, unvollständigen und doppelten Zeilen
- explizites Aktualisieren, Neu-Anlegen und Überspringen von Dubletten
- PDF-Fünf-Felder-Auslesung aus synthetischen PDFs und dem realen
  `T5721_Kirschallee_in_14469_Potsdam.pdf`
- lokales Staging, Speichern, Lesen, Pfadschutz und recoverbare Archivierung
- Trennung des Lageverkaufstextes vom Bebaubarkeitshinweis
- strikte TypeScript-Prüfung der integrierten App, Node-Syntaxprüfung,
  Produktions-Build, 113 Gesamttests und Browser-Dry-Run mit aktivem Helfer

## Version 0.15.0 · Technische Tiefenbereinigung – 25. Juli 2026

### Report

- Ein zentrales Statusmodell ersetzt freie deutsche und englische
  Statusvarianten in Inseratsgruppen, Scheduler, Uploadhistorie und UI.
- `rotation-service.mjs` ist jetzt die einzige fachliche Planungsstelle für
  gewichtete Hausrotation, Premium-/Manuellsperren, Leases, Vierergrenze und
  eindeutige Hauskombinationen. Vorschau, Scheduler und manuelle Vorbereitung
  verwenden denselben Plan.
- Die frühere Round-Robin-Auswahl einschließlich `lastUsedVariantId`,
  `nextVariantId` und gruppenweiter Prozesssperre wurde entfernt.
- Uploads besitzen eine deterministische Job-ID. Browser und lokaler Helfer
  verhindern parallele beziehungsweise bereits abgeschlossene Wiederholungen;
  das Helferprotokoll wird atomar, begrenzt und strukturiert gespeichert.
- Logdaten werden rekursiv von sensitiven Schlüsseln und typischen
  Zugangswertmustern bereinigt. Pflichtbezüge zu Job, Inserat, Grundstück,
  Prozess, Status und Fehler bleiben erhalten.
- `data-integrity.mjs` und `scripts/audit-studio-catalog.mjs` ergänzen
  nachvollziehbaren Dry Run, idempotente Migration, Dublettenprüfung,
  Ablaufbereinigung und eine ausschließlich explizit erzeugte Ausgabekopie.
- Der lokale Helfer migriert den bestehenden Katalog vor dem Start atomar,
  legt einmalig eine Vor-Migrationssicherung an und bereinigt auch Sicherungen
  älterer Browser-Tabs erneut idempotent.
- Die Gerätesicherung erfasst nun jedes Aktionsbild der verwalteten Bibliothek;
  nicht nur das erste aktive Motiv.
- Pro Grundstück wird exakt eine aktuelle Aktionsbildzuordnung erzwungen;
  Nutzungsverlauf und Bildrotation bleiben von der Hausrotation getrennt.
- „Zusätzliche Hinweise“ wurde aus Typen, Formularzustand, KI-Payload,
  Textgenerierung, Excel-Parser und geprüfter Importvorlage entfernt.
- Vier eindeutig unreferenzierte Altdateien wurden entfernt: die alte
  4+4-Rotationskopie mit Test sowie ungenutzte Cloudflare-Worker- und
  Sites-Starterdateien.
- TypeScript- und ESLint-Suchräume ignorieren den 3-GB-Medienbestand und
  temporäre Prüfartefakte.

### Begründung

Status, Standardwerte, Rotation, Sperren und Aktionsbilder sind fachliche
Invarianten. Sie liegen deshalb in kleinen, zustandsbasierten Diensten statt in
mehreren UI- und Scheduler-Pfaden. Die persistente Upload-Jobdatei ergänzt die
Browser-Sperre über Neustarts hinweg. Der Cleanup trennt bewusst exakt sichere
Korrekturen von Fällen, die nur markiert und erhalten werden dürfen.

### Hürden und Risiken

- Der reale Katalog enthält zehn Steuerdatensätze, die nicht in der aktuellen
  Inseratsliste, aber weiterhin in Varianten-Snapshots referenziert sind. Sie
  wurden nicht gelöscht.
- Mit genau vier Poolhäusern ist die Ersterstellung möglich, eine Rotation auf
  ein fünftes, noch nicht aktives Haus jedoch erwartungsgemäß blockiert.
- Immoprofessional bietet im vorhandenen Ablauf weder bestätigtes Lesen noch
  sicheres automatisches Löschen. Ein echter Löschtest und ein produktiver
  FTPS-Testupload bleiben deshalb bewusst ausgeschlossen.
- Die Anwendung besitzt weiterhin eine lokale JSON-/Bildablage und IndexedDB,
  keine Supabase-Datenbank. Serverseitige Eindeutigkeitsindizes müssen erst mit
  einer späteren Backendmigration eingeführt werden.

### Datenprüfung und Sicherung

- Vor dem Cleanup wurde `catalog-v2` vollständig nach
  `backups/pre-cleanup-20260725` gesichert; Manifest-Hash und 62 Bilddateien
  stimmen mit der Quelle überein.
- Der reale Dry Run prüfte 18 Häuser, 54 Grundstücke, 73 Inserate, 83
  Steuerdatensätze, 11 Aktionsbilder, 7 Aktionsbildnutzungen und 28
  Uploadprotokolle.
- Keine doppelten Projekt-, Adress-, Haus-, Inserats-, Objektnummer-,
  Aktionsbild- oder Bild-Hash-Gruppen wurden gefunden.
- In einer separaten Bereinigungskopie wurden 54 alte Hinweisfelder entfernt
  und acht überzählige Hausaktivierungen in zwei Altgruppen deaktiviert. Zehn
  variantenreferenzierte Steuerdatensätze blieben erhalten.
- Dieselben sicheren Änderungen wurden nach dem Dry Run auf den lokalen Katalog
  angewendet. Der Abschluss-Audit meldet nur noch die zehn bewusst erhaltenen
  Variantendatensätze. Alle 72 referenzierten Bilddateien sind vorhanden.

### Tests

- Datenmigration, Idempotenz, exakte und widersprüchliche Dubletten
- gewichtete Pools mit 4, 10 und 20 Häusern sowie 20 Rotationszyklen
- Premium-, manuelle und parallele Prozesssperren
- Scheduler-Verteilung und Skalierung auf 2.000 Inserate
- genau eine Aktionsbildzuordnung pro Grundstück
- parallele, wiederholte und nach Abbruch erneut gestartete Upload-Jobs
- rekursive Log-Redaktion und Begrenzung
- Excel-Importvorlage ohne Hinweisfeld
- Produktions-Build, Gesamttests und lokaler Browser-Dry-Run
- `pnpm audit --prod`: keine bekannte Sicherheitslücke

## Version 0.14.0 · Gewichteter Hauspool und intelligente Rotation – 24. Juli 2026

### Report

- `house-distribution.mjs` verwaltet einen zentralen, beliebig großen
  Hauspool für Ersterstellung und spätere Aktualisierungen. Pro Grundstück
  werden exakt vier unterschiedliche, aktive und vollständige Häuser
  verwendet; Pools mit weniger als vier zulässigen Häusern werden mit einer
  eindeutigen Meldung blockiert.
- Die gewichtete Auswahl berücksichtigt Gesamtnutzung, Nutzung im frei
  konfigurierbaren Zeitraum, letzte Verwendung, bisherige Grundstücke,
  gleichzeitig aktive Grundstücke, Kombinationshäufigkeit und vorherige
  Kombinationen. Sämtliche Gewichte liegen in einer zentralen Konfiguration.
- Die Mehrfach-Projektierung besitzt jetzt eine bearbeitbare Vorschau mit
  Preis, Wohnfläche, Zimmern, Reihenfolge und voraussichtlichem Aktionsbild.
  Einzelne Häuser können ausgetauscht, fixiert, je Grundstück ausgeschlossen,
  verschoben oder für eine beziehungsweise alle Adressen neu verteilt werden.
- Hausnutzungen, Kombinationen, Zeitpunkte, aktive Grundstücke, vorherige
  Kombinationen sowie zuletzt entferntes und aufgenommenes Haus werden in der
  bestehenden lokalen Projektsicherung dauerhaft gespeichert.
- Der Inseratsscheduler verwendet denselben Hauspool als Rotationspool und
  plant ein noch nicht aktives Ersatzhaus. Premium-, manuell gesperrte und
  intern archivierte Inserate bleiben ausgeschlossen; je Schedulerlauf gilt
  weiterhin maximal ein Inserat pro Grundstück.
- Eine vorbereitete Rotation ersetzt vor dem Upload nicht das bestehende
  Inserat. Erst nach bestätigtem FTPS-Erfolg wird das alte Inserat intern als
  ersetzt markiert und von weiteren Uploads ausgeschlossen. Eine automatische
  Löschung in Immoprofessional findet weiterhin nicht statt.
- Aktionsbilder speichern zusätzlich das zuletzt zugeordnete Grundstück,
  Haus und Inserat. Die Aktionsbildrotation bleibt fachlich vollständig von
  der Hausrotation getrennt.
- Der Immoprofessional-Benutzername ist mit dem vorgesehenen Standardwert
  vorbelegt; das Passwort bleibt ausschließlich im macOS-Schlüsselbund.
- Der neue schlanke Produktionsadapter `production-server.mjs` liefert den
  gebauten Client und das serverseitige Rendering direkt aus. Der tägliche
  macOS-Start ist dadurch nicht mehr vom langsamen Vinext-Entwicklungsadapter
  abhängig; der Starter toleriert zusätzlich den mehrminütigen Kaltstart nach
  einem vollständigen Medien-Build.
- Ein eigener lokaler Health-Endpunkt identifiziert den Produktionsserver ohne
  vollständiges SSR-Rendering. Dadurch erkennt der Desktop-Starter eine bereits
  laufende App zuverlässig und öffnet sie erneut mit der Helfer-Sitzung.
- Das verwirrende Formularfeld „Zusätzliche Hinweise“ wurde aus Schritt 2
  entfernt. Bereits gespeicherte Altwerte bleiben zur Datenkompatibilität
  erhalten, werden aber nicht mehr zur Bearbeitung angeboten.

### Begründung

Verteilung und Rotation liegen in einem reinen, zustandsbasierten Dienst. So
verwenden Ersterstellung, manuelle Vorschau und Scheduler dieselben Regeln,
ohne Auswahlparameter in der Oberfläche mehrfach zu hardcodieren. Mehrere
gewichtete Kandidaten werden erzeugt und anhand ihrer Nutzungs- und
Kombinationshistorie bewertet; ein kleiner gewichteter Zufallsanteil verhindert
starre Muster, ohne in unkontrollierten Zufall zurückzufallen. Persistente
Historien erlauben eine gleichmäßige Verteilung auch über Neustarts hinweg.

### Hürden und Risiken

- Bei einem Pool mit exakt vier Häusern existiert technisch nur eine mögliche
  Kombination. Die App dokumentiert diesen unvermeidbaren Rückfall, statt den
  Vorgang fälschlich zu blockieren.
- Immoprofessional stellt im vorhandenen Workflow keinen verlässlich
  zurücklesbaren Löschstatus bereit. Darum wird ein ersetztes Inserat nur lokal
  archiviert und muss vor einer tatsächlichen Löschung im Portal geprüft
  werden.
- Der große integrierte Bildbestand verlängert vollständige Produktions-Builds.
  Reine Verteilungs- und Scheduler-Tests bleiben davon unabhängig und schnell.
- Der Produktionsadapter muss sowohl dynamische SSR-Antworten als auch
  gehashte Clientdateien korrekt bedienen. Dafür gibt es einen eigenen
  Integrationstest ohne externen Netzwerkzugriff.
- Die Datenschutzprüfung der KI-Quelldaten ignoriert die zufällig erzeugte
  technische UUID. Dadurch kann eine zufällige Zeichenfolge innerhalb der UUID
  nicht mehr fälschlich als übertragene Hausnummer gewertet werden.

### Geänderte und neue Dateien

- Neu: `house-distribution.mjs`, `production-server.mjs`,
  `tests/house-distribution.test.mjs`, `tests/production-server.test.mjs`
- Erweitert: `app/InseratStudio.tsx`, `app/types.ts`, `app/globals.css`,
  `studio-defaults.mjs`, `listing-scheduler.mjs`, `batch-upload.mjs`,
  `promotion-images.mjs`, `ftp-config.mjs`, `package.json`,
  `Start-Fabian-Pascal-Inseratestudio.command`, `app/lib/app-version.mjs`,
  `README.md`, `CHANGELOG.md`
- Tests erweitert: `tests/batch-upload.test.mjs`,
  `tests/promotion-images.test.mjs`, `tests/openimmo.test.mjs`,
  `tests/ai-text-service.test.mjs`

### Tests

- 4 Grundstücke mit 10 Häusern
- 20 Grundstücke mit 15 Häusern
- mehr Grundstücke als praktisch unterschiedliche Kombinationen
- Pool mit genau vier beziehungsweise weniger als vier Häusern
- fixierte, ausgeschlossene und inaktive Häuser
- zwanzig aufeinanderfolgende gewichtete Rotationen
- Schutz vor doppelten Häusern und direkter Kombinationswiederholung
- persistente Haus-, Kombinations- und Aktionsbildhistorien
- vorbereitete Rotation ohne erneuten Upload des geschützten Ausgangsinserats
- bestehender Premiumschutz und Skalierungstest mit 2.000 Inseraten
- SSR-Startseite und gehashte statische Datei über den Produktionsadapter
- vollständiger Produktions-Build und visueller Browser-Dry-Run der Schritte
  „Adresse & Auswahl“ sowie „Export & Upload“
- Gesamtergebnis: 85 Tests, davon 84 bestanden, 0 fehlgeschlagen und 1
  Windows-spezifischer Verschlüsselungstest auf macOS übersprungen
- Reale Startprüfung: App-Health und authentifizierter Upload-Helfer jeweils
  mit HTTP 200

## Version 0.13.0 · Mehrfachauswahl und Sammel-Upload – 24. Juli 2026

### Report

- Unter „Projektierungen erstellen“ können beliebig viele gespeicherte
  Grundstücksadressen gleichzeitig ausgewählt werden. Die Vorbereitung lädt
  je Adresse die Varianten, ergänzt zentrale Standardwerte, erzeugt fehlende
  Entwürfe und verwendet die vorhandenen Bildfolgen.
- Der neue zentrale Dienst `batch-upload.mjs` erstellt eine skalierbare
  Uploadplanung und verarbeitet sie strikt sequenziell nach Adresse und
  Inserat. Fehler werden einzeln zurückgegeben und stoppen keine späteren
  Pakete.
- Die Uploadübersicht zeigt Adresse, Inseratanzahl, Hausvarianten,
  Aktionsbild, Status, Gesamtzahl und Laufzeitschätzung. Während des Laufs
  bleiben Adress-, Inserats- und Gesamtfortschritt sowie Erfolg und Fehler
  sichtbar.
- `promotion-images.mjs` verwaltet beliebig viele Aktionsbilder zentral mit
  Aktivstatus, Priorität, Reihenfolge, letzter Verwendung und Zähler. Rotation,
  Zufall und manuelle Motiv-/Inseratsauswahl sind getrennt schaltbar.
- Pro Adresse erhält technisch maximal ein Inserat ein Aktionsbild. Erst nach
  erfolgreichem Upload werden Motiv, Inserat, Objektnummer und Zeitpunkt
  gespeichert; die Historie verhindert nach Möglichkeit dieselbe Kombination
  bei der nächsten Erstellung oder Aktualisierung.
- Pro Uploadversuch werden Projekt-ID, Adresse, Objektnummer, Hausvariante,
  Aktionsbild, Erstellung, letzte/nächste Aktualisierung, Status und Fehler in
  der bestehenden lokalen Sicherung protokolliert.
- Der macOS-Desktop-Starter baut nur noch bei fehlendem oder veraltetem
  Produktionsstand. Build und Serverstart verwenden direkt die lokale,
  festgeschriebene Vinext-Version; ein Neustart mit aktuellem Build öffnet
  dadurch ohne unnötigen zweiten pnpm-Build.

### Begründung

Planung, Rotation und Ausführung liegen in reinen, unabhängig testbaren
Diensten. Die React-Oberfläche steuert nur Auswahl, Bestätigung und
Fortschrittsanzeige. Dadurch besitzt der Code keine Adress- oder Inseratgrenze,
führt trotzdem immer nur genau einen Upload gleichzeitig aus und lässt sich
später ohne fachlichen Umbau in einen Hintergrundprozess verschieben.

### Hürden und Risiken

- Immoprofessional bietet weiterhin keinen bestätigten Rücklesekanal für den
  endgültigen Portalstatus. Ein erfolgreicher FTPS-Transfer bedeutet deshalb,
  dass das Paket übertragen wurde; die endgültige Freigabe bleibt in
  Immoprofessional zu kontrollieren.
- Neue Adressen ohne eigene Hausvarianten übernehmen beim bewussten
  Batch-Vorbereiten die Varianten der aktuell geöffneten Adresse. Ist auch
  dort keine Variante vorhanden, wird die Adresse sichtbar übersprungen und
  nicht mit erfundenen Hausdaten gefüllt.
- Der Produktions-Build wartet bei laufendem Vinext-Server auf dessen
  Ausgabedateien. Für die Abnahme wurde nur der Webserver gestoppt, danach der
  Build vollständig ausgeführt und die App erneut gestartet.

### Tests

- Die Batchplanung wurde mit 250 Adressen und 1.000 Inseraten ohne feste
  Obergrenze geprüft.
- Strikte Einzelausführung und Fortsetzung nach einem gezielt ausgelösten
  Fehler wurden automatisiert verifiziert.
- Migration des bisherigen Einzel-Aktionsbildes, automatische und manuelle
  Rotation, Nutzungsprotokoll sowie höchstens ein Aktionsbild je Adresse wurden
  getestet.
- Der OpenImmo-Export wurde mit einer inseratsbezogenen Aktionsbildzuordnung
  geprüft; das Motiv erscheint nur im zugewiesenen Inserat.
- Gesamtergebnis: 75 Tests, davon 74 bestanden und 1 plattformbedingt
  übersprungen; zusätzlicher fokussierter Lauf mit 12 von 12 bestandenen Tests.
  Der vollständige Vinext-Produktions-Build wurde erfolgreich abgeschlossen.

### Angepasste und neue Dateien

- Neu: `batch-upload.mjs`, `promotion-images.mjs`
- Oberfläche und Datenmodell: `app/InseratStudio.tsx`, `app/types.ts`,
  `app/globals.css`, `studio-defaults.mjs`, `app/lib/project-owners.ts`
- Export: `app/lib/openimmo.ts`
- Tests: `tests/batch-upload.test.mjs`, `tests/promotion-images.test.mjs`,
  `tests/openimmo.test.mjs`
- Version und Dokumentation: `app/lib/app-version.mjs`, `package.json`,
  `README.md`, `CHANGELOG.md`, `Start-Fabian-Pascal-Inseratestudio.command`

## Version 0.12.0 · Dynamisches Inseratsmanagement – 24. Juli 2026

### Report

- Die feste 4+4-Struktur wurde durch eine dynamische Variantenliste ohne
  programmierte Obergrenze ersetzt. Neue Projekte erhalten vier Vorschlagszeilen;
  Zeilen können frei ergänzt, sortiert, deaktiviert oder entfernt werden.
- `listing-groups.mjs` verwaltet vollständige Variantensnapshots und jetzt
  inseratsbezogene Rotationsstände, Sperren, Prioritäten, Modi, Termine,
  Fehlerstatus, Auswahlreservierungen und Verarbeitungs-Leases.
- Der neue zentrale Service `listing-scheduler.mjs` normalisiert alle
  Scheduler-Einstellungen, berechnet den erweiterbaren Health Score, filtert
  Sperren und verteilt fällige Inserate im Round-Robin-Verfahren über Adressen.
- Die neue Ansicht „Inseratsmanager“ zeigt Adresse, Objektnummer, Hausvariante,
  Preis, Termine, Status, Health Score, Sperren und Fehler. Pro Inserat stehen
  Vorbereitung, Kopieren, Pause, Premium, Löschsperre, Priorität, Modus und
  Variantenauswahl bereit.
- Die Anwendungsversion wurde auf 0.12.0 angehoben. Bestehende 4+4-Daten werden
  beim Laden automatisch in das dynamische Schema 2 migriert.
- Die Oberfläche verwendet den nativen macOS-Systemfont statt eines externen
  Google-Font-Buildschritts; dadurch bleibt der lokale Build offline stabil.

### Persistenz und Datenmodell

- Es wurden keine SQL-Tabellen ergänzt. Die App bleibt vollständig lokal und
  persistiert den Zustand im bestehenden IndexedDB-Datensatz sowie in der
  macOS-Gerätesicherung.
- `StudioState.scheduler` speichert zentrale Einstellungen und Laufprotokolle.
  `ListingGroup.variants` ist dynamisch; `listingControls` speichert den
  unabhängigen Zustand je Inserat. Bestehende Speicherumschläge bleiben lesbar.

### Scheduler, Priorität und Rotation

- Konfigurierbar sind Tageslimit, Adresslimit, globaler Mindestabstand,
  Erstwartezeit, Wiederholungsintervall, Wochentage, Start-/Endzeit, Pause und
  Modus. Diese Werte liegen ausschließlich in der zentralen Konfiguration.
- Der Health Score setzt sich aus Alter, Überfälligkeit, letztem Fehler und
  Benutzerpriorität zusammen. Die Regeln sind als getrennte Beiträge definiert
  und können ohne Änderung des Auswahlalgorithmus erweitert werden.
- Kandidaten werden zuerst je Adresse priorisiert und anschließend rundenweise
  über alle Adressen gewählt. Die nächste Hausvariante wird anhand des
  Rotationsstands des einzelnen Ausgangsinserats bestimmt.

### Sperren und Sicherheit

- Premium-, manuelle und zeitliche Sperren, Aktualisierungspause, Modus,
  Tagesreservierung und Prozess-Lease werden vor jeder Bearbeitung erneut je
  Inserat geprüft. Ein Fehler wird isoliert protokolliert und der Tageslauf kann
  mit den übrigen Inseraten fortfahren.
- Vor einer Löschung verlangt die zentrale Prüfung eine erfolgreich erstellte
  Anzeige, neue Objektnummer, bestandene Pflicht-/Variantenprüfung und fehlende
  Sperren. Die tatsächliche automatische Löschung bleibt technisch blockiert,
  solange Immoprofessional keinen bestätigten Lösch- und Rücklesekanal bietet.

### Tests

- Dynamisches Hinzufügen, Entfernen und Sortieren sowie ein Modell mit 2.000
  Varianten wurden geprüft.
- Die adressübergreifende Scheduler-Verteilung wurde mit 2.000 Inseraten,
  Tages- und Adresslimits, Reservierungen, Health Score, Zeitfenstern, Sperren
  und isolierten Fehlern getestet.
- TypeScript-Prüfung, ESLint, vollständige Node-Tests und Produktions-Build
  werden für die Abnahme ausgeführt.

### Begründung

Ein globaler, reiner Auswahlservice trennt fachliche Priorisierung und
Sperrprüfung von Oberfläche und Upload. Dadurch skaliert derselbe Ablauf von
wenigen Inseraten bis zu mehreren tausend Datensätzen, bleibt deterministisch
testbar und kann später vom lokalen macOS-Helfer als Hintergrundprozess genutzt
werden. Vollständige Variantensnapshots verhindern fachlich inkonsistente
Mischungen aus Preis, Fläche, Texten und Bildern.

### Hürden und bekannte Risiken

- Browser und macOS-Helfer besitzen noch keinen von Immoprofessional
  bestätigten API-Kanal zum Rücklesen einer neu vergebenen Objektnummer oder zum
  sicheren Löschen. Deshalb bereiten automatische Läufe aktuell validierte
  Entwürfe vor, veröffentlichen oder löschen aber nicht unbeaufsichtigt.
- Der Scheduler läuft in der Oberfläche nur bei geöffneter Anwendung. Für echte
  Hintergrundausführung nach einem Neustart muss der bestehende lokale Helfer
  in einem separaten, signierten macOS-Release um einen LaunchAgent erweitert
  werden; das Daten- und Servicemodell ist dafür vorbereitet.

### Angepasste Dateien

- `listing-groups.mjs`, `listing-scheduler.mjs`
- `app/InseratStudio.tsx`, `app/types.ts`, `app/globals.css`, `app/layout.tsx`
- `studio-defaults.mjs`, `app/lib/app-version.mjs`, `package.json`
- `tests/listing-groups.test.mjs`, `tests/listing-scheduler.test.mjs`
- `README.md`, `CHANGELOG.md`

## Sichere Inseratsgruppen und Variantenrotation – 24. Juli 2026

### Report

- Pro Adresse ein persistentes Gruppenmodell mit vier Haupthäusern und vier
  Alternativen ergänzt. Alternativen dürfen leer bleiben oder dieselbe
  freigegebene Hausvariante erneut verwenden.
- Jeder Slot speichert Haus-Snapshot, Preisbasis, Flächen, Zimmer,
  Energieangaben, Bild- und Grundrissreferenzen, vollständigen Inseratentwurf,
  Reihenfolge, Rolle und Freigabestatus als zusammengehörige Einheit.
- Eine Verwaltungsoberfläche für Rotation, Intervall, Tageslimit,
  Aktivierung, Reihenfolge, Premium-Sperren, manuelle Sperren und
  Prozessprotokolle ergänzt.
- Dry Run und der sichere Kopierablauf implementiert. Der Dry Run prüft
  Hausdaten, Preis, Bilder, Texte und sämtliche zentralen Projektierungswerte.
  Die lokale Vorbereitung erhält eine neue Objektnummer, verändert die Rotation
  aber noch nicht. Erst ein erfolgreich bestätigter Upload schreibt den
  Rotationsstand persistent fort und lässt bestehende Anzeigen unangetastet.
- Browser-Locks und persistente Prozess-Leases verhindern parallele
  Verarbeitung. Anwendungsversion auf 0.11.0 angehoben.

### Begründung

Varianten werden nicht aus einzelnen Preis- oder Flächenfeldern zusammengesetzt,
sondern immer aus einem freigegebenen Haustyp vollständig erzeugt. Das
verhindert Mischzustände zwischen Haustyp, Bildern, Grundriss, Text und Preis.
Die bestehende IndexedDB- und macOS-Sicherung bleibt die einzige Datenquelle;
dadurch entstehen weder ein zweites Datenbanksystem noch neue Zugangsdaten.

### Hürden und Risiken

- Binärbilder werden aus Speicher- und Sicherungsgründen nicht achtfach
  dupliziert. Jeder Variantensnapshot enthält unveränderliche Bildreferenzen;
  der Dry Run vergleicht diese mit dem zentral gespeicherten Hauskatalog.
- Automatische Veröffentlichung und automatische Löschung sind bewusst noch
  nicht implementiert. `automaticDeletionEnabled` wird bei jeder
  Normalisierung und jeder Sperränderung erzwungen auf `false` gesetzt.
- Premium- und manuelle Sperren bleiben unabhängig vom Rotationsmodus aktiv.
  Das alte Inserat wird in dieser Ausbaustufe niemals automatisch gelöscht.
- Bestehende Adressen werden beim Laden ohne Datenverlust in das neue
  Acht-Slot-Modell migriert. Vorhandene Inserate und Benutzertexte bleiben
  erhalten; fehlende zentrale Standards werden ausschließlich ergänzt.

## Küche, Bad und Umgebung als Projektierungsstandards – 24. Juli 2026

### Report

- Die zentrale Projektierungs-Konfiguration um Einbauküche, offene Küche,
  Dusche, Wanne, Badfenster, Bus und Einkaufsmöglichkeit ergänzt.
- Neue, automatisch angelegte und bereits gespeicherte Projektierungen werden
  über dieselbe Normalisierung ausschließlich um fehlende Werte ergänzt.
- Den OpenImmo-Export für Küche und Bad auf die Projektierungswerte umgestellt
  und die Umgebung als Infrastruktur-Zusatzfeld ergänzt. Anwendungsversion auf
  0.10.1 angehoben.
- Die inhaltsleere `next.config.ts` entfernt. Ohne benutzerdefinierte
  Next-Konfiguration verwendet vinext dieselben Standardwerte, überspringt
  jedoch den auf diesem großen lokalen Projekt zeitkritischen TS-Modul-Runner.

### Begründung

Eine gemeinsame Konfiguration hält Initialisierung, Wiederherstellung und
Export deckungsgleich. Einzelne Wahr-/Falsch-Werte bilden die Mehrfachauswahl
ab und erlauben zugleich, eine manuelle Abwahl zuverlässig zu erhalten.

### Hürden und Risiken

- OpenImmo bildet Bus und Einkaufsmöglichkeiten regulär als Entfernungen ab.
  Da keine verifizierten Kilometerwerte vorliegen, werden keine künstlichen
  Distanzen erzeugt; die Auswahl wird schema-konform als benanntes
  Infrastruktur-Zusatzfeld übertragen.
- Explizit gesetzte Benutzerwerte, einschließlich `false`, werden nie
  überschrieben. Unbekannte zusätzliche Projektierungsfelder bleiben durch
  die ergänzende Normalisierung ebenfalls erhalten.
- Andere Formularfelder, Texte und Upload-Abläufe wurden nicht verändert.
- Der Produktions-Build lief zuvor bereits beim Laden der funktionslosen
  Next-Konfiguration in das feste 60-Sekunden-Limit des Vite-Modul-Runners;
  die Entfernung ändert keine Konfiguration, beseitigt aber diesen unnötigen
  Fehlerpfad.

## Vollständig integrierter Medien- und Preiskatalog – 24. Juli 2026

### Report

- Die vollständige verfügbare Medienbibliothek mit 655 Anzeigenbildern und
  10 zusätzlichen Innenraumbildern direkt in die macOS-App übernommen. Alle
  665 JPEG-, PNG- und WebP-Originale bleiben verlustfrei und behalten ihre
  bestehende Ordnerstruktur.
- Die Standard-Medienquelle von einem persönlichen iCloud-Pfad auf den
  eingebauten Ordner `bundled-media` umgestellt. Externe Pfade können weiterhin
  bewusst über Umgebungsvariablen gesetzt werden.
- Einen neutralen Erststart ergänzt: Auf einem neuen Mac werden die 18
  bestätigten Hausvorlagen samt benötigter Bildfolgen automatisch lokal
  installiert. Ein bereits vorhandener Katalog wird niemals überschrieben.
- Die vollständige hinterlegte Preisliste mit 30 Modellen in Schritt 1 sichtbar
  gemacht. Bildversionen bleiben für die Preisidentifikation ohne Bedeutung.
- Gemeinsame neutrale Standardwerte für Browser und Erstinstallation zentral
  zusammengeführt. Anwendungsversion auf 0.10.0 angehoben.

### Begründung

Die App soll ohne persönliche iCloud-Verzeichnisstruktur vollständig nutzbar
sein. Medien, Hausvorlagen und Preise liegen deshalb reproduzierbar neben dem
Programmcode. Git LFS hält die großen Binärdateien aus der normalen
Git-Historie heraus, während ein Checkout weiterhin den vollständigen Bestand
erhält.

### Hürden und Risiken

- Die Originalbilder umfassen rund 3,17 GB logische Daten. Ein neuer Checkout
  benötigt Git LFS, ausreichend lokalen Speicher und eine entsprechend lange
  erste Übertragung.
- Private Grundstücksprojekte, persönliche Anbieterdaten, Schlüsselbundinhalte,
  Sitzungstoken und Uploadprotokolle wurden ausdrücklich nicht eingebaut oder
  für GitHub vorgemerkt.
- Der Erststart kopiert nur die 61 für die 18 Standardvorlagen benötigten
  Bilddateien in den lokalen Katalog. Der vollständige Bestand bleibt direkt
  über die integrierte Medienbibliothek verfügbar, ohne den Web-Build zu
  duplizieren.

## Bestätigte SUN-113-Stammdaten – 24. Juli 2026

### Report

- SUN 113 zentral mit 355.122 € Hauspreis, 106,15 m² Wohnfläche, 4 Zimmern
  und 3 Schlafzimmern hinterlegt. Die Bildvariante bleibt für den Preis ohne
  Bedeutung.
- Die vorinstallierte Vorlage `SUN 113 V6` auf diese bestätigten Stammdaten
  umgestellt. Bereits lokal gespeicherte SUN-113-Versionen werden beim Laden
  in genau diesen vier Werten aktualisiert.
- Anwendungsversion auf 0.9.6 angehoben.

### Begründung

Preis und Modellangaben liegen in den bestehenden zentralen Katalogen. Eine
kleine gemeinsame Normalisierung stellt sicher, dass nicht nur neue Vorlagen,
sondern auch der bereits installierte lokale Hauskatalog die bestätigten Werte
erhält.

### Hürden und Risiken

- Bilder, Grundrisse, Badanzahl, Etagen und alle weiteren Hausangaben werden
  von der Bestandsaktualisierung nicht verändert.
- Bereits erzeugte Inserat-Gesamtpreise werden nicht still überschrieben.
  Neu erzeugte oder bewusst aktualisierte Projektierungen verwenden den
  korrigierten Hauspreis zusammen mit den jeweiligen Grundstückskosten.

## Ergänzende Projektierungsstandardwerte – 24. Juli 2026

### Report

- Die Standardwerte für Immoprofessional-Projektierungen zentral in
  `IMMOPROFESSIONAL_DEFAULTS` zusammengeführt und eine gemeinsame,
  ergänzende Normalisierung ergänzt.
- Neue und automatisch erzeugte Inserat-Projektierungen erhalten gehobene
  Ausstattungsqualität, den Status `PROJEKTIERT`, Fußbodenheizung,
  Luft-Wärmepumpe, KfW40 und KfW55, Energieklasse A++, keine
  Provisionspflicht sowie die GEG-2022-Effizienzklasse A+.
- Bereits gespeicherte Projektierungen werden beim Laden nur vervollständigt.
  Leere Werte und „keine Angabe“ erhalten den Standard; vorhandene Texte sowie
  explizite Wahr-/Falsch-Werte bleiben unverändert.
- Den OpenImmo-Export auf dieselbe Normalisierung umgestellt. Die
  GEG-Effizienzklasse wird standardkonform als `energiepass/wertklasse`
  übertragen; die separate Immoprofessional-Energieklasse bleibt davon
  unabhängig. Anwendungsversion auf 0.9.5 angehoben.

### Begründung

Eine einzige Konfiguration verhindert abweichende Werte zwischen Erzeugung,
lokaler Wiederherstellung und Export. Die Einstellungen liegen je Inserat,
damit künftig unterschiedliche Benutzerwerte innerhalb desselben
Grundstücksprojekts erhalten bleiben können. Die erneute Ergänzung unmittelbar
vor dem Export schützt zugleich ältere lokale Sicherungen mit noch fehlenden
Feldern.

### Hürden und Risiken

- Immoprofessional unterscheidet die allgemeine Energieklasse A++ von der
  Energieeffizienzklasse des Energieausweises. Deshalb wird A++ als benanntes
  Immoprofessional-Zusatzfeld und A+ im OpenImmo-Energiepass ausgegeben.
- Der bestehende feste Courtage-Hinweis bleibt unverändert, obwohl
  `provisionspflichtig` bei fehlender Angabe nun wie gefordert auf `false`
  gesetzt wird. Damit wird kein bisher vorgeschriebener Freitext verändert.
- Alle übrigen Energieausweisfelder, Ausstattungsmerkmale, Texte und Abläufe
  bleiben technisch unverändert.

## Dauerhaft sichtbare Versionsanzeige – 23. Juli 2026

### Report

- Eine kleine, fest positionierte Versionsanzeige unten rechts ergänzt. Sie ist
  im Ladebildschirm, bei einem doppelten Tab und in allen vier Arbeitsschritten
  dauerhaft sichtbar.
- Die Versionsnummer für Oberfläche und OpenImmo-Export in einer gemeinsamen
  Konstante zusammengeführt und die Anwendung auf Version 0.9.4 angehoben.

### Begründung

Die Anzeige macht bei Rückfragen und Fehlersuche unmittelbar erkennbar, welcher
Build tatsächlich geöffnet ist. Die zentrale Versionsquelle verhindert, dass
Browseranzeige und `senderversion` im OpenImmo-Paket voneinander abweichen.

### Hürden und Risiken

- Die Anzeige muss über langen Formularen sichtbar bleiben, darf aber keine
  Schaltflächen blockieren. Sie ist deshalb sehr klein, halbtransparent und
  nimmt keine Maus- oder Touch-Eingaben entgegen.

## Einheitliche Überschrift und regionale Excel-Adressbücher – 23. Juli 2026

### Report

- Die Überschrift aus Schritt 2 nach jeder KI-Antwort nochmals lokal erzwungen.
  Schritt 3 kann dadurch keine abweichende Kurzfassung eines älteren
  Helferprozesses mehr übernehmen und kennzeichnet das Feld ausdrücklich als
  **unverändert aus Schritt 2**.
- Einen lokalen deutschen PLZ-Datensatz integriert. Beim Excel-Import werden
  Bundesland und Landkreis aus PLZ plus Ort ermittelt, in den Grundstücksdaten
  angezeigt und im Adresswähler als Gruppen dargestellt.
- Adressen innerhalb der Bundesland-/Landkreis-Gruppen nach PLZ, Ort und Straße
  sortiert. Mehrdeutige Zuordnungen bleiben sichtbar unzugeordnet, statt durch
  eine Schätzung falsch einsortiert zu werden.
- GeoNames-Quelle und CC-BY-4.0-Lizenz dokumentiert; Anwendungsversion auf
  0.9.3 angehoben.

### Begründung

Die verbindliche Überschrift entsteht deterministisch in der Anwendung und
muss in jedem Arbeitsschritt sowie im späteren OpenImmo-Paket identisch sein.
Die Regionszuordnung wird als mitgelieferte Offline-Tabelle ausgeführt, damit
beim Excel-Import keine Grundstücksadressen an einen externen Geodienst
übertragen werden. PLZ und Ort werden gemeinsam geprüft, weil einzelne PLZ in
Deutschland mehrere Orte oder Verwaltungsgebiete umfassen können.

### Hürden und Risiken

- GeoNames stellt die Daten ohne Gewähr bereit. Unklare Kombinationen aus PLZ
  und Ort werden deshalb nicht automatisch einem Landkreis zugeschlagen.
- Bereits gespeicherte Projekte werden beim Laden nachträglich zugeordnet.
  Werden PLZ oder Ort manuell geändert, verwirft die App die bisherige Region;
  beim nächsten Laden erfolgt eine neue Prüfung mit der Offline-Tabelle.
- Die gewünschte 12-Tage-Wiederholungsautomatisierung wurde bewusst nicht
  implementiert; dazu wurde nur ein sicherer Lösungsansatz beschrieben.

## Direkt befüllte Inseratfelder im Grundstücksschritt – 23. Juli 2026

### Report

- Die im Screenshot gezeigte Grundstücksseite so umgebaut, dass Call-to-Action,
  Ausstattung, Sonstiges, Provision, Anmerkung, AGB und Empfehlungstext dort
  sofort vollständig in vergrößerten Feldern stehen.
- Die bisherigen leeren Zusatzfelder für Lage, Verkehr, Versorgung, Natur und
  Hinweise in einen optionalen, standardmäßig geschlossenen Bereich verschoben.
  Bereits vorhandene Inhalte bleiben gespeichert und werden weiterhin genutzt.
- Nach der Hausauswahl zeigt die Seite nur noch die tatsächlich individuellen
  Elemente Überschrift, Objektbeschreibung und Lage je Haus.
- Die KI-Antwort technisch von fünf auf genau zwei Felder reduziert:
  Objektbeschreibung und Lage. Überschrift und alle festen Texte werden nicht
  mehr vom Modell angefordert. Anwendungsversion auf 0.9.2 angehoben.

### Begründung

Das vorgeprüfte Grundstück ist der feste Ausgangspunkt. Deshalb müssen leere
optionale Eingabeflächen den Arbeitsfluss nicht dominieren. Die festen Texte
sind sofort kontrollierbar und die KI verarbeitet nur noch die beiden wirklich
variablen Themen. Das verkürzt Anfrage und Prüfung und verhindert zugleich,
dass vorgeschriebene Formulierungen durch eine Modellantwort verändert werden.

### Hürden und Risiken

- Objektbeschreibung und Lage bleiben je Haus beziehungsweise Ort individuell;
  sie können erst nach einer konkreten Hausauswahl sinnvoll erzeugt werden.
- Zusätzliche Lagefakten werden nur genutzt, wenn sie bereits gespeichert sind
  oder der optionale Bereich bewusst geöffnet und ergänzt wird. Fehlende Fakten
  werden weiterhin nicht erfunden.

## Textvorschau im zweiten Schritt – 23. Juli 2026

### Report

- Unter **Adresse & Auswahl** eine vollständige Textvorschau für jeden
  ausgewählten Haustyp ergänzt. Die erste Vorschau ist geöffnet; weitere Häuser
  lassen sich platzsparend aufklappen.
- Überschrift, Objektbeschreibung, Ausstattung, Lage, Sonstiges, fester
  Call-to-Action, Provision, Anmerkung, AGB und Empfehlungstext bereits vor der
  KI-Erzeugung sichtbar gemacht.
- Bestehende Inserate beim Laden und unmittelbar vor dem Export auf leere
  Textfelder geprüft. Nicht leere individuelle Inhalte bleiben erhalten;
  fehlende dynamische Inhalte erhalten eine lokale Vorbelegung und feste Felder
  die freigegebenen Standardtexte.
- Den lokalen Lage-Rückfall neutral formuliert, ohne fehlende Quelldaten im
  später sichtbaren Inserat zu thematisieren. Anwendungsversion auf 0.9.1
  angehoben.

### Begründung

Die Texte sind damit bereits im zweiten Arbeitsschritt transparent und können
vor der kostenpflichtigen KI-Erzeugung kontrolliert werden. Eine gemeinsame
Vervollständigungsfunktion wird beim Laden, in der Vorschau und beim Export
verwendet. Dadurch entsteht kein Unterschied zwischen sichtbarer Vorbelegung
und tatsächlich übertragenem Inhalt.

### Hürden und Risiken

- Lage-, Verkehrs- und Versorgungsdaten werden weiterhin nicht erfunden. Fehlen
  bestätigte Angaben, verwendet die lokale Vorbelegung ausschließlich einen
  neutralen Orts- beziehungsweise Ortsteiltext.
- Die lokale Vorbelegung ersetzt nicht die individuelle KI-Fassung. Nach der
  Erzeugung bleiben Objektbeschreibung und Lage im dritten Schritt prüf- und
  bearbeitbar.

## Verbindliche Inserattexte und Immoprofessional-Merkmale – 23. Juli 2026

### Report

- Überschriftenformat auf emotionalen Einstieg plus Ort/Ortsteil, gerundete
  Wohnfläche, Zimmerzahl und zwei Vorteile aus der Living-Haus-Checkliste
  umgestellt.
- Objektbeschreibung als individuelle, emotionalere KI-Fassung umgesetzt und
  den vorgegebenen Telefon-Call-to-Action idempotent als festen Abschluss
  ergänzt.
- Ausstattung und Sonstiges wortgetreu zentral hinterlegt. Provision,
  Anmerkung, Allgemeine Geschäftsbedingungen und freier Empfehlungstext als
  weitere geschützte Pflichttexte in Vorschau und OpenImmo-Export aufgenommen.
- OpenImmo-Ausstattung um Dachboden, Gäste-WC, Gartennutzung,
  Fußbodenheizung, Elektro/Luft-Wärmepumpe, KFW40, KFW55, Energieklasse A++,
  offene Einbauküche sowie Bad mit Dusche, Wanne und Fenster ergänzt.
- Provision über die OpenImmo-Standardfelder `provisionspflichtig` und
  `courtage_hinweis` übertragen; die drei Immoprofessional-Zusatztexte als
  benannte `user_defined_simplefield`-Felder im Freitextblock ergänzt.
- Vorhandene Kataloge werden beim Laden auf die festen Energie- und
  Heizungswerte migriert. Anwendungsversion auf 0.9.0 angehoben.

### Begründung

Die dynamischen Inhalte und die rechtlich beziehungsweise vertrieblich
vorgegebenen Inhalte sind jetzt technisch getrennt. Die KI erhält nur die
Aufgabe, Hausgefühl und Lage individuell zu formulieren; eine zentrale
Nachbearbeitung setzt Überschrift und Pflichttexte deterministisch ein. Dieselbe
Nachbearbeitung läuft erneut beim Export, damit manuelle Änderungen oder ältere
lokale Entwürfe keine Pflichtangabe entfernen können. Die Ausstattungsmerkmale
verwenden die dafür vorgesehenen OpenImmo-1.2.7-Elemente und deren definierte
Reihenfolge.

### Hürden und Risiken

- KFW40 und KFW55 werden auf ausdrückliche Vorgabe gleichzeitig übertragen.
  Ob ein angeschlossenes Immobilienportal beide Werte gemeinsam darstellt,
  entscheidet dessen Importprofil.
- Immoprofessional dokumentiert die kontospezifische Zuordnung seiner drei
  zusätzlichen Freitextmasken nicht öffentlich. Die Daten werden
  standardkonform als benannte OpenImmo-Erweiterungsfelder geliefert; ihre
  konkrete Zuordnung muss beim ersten nicht veröffentlichten Testimport im
  Importbericht kontrolliert werden.
- Förderbedingungen können sich ändern. Überschriften verwenden deshalb
  Checklisten-Vorteile und QNG-Potenzial ohne aktuelle Fördersumme oder
  individuelle Förderzusage.
- Die gelieferten Pflichttexte enthalten bewusst die vom Auftraggeber
  vorgegebenen Schreibweisen. Sprachliche oder rechtliche Änderungen erfolgen
  nur nach ausdrücklicher fachlicher Freigabe.

## Fertiger 18-Häuser-Startkatalog – 23. Juli 2026

### Report

- 18 sofort nutzbare Hausvorlagen aus der freigegebenen iCloud-Bibliothek
  zusammengestellt: die bestätigten 14 SUN-Modelle sowie SOL 101, SOL 107,
  SOL 110 und SUN 113.
- Für jede Vorlage eine konkrete Hausansicht mit LivingHaus-Logo, sechs
  Innenraummotive, emotionalen Catch, versionsgenaue Grundrisse,
  Auszeichnungen, Vertrauensmotiv und QR-Abschluss hinterlegt.
- Zimmer, Schlafräume, Bäder und Etagen anhand der ausgewählten Grundrisse
  modellgenau erfasst. SOL 101, SOL 107 und SOL 110 verwenden als Bungalows nur
  das Erdgeschoss; alle SUN-Vorlagen enthalten Erd- und Ober-/Dachgeschoss.
- Die bestätigten Modellpreise automatisch übernommen. SUN 113 bleibt mit
  Hauspreis 0 bewusst offen, weil dafür keine belastbare Preisquelle vorliegt.
- Eine abgesicherte Katalogmigration ergänzt, die ausschließlich die beiden
  leeren Startplatzhalter ersetzt. Echte Haustypen werden nicht überschrieben;
  Anbieter-, Projekt-, Aktionsbild- und Schlüsselbunddaten bleiben erhalten.
- Optimistische Versionsprüfung für die macOS-Katalogsicherung ergänzt. Ein
  noch geöffneter alter Browser-Tab erhält HTTP 409 und kann einen inzwischen
  neueren Gerätekatalog weder beim Helfer-Neustart noch während eines parallelen
  Speichervorgangs überschreiben.
- Gemeinsame Bilder werden nur einmal in der lokalen Gerätesicherung abgelegt
  und beim Laden dedupliziert. Anwendungsversion auf 0.8.0 angehoben.

### Begründung

Die Vorlagen werden deterministisch aus exakten, versionsbezeichneten
Quelldateien aufgebaut. Damit stimmen Titelbild, Grundriss und Bildreihenfolge
bereits beim ersten Öffnen überein. Stabile Bild-IDs vermeiden unnötige Kopien
der wiederverwendeten Innenraum- und Vertrauensmotive. Die Migration arbeitet
gegen die bestehende Gerätesicherung, damit Zugangskonfiguration und Projekte
nicht neu eingerichtet werden müssen.

### Hürden und Risiken

- Mehrere Hausansichten liegen doppelt im Übersichts- und Modellordner. Für den
  Katalog wird bewusst die eindeutige Übersichtsversion verwendet; der
  Grundriss wird weiterhin über Modell, Version, Dachform und Etage ermittelt.
- SUN 113 besitzt im gelieferten Preisausschnitt keinen Preis. Vor einem
  produktiven Inserat muss dieser Wert fachlich ergänzt werden.
- Die 61 eindeutigen Bilddateien belegen lokal rund 110 MB. Die Originale
  bleiben unverändert in iCloud; die App-Sicherung erhält eine eigene Kopie.
- Die automatische Migration verweigert den Lauf, sobald ein nicht leerer
  Haustyp im Zielkatalog erkannt wird. Das schützt vorhandene Nutzerdaten,
  erfordert bei späteren individuellen Katalogen jedoch eine bewusste manuelle
  Zusammenführung.
- Beim ersten Kaltstarttest überschrieb ein noch offener Browser-Tab den frisch
  installierten Katalog, sobald der lokale Helfer wieder erreichbar war. Die
  Speicherung verlangt deshalb jetzt den zuletzt gelesenen Sicherungszeitpunkt
  und prüft ihn vor Vorbereitung und Commit erneut.

## Zertifikatskonformer Immoprofessional-Host – 23. Juli 2026

### Report

- Standardhost für explizites FTPS auf `server22.immoprofessional.eu`
  umgestellt.
- Die bisherigen Hosts `fabianraebel.livinghaus.info` und
  `pascalfroehlich.livinghaus.info` werden beim Laden, Prüfen und Speichern
  automatisch auf den kanonischen Host migriert.
- Zugangstest normalisiert die Zielkonfiguration jetzt vor dem TLS-Aufbau. Damit
  kann eine erneut eingetragene Altadresse den Zertifikatsfehler nicht mehr
  auslösen.
- Oberfläche erläutert den korrekten Host; Zertifikatskette und Hostname werden
  weiterhin strikt geprüft. Es wurde keine unsichere Ausnahme ergänzt.
- Anwendungsversion auf 0.7.1 angehoben.

### Begründung

Beide LivingHaus-Aliase zeigen auf `82.165.70.71`, deren kanonischer
Reverse-DNS-Name `server22.immoprofessional.eu` ist. Der Server liefert ein
gültiges Zertifikat ausschließlich für `*.immoprofessional.eu` und
`immoprofessional.eu`. Der kanonische Name zeigt auf dieselbe IP und entspricht
dem Zertifikat. Eine Hostmigration löst deshalb den Fehler, ohne die
TLS-Sicherheitsprüfung abzuschwächen.

### Hürden und Risiken

- Eine Verbindung über den bisherigen Alias erreicht technisch den richtigen
  Server, muss aber wegen des fehlenden Zertifikatsnamens abgewiesen werden.
- Der zuvor fehlgeschlagene Zugangstest wurde absichtlich nicht gespeichert.
  Benutzername und Passwort müssen einmal mit dem neuen Host geprüft und danach
  im macOS-Schlüsselbund gespeichert werden.
- TLS-Aufbau, Zertifikatskette, Hostname und Serveridentität sind technisch
  verifiziert. Anmeldung und Zielordner lassen sich erst mit dem konkreten
  Immoprofessional-Zugang vollständig bestätigen.
- Falls Immoprofessional den Server künftig verlegt, muss der offiziell
  zugewiesene, zertifikatsgedeckte Host erneut geprüft werden.

## Modellbasierter Hauspreiskatalog – 23. Juli 2026

### Report

- 29 bereitgestellte Hauspreise für Bungalows, Einfamilienhäuser,
  Doppelhaushälften und Zweifamilienhäuser als geprüften lokalen Katalog
  hinterlegt.
- Bildversionen V1, V2, V3 usw. aus der Preisidentifikation entfernt. SUN 126
  und SUN 165 verwenden modellweit den bestätigten niedrigeren Listenpreis von
  365.073 € beziehungsweise 426.931 €.
- L und XL bei SOL 117 und SOL 125 als eigenständige Preismodelle umgesetzt.
  Die App verwendet bei generischen Titelbildern die genauere L-/XL-Kennung der
  zugeordneten Grundrisse.
- Hauspreis und Objektart werden beim Erstellen einer vollständigen Bildfolge
  automatisch gesetzt. Bei manueller Änderung zeigt die Hausmaske den
  erkannten Listenwert und bietet eine kontrollierte Wiederübernahme an.
- Unbekannte oder mehrdeutige Modelle werden nicht geschätzt; ihr bestehender
  Hauspreis bleibt unverändert.
- Reale Bibliothek geprüft: 65 der 71 vollständig verwendbaren Bildvarianten
  erhalten einen Preis für 26 aktuell vorhandene Katalogmodelle. Für sechs
  Bildvarianten wurde kein Preis geliefert; sie bleiben bewusst offen.
- Anwendungsversion auf 0.7.0 angehoben.

### Begründung

Der Preis wird nicht an eine austauschbare Visualisierung, sondern an das
fachliche Hausmodell gebunden. Ein eigener, getesteter Resolver entfernt
Dachform- und Versionsangaben, wertet L/XL aber weiterhin als Bestandteil des
Modells. Dadurch erhalten beispielsweise alle SUN-126-Bildvarianten denselben
Preis, während SOL 125 L und SOL 125 XL nicht vermischt werden.

### Hürden und Risiken

- SUN 126 und SUN 165 waren in der Quelle jeweils doppelt mit unterschiedlichen
  Grundrissausführungen und Preisen vorhanden. Nach ausdrücklicher Freigabe ist
  jeweils der niedrigere Preis hinterlegt.
- Die Titelbilder von SOL 124 und SOL 125 tragen teilweise keine L-/XL-Kennung.
  Für die Zuordnung werden deshalb die bereits versionsgenau ausgewählten
  Grundrissdateien mit ausgewertet.
- Für SUN 107, SUN 112, SUN 113 und SUN 155 liegt im bereitgestellten Ausschnitt
  kein Hauspreis vor. Diese Werte werden weder abgeleitet noch durch ähnliche
  Modelle ersetzt.
- Der Katalog bildet den bereitgestellten Preisstand ab und aktualisiert sich
  nicht selbst. Neue Preislisten müssen vor produktiver Nutzung fachlich
  abgeglichen und versioniert eingepflegt werden.

## Automatische Exposé-Bildfolge – 23. Juli 2026

### Report

- Elf vorhandene Beispiel-Exposés visuell auf Bildauswahl, Reihenfolge und
  wiederkehrende Beschriftungen geprüft.
- Rollenbasierte Standardfolge aus Hausansicht, sechs unterschiedlichen
  Innenräumen, emotionalem Catch, versionsgenauen Grundrissen, Auszeichnungen,
  Vertrauensmotiv und QR-Abschluss implementiert.
- Aktionsmodus beibehalten: Aktionsbild an Position 1, Hausansicht an Position 2;
  bei mehr als 14 Gesamtbildern blockiert die Prüfung, ohne ein Bild zu löschen.
- SUN-/SOL-Modell, Version, Dachform und Etage aus den bestehenden Dateinamen
  ermittelt. Grundrisse werden immer als EG vor OG/DG und optionaler dritter
  Etage eingeordnet.
- SOL 82, SOL 101, SOL 107 und SOL 110 als reine EG-Bungalows berücksichtigt.
- Die Einrichtungsmotive aus `01_RENDERING/Inneneinrichtung` direkt in die
  Medienbibliothek aufgenommen; Bad und Büro werden aus `04_ANZEIGEN` ergänzt.
- Feste Überschriften gegen manuelle und KI-gestützte Überschreibung geschützt.
  Nur der Titeltext und die Reihenfolge innerhalb der sechs Innenräume bleiben
  variabel.
- Rolle, Vollständigkeit, Duplikate, Reihenfolge und 14-Bilder-Grenze werden vor
  dem OpenImmo-Paket geprüft. Manuell importierte Altbestände bleiben kompatibel.
- Reale Bibliothek mit 665 unterstützten Dateien geprüft: 71 der 79
  Hausansichten im Übersichtsordner ergeben direkt eine vollständige Folge.
  Sieben Varianten werden wegen fehlender exakter Grundrisse sicher blockiert;
  `SUN V8.png` wird wegen der fehlenden Modellnummer abgewiesen.
- Anwendungsversion auf 0.6.0 angehoben.

### Begründung

Explizite Bildrollen sind belastbarer als eine reine Sortierung nach
Dateinamen. Die Dateinamen bleiben die Quelle für die automatische Erkennung,
die erkannte Rolle wird anschließend jedoch mit dem Haustyp gespeichert und
beim OpenImmo-Export erneut geprüft. Damit bleibt die gewünschte Reihenfolge
auch nach manuellen Änderungen stabil. Bei uneindeutigen oder fehlenden
Grundrissen wird bewusst keine vermeintlich ähnliche Version eingesetzt.

### Hürden und Risiken

- Der Bestand verwendet unterschiedliche Schreibweisen, Ordnerstufen und teils
  direkt im Haustypordner liegende Grundrisse. Die Erkennung deckt sowohl
  Grundrissordner als auch die Etagenkürzel EG, OG und DG im Dateinamen ab.
- Die Grundrisse für `SOL 183 V2`, `SOL 204 V11`, `SOL 242 V3`, `SOL 242 V6`,
  `SUN 113 V1`, `SUN 113 V9` und `SUN 126 V9` fehlen in der bereitgestellten
  Bibliothek. Diese Varianten bleiben bis zur Ergänzung gesperrt.
- `SUN V8.png` enthält keine Modellnummer und kann deshalb keinem Haustyp
  sicher zugeordnet werden.
- Eine Folge mit seltener dritter Etage umfasst bereits 14 Standardbilder. Ein
  zusätzliches Aktionsbild würde das Portal-Limit überschreiten und muss für
  diesen Export deaktiviert werden.
- Die fachliche Motivqualität und das LivingHaus-Logo müssen beim ersten
  produktionsnahen Import weiterhin visuell im Immoprofessional-Entwurf geprüft
  werden.

## GitHub-Workflow-Integration für macOS – 23. Juli 2026

### Report

- GitHub-Stand `f875699` aus `agent/inseratstudio-workflow-updates` analysiert
  und konfliktfrei in den vorhandenen macOS-Feature-Branch übernommen.
- Maximale Hausbibliothek von 12 auf 18 Haustypen erweitert.
- Getrennte lokale Adressansichten für Fabian und Pascal mit ausdrücklichem
  Speichern und Migration bestehender Adressen zu Fabian ergänzt.
- Excel-Massenimport mit Dublettenprüfung, Fehlermeldungen, deutschen
  Zahlenformaten und geprüfter `.xlsx`-Vorlage integriert.
- Zentrales Aktionsbild eingeführt, das optional als Bild 1 in Auswahl,
  Vorschau, Sicherung, XML und ZIP für alle Haustypen verwendet wird.
- KI-Überschriften auf 3 bis 8 Wörter und 18 bis 60 Zeichen begrenzt;
  Haus-/Modellbezeichnungen, Doppelpunkte und Ausrufezeichen werden abgewiesen.
- Version auf 0.5.0 angehoben und `read-excel-file` 9.3.4 ergänzt.
- Zusätzlich zur GitHub-Fassung Größenlimits von 10 MB für Excel-Dateien und
  25 MB für Aktionsbilder implementiert.

### Begründung

Die GitHub-Erweiterungen wurden nicht als direkter Merge eingespielt, weil der
macOS-Port bereits tiefgreifende, noch nicht eingecheckte Änderungen an denselben
Dateien enthält. Die Funktionen wurden auf Quellhunk-Ebene übernommen und an
Schlüsselbund, Sitzungsauthentifizierung, macOS-Datensicherung, iCloud-Bibliothek
und die strengere OpenImmo-Prüfung angepasst. So bleiben die Sicherheits- und
Plattformverbesserungen erhalten, während alle neuen Workflows verfügbar sind.

### Hürden und Risiken

- GitHub- und macOS-Stand ändern dieselbe zentrale React-Komponente, die
  Katalogsicherung und den OpenImmo-Export; ein automatischer Merge hätte
  Sicherheits- und Funktionsänderungen überschreiben können.
- Die getrennten Adressbücher sind eine organisatorische UI-Trennung innerhalb
  desselben macOS-Benutzerkontos, keine kryptografische Mandantentrennung.
- Excel-Inhalte werden lokal verarbeitet; fachlich falsche, aber formal gültige
  Daten müssen weiterhin vor der Textgenerierung geprüft werden.
- Die GitHub-Normalisierung verwarf in „Grundstücksfläche m²“ die hochgestellte
  Zwei und importierte die Fläche dadurch als 0. Die macOS-Fassung nutzt eine
  Unicode-Kompatibilitätsnormalisierung; ein Test liest dafür die tatsächlich
  ausgelieferte Excel-Datei durch denselben Parser wie die App.
- Das Aktionsbild verändert die exportierte Bildreihenfolge und muss beim ersten
  Immoprofessional-Test anhand von XML, ZIP und Importbericht kontrolliert werden.

## Direkte iCloud-Medienbibliothek – 22. Juli 2026

### Report

- 655 unterstützte, bereits beschriftete Bilder aus `04_ANZEIGEN` direkt in die
  Haustyp-Bearbeitung eingebunden.
- Ordner und Dateinamen automatisch in Hausansichten, Grundrisse,
  Standortmotive und allgemeine Anzeigen klassifiziert.
- Suche, Gruppenfilter, Motivfilter, paginierte Vorschau, Mehrfachauswahl und
  gesammelte Übernahme in einen Haustyp implementiert.
- Grundrisse beim Import automatisch markiert und vorhandene Dateibeschriftungen
  als editierbare Bildtexte übernommen.
- Stabile Quell-IDs gegen Doppelimporte und einen konfigurierbaren Medienpfad
  über `FPI_MEDIA_LIBRARY_ROOT` ergänzt.
- Medienindex und Fehlerfall eines fehlenden iCloud-Ordners automatisiert
  getestet.
- Den Medienindex für 15 Minuten im lokalen Helfer zwischengespeichert und
  einzelne iCloud-Dateiabrufe auf 45 Sekunden begrenzt, damit Platzhalter die
  Bibliothek nicht dauerhaft blockieren.
- Die macOS-Inventur auf den nativen, inhaltsfreien Dateiscan umgestellt, weil
  Apples iCloud-Dateianbieter asynchrone Node-Verzeichnisabfragen nach einem
  festhängenden Platzhalter blockieren kann.
- Acht-Sekunden-Zeitlimit und konkrete Anleitung für die einmalige
  macOS-Dateiberechtigung des Terminal-Startknopfs ergänzt.

### Begründung

Die App greift lesend auf den bestehenden iCloud-Bestand zu, statt 655 Dateien
in das Projekt zu kopieren. Dadurch bleibt die vorhandene Ordnung führend, die
App klein und der iCloud-Traffic bedarfsgesteuert. Der Browser erhält keine
lokalen Dateipfade und keine Sitzungstoken in Bild-URLs; der lokale Helfer gibt
nur indexierte Dateien über HMAC-signierte URLs aus. Erst bewusst ausgewählte
Bilder werden in den lokalen Haustyp und dessen Sicherung übernommen.

### Hürden und Risiken

- Der Bestand enthält lokale und nur in iCloud vorgehaltene Dateien. Eine noch
  nicht geladene Datei kann beim ersten Vorschaubild eine Verzögerung verursachen;
  nach 45 Sekunden bricht der Helfer kontrolliert ab und verweist auf Finder.
- Ältere TIFF-Dateien sind nicht eingebunden, weil der OpenImmo-Export und die
  Browservorschau aktuell nur JPEG, PNG und WebP zulassen.
- Die Dateinamen sind fachliche Beschriftungen, enthalten teilweise aber
  technische Variantenkürzel. Diese werden absichtlich erhalten und können vor
  dem Export in der App bearbeitet werden.
- Wird der Anzeigenordner verschoben, muss der neue Pfad über
  `FPI_MEDIA_LIBRARY_ROOT` konfiguriert werden.

## macOS-Portierung – 22. Juli 2026

### Report

- Nativen macOS-Startknopf mit Laufzeiterkennung, Portprüfung, Sitzungsaufbau,
  Protokollierung und Browserstart ergänzt.
- Datenpfade auf `~/Library/Application Support` umgestellt.
- Zugangstresor auf den macOS-Schlüsselbund portiert.
- Secrets aus Browser-Antworten und Upload-Headern entfernt.
- Sitzungsauthentifizierung für sämtliche lokale Helfer-Endpunkte eingeführt.
- FTPS mit Zertifikatsprüfung und Zugangstest implementiert.
- Gezielte Auswahl einzelner Inserate vor dem Upload ergänzt.
- OpenImmo-Vorabprüfung für Adresse, Grundstücksfläche, Anbieter, Objekt-IDs,
  Preise, Pflichttexte sowie 4 bis 14 unterstützte Bilder ergänzt.
- Nicht mehr benötigte Cloud-Hosting-Kopplung aus dem lokalen Mac-Build entfernt.
- Next auf 16.2.11 aktualisiert und gepatchte `sharp`-/`postcss`-Versionen gegen
  die beim Audit gefundenen CVEs fest vorgegeben.
- Oberfläche und Dokumentation vollständig auf macOS angepasst.

### Begründung

Der bestehende React/OpenImmo-Kern ist plattformneutral und wurde deshalb
beibehalten. Native macOS-Dienste werden nur im lokalen Node-Helfer verwendet.
Diese Trennung minimiert Portierungsrisiken, bewahrt die vorhandene Datenlogik
und verhindert, dass Browsercode Zugriff auf dauerhaft gespeicherte Geheimnisse
erhält. FTPS ist die kleinste kompatible Härtung der bestehenden
Immoprofessional-Importstrecke.

### Hürden und Risiken

- Die ursprüngliche Implementierung war in Launcher, Pfaden, DPAPI und Texten
  eng an Windows gebunden.
- Die tatsächlichen FTPS-Fähigkeiten des konkreten Immoprofessional-Zugangs
  müssen mit dem Anbieterzugang validiert werden.
- Ohne dokumentierte Immoprofessional-Status-API kann die App einen erfolgreichen
  Transfer bestätigen, aber nicht die fachliche Annahme des Imports.
- Eine spätere Verteilung außerhalb dieses Macs benötigt Apple-Signierung und
  Notarisierung; der aktuelle Startknopf ist für den lokalen Workflow bestimmt.
# Unreleased · Livinghaus-Statusordner für Importberichte – 8. September 2026

## Report

- Den read-only Immoprofessional-Berichtpfad vom bisherigen Livinghaus-Ordner
  `Inseratestudio – Importberichte` auf den vorhandenen direkten Ordner
  `21_Statusmeldungen` umgestellt.
- Import- und DELETE-Berichte bleiben streng an das Livinghaus-Konto, den exakt
  einmal vorhandenen Zielordner, Message-ID, Raw-Hash und Objektnummer gebunden.
- Der Inbox-Fallback bleibt außerhalb des historischen Live-Canary-Adapters
  verboten. Der produktive Helper verschiebt, löscht oder markiert weiterhin
  keine E-Mail.
- Die serverseitige Outlook-/Exchange-Regel muss ausschließlich Mails mit dem
  Betreffbestandteil `Importbericht OpenImmo XML` direkt nach
  `21_Statusmeldungen` zustellen.

## Begründung

Der bereits für Livinghaus-Statusmeldungen vorgesehene Ordner hält technische
Immoprofessional-Berichte aus dem Posteingang fern. Die Änderung erfolgt an der
read-only Quelle des Helpers und an der serverseitigen Zustellregel gemeinsam,
damit keine Bestätigung zwischen zwei Ordnern verloren geht.

## Hürden und Risiken

- Regel und Helper müssen in dieser Reihenfolge kontrolliert umgestellt werden:
  zuerst getestete Runtime bereitstellen, danach die serverseitige Regel
  aktivieren. Eine nur einseitige Umstellung würde Berichte unsichtbar machen.
- `21_Statusmeldungen` darf dauerhaft nicht mehr als 500 Nachrichten enthalten;
  andernfalls stoppt der Adapter weiterhin fail-closed.
- Der offene DELETE für `30460-708152` wird durch die Ordnerumstellung nicht
  nachträglich bestätigt. Ohne objektbezogenen Bericht oder einen separat
  freigegebenen Evidenzvertrag bleibt er `delete_pending_confirmation`.

## Bedienprüfung der lokalen Installation – 15.09.2026

- Inseratsmanager zeigt den gesamten persistenten Katalog statt nur der Arbeitsauswahl. So bleiben bei leerer Auswahl veröffentlichte Inserate und terminale Historie sichtbar.
- Zeitplan-Konfiguration wird nicht mehr als tatsächliche Produktionsfreigabe dargestellt; irreführende Aussagen zu Fehlerisolation und dauerhaft deaktiviertem DELETE entfernt.
- Reine Anzeigeänderung: keine Scheduler-, Upload- oder DELETE-Freigabe geändert. Integrationstest schützt die Auswahlunabhängigkeit. Die historische Katalogprüfung bleibt eine notwendige Produktionssperre.
