# Immoprofessional Delete Contract Discovery

Stand: 13. August 2026
Status: Einzel-Canary bestätigt; allgemeine automatische Löschung bleibt deaktiviert

## 0. Immoprofessional real beobachtet: Einzel-Canary 30460-287191

Am 13. August 2026 wurde mit ausdrücklicher Einzelfreigabe genau ein
schema-valides OpenImmo-DELETE für `30460-287191` übertragen. Die reale,
akzeptierte Payload besaß:

- OpenImmo `1.2.7`, Anbieter-ID `30460`;
- `uebertragung/@umfang="TEIL"` und `modus="DELETE"`;
- genau ein `immobilie`-Element und genau eine Aktion
  `aktionart="DELETE"`;
- `objektnr_extern`, `openimmo_obid` und `kennung_ursprung` jeweils exakt
  `30460-287191`;
- ZIP-Datei `delete-30460-287191-20260813T162619Z.zip`, 794 Bytes;
- SHA-256
  `695ee1968658b11e8829b1187bf8a0590cc50ccb059a7919e030d8c3245ef7d3`.

Der explizite FTPS-Transfer an den bestehenden Immoprofessional-Kanal begann
um `2026-08-13T16:26:19.337Z` und endete um
`2026-08-13T16:26:20.084Z`. Es wurde genau ein Paket übertragen, ohne Retry.

### Realer Providerbericht

Der serverseitig verwaltete Ordner
`Livinghaus / Inseratestudio – Importberichte` erhielt den echten Bericht mit
Betreff `Importbericht OpenImmo XML`. Transportherkunft und SPF waren gültig;
der beweisgesicherte Raw-Inhalt besitzt SHA-256
`587b300529571578a25595f977b3855599b6c7fdf69cac304c1b551011eefdbb`.
Der Plaintext nennt:

- Verarbeitungszeitpunkt `13.08.2026 18:26` Europe/Berlin;
- Sendersoftware `Fabian&Pascal Inseratestudio`;
- Objektanzahl `1`, Anbieter-ID `30460`;
- `OK: Objekt-Nr.: "30460-287191"`;
- Status `Erfolgreich gelöscht -`;
- explizite Löschungen aus Immobilienscout24, Immowelt,
  `www.livinghaus.de` und Ebay-Kleinanzeigen;
- keine Fehler und keine Warnung.

Die Providerreaktion ist damit Klassifikation **A**. Ein enger Parser akzeptiert
nur diesen positiven Einzelobjektvertrag mit exakter Canary-Nummer, gültigem
server22-Transport, `SPF=pass`, freigegebener Sendersoftware und Anbieter-ID.
Message-ID und Raw-Hash werden idempotent im separaten Delete-Ledger gebunden.
FTPS-Erfolg, Zeitablauf oder das Fehlen eines Fehlers reichen weiterhin nicht.

Eine read-only Portalprüfung war nicht möglich: Der vorhandene Browser besaß
keine autorisierte Immoprofessional-Sitzung und führte nur auf den Plesk-Login.
Es wurde kein Login versucht und keine Portalmutation ausgeführt. Der eindeutige
Providerbericht ist deshalb der maschinelle Löschbeleg; es wird keine zusätzliche
Portalbeobachtung durch den automatisierten Lauf behauptet.

Nach Abschluss des automatisierten Laufs wurden zwei zusätzliche Evidenzen
festgehalten:

- Eine zeitgleiche, lokal read-only geprüfte Immowelt-Nachricht nennt
  `Obj. gelöscht: 1`, die Referenznummer `30460-287191` und den Status
  `gelöscht`.
- Der Nutzer bestätigte zusätzlich einen Kleinanzeigen-Bericht mit
  `Gelöschte Objekte: 1`, `Erfolgreich gelöschte Objekte` und der Objekt-Nr.
  `30460-287191` sowie eine manuelle read-only Portalkontrolle, bei der das
  Objekt in Immoprofessional nicht mehr vorhanden war. Diese beiden Angaben
  sind ausdrücklich als nutzerbestätigte Evidenz dokumentiert und wurden nicht
  nachträglich als autonome Portalaktion reproduziert.

Ergebnis des Einzelvertrags:
`DELETE_CONTRACT_CONFIRMED_WITH_MACHINE_CONFIRMATION`. Das bedeutet nicht,
dass eine allgemeine Delete-Automatik aktiviert ist. Der separate Betriebsmodus
steht wieder auf `off`, unterstützt kein `active`, und jedes Ziel außer
`30460-287191` bleibt hart blockiert.

## 1. Ausgangslage

Die Neuerstellungskette ist bis zur positiven Immoprofessional-
Importbestätigung produktiv belegt. Danach bleibt die alte Quelle absichtlich
`published`, wird aus der automatischen Rotation entfernt und erhält
`externalDeletionPending: true`. Der aktuelle Code erzeugt weder einen
Delete-Payload noch einen Delete-Upload oder eine Portalaktion.

Für diese Discovery wurden keine Inserate, Katalogdaten oder Portalzustände
verändert. Es gab keinen Upload, kein Rename, kein Move und kein Delete. Der
einmalige FTPS-Check bestand ausschließlich aus Connect, PWD und LIST; das
konfigurierte Verzeichnis `/` enthielt keine Dateien oder Unterverzeichnisse.

## 2. Aktueller Replacement-Workflow

Der bestätigte Ablauf lautet:

```text
published source
→ fällige Background-Rotation
→ prepared replacement
→ FTPS
→ transferred_pending_import
→ positiver, eindeutig korrelierter Importbericht
→ replacement published
→ source weiterhin published, aber nicht mehr rotationsfähig
→ externalDeletionPending
```

Ein FTPS-Transfer ist nur Transport. Erst der validierte Importbericht setzt das
Replacement auf `published`. Dieselbe Trennung ist für eine spätere Löschung
zwingend: Delete-Transport ist keine Delete-Bestätigung.

## 3. Vorhandene Delete-Bausteine im Code

### Tatsächlich vorhanden

- `WORKFLOW_STATUS.DELETED` und `WORKFLOW_STATUS.ARCHIVED` sind allgemeine
  interne Statuswerte. Kein Transport setzt sie für Immoprofessional.
- `automaticDeletionEnabled` existiert im Datenmodell und in einer
  Blockgrundprüfung.
- `listingDeletionBlockReasons()` prüft unter anderem Modus, Premium-Sperre,
  manuelle Sperre und das Vorhandensein einer neuen Anzeige.
- Die bestehende Upload-Job-ID, das persistente Jobledger, Prozess-Leases und
  der Katalog-CAS zeigen die für einen späteren Delete-Job geeigneten
  Idempotenz- und Concurrency-Muster.

### Absichtlich deaktiviert

- `automaticDeletionEnabled` ist im Gruppenstandard `false`, wird bei jeder
  Gruppennormalisierung auf `false` gesetzt und auch in jedem gespeicherten
  Listing-Control auf `false` normalisiert.
- Importbestätigung setzt den Wert für Quelle und Replacement explizit auf
  `false`.
- UI und Scheduler beschreiben selbst `full-auto` ausdrücklich als Betrieb
  ohne Löschen.

### Nicht vorhanden

- kein Delete-Payload-Generator;
- kein Delete-FTPS-Auftrag;
- kein Delete-Jobledger;
- kein Delete-Claim oder Delete-Lease;
- kein Delete-Report-Parser;
- keine positive Delete-Bestätigung;
- keine automatische oder manuelle produktive Delete-CLI;
- kein Portal-Delete-Pfad.

Die vorhandenen Statuswerte und Flags sind damit Sicherheits- bzw.
Kompatibilitätsstrukturen, kein bereits bewiesener Providervertrag.

## 4. Tatsächlicher oder unbekannter Provider-Delete-Kanal

### OpenImmo-Standard

Das offizielle OpenImmo-1.2.7d-Schema vom Juni 2026 belegt zwei semantische
Delete-Angaben:

- `uebertragung/@umfang="TEIL"` beschreibt einen inkrementellen Abgleich, der
  auch zu löschende Objekte enthalten kann;
- `uebertragung/@modus` kennt `DELETE` mit informierendem Charakter für einen
  Löschfall ohne Immobilien-Element;
- `verwaltung_techn/aktion/@aktionart` kennt `DELETE` als objektbezogene
  Löschaktion.

Quelle: [offizielles OpenImmo-1.2.7d-Paket](https://www.openimmo.de/xdata/openimmo-version_127d.zip).
OpenImmo beschreibt jedoch ein XML-Datenformat und keinen einheitlichen
Transport- oder Bestätigungsdienst. Der Empfänger entscheidet, welche Varianten
er akzeptiert. Quelle: [OpenImmo-Prinzip](https://www.openimmo.de/go.php/p/12/cm_prinzip.htm).

### Immoprofessional

Immoprofessional dokumentiert öffentlich OpenImmo-XML-Importe und Änderungen
aus Offline-Software. Die untersuchte öffentliche Beschreibung nennt keinen
Delete-Aktionswert, keinen Delete-Payload und keine Delete-Bestätigung. Quelle:
[Immoprofessional Schnittstellen](https://www.immoprofessional.com/de/immobilienwebseite-schnittstellen/).

Der produktiv verwendete FTPS-Kanal ist für `CHANGE`-Importe real belegt. Der
read-only FTPS-Verzeichnischeck fand aber weder Rückdateien noch spezielle
Delete-Verzeichnisse oder technische Dokumentation. Ein leeres Verzeichnis ist
kein Beweis gegen Delete-Unterstützung.

Bewertung: `DELETE_CHANNEL_PARTIALLY_CONFIRMED`. Der Datenstandard besitzt einen
Delete-Vertrag und Immoprofessional akzeptiert OpenImmo über den bestehenden
Transport. Die konkrete Immoprofessional-Unterstützung für `DELETE`, die
erwartete Payload-Variante und deren produktiver Eingang sind nicht bestätigt.

## 5. Objektadressierung

Der aktuelle CHANGE-Export verwendet:

- Anbieter-ID: `provider.providerNumber` in `anbieter/anbieternr` und
  `uebertragung/@regi_id`;
- externe Objektnummer: `listing.externalId`;
- `openimmo_obid`: `listing.externalId`;
- `kennung_ursprung`: `listing.externalId`;
- Aktion: fest `CHANGE`;
- Senderkennung: `Fabian&Pascal Inseratestudio` plus Anwendungsversion.

Das offizielle Schema bezeichnet `openimmo_obid` als eindeutigen Identifikator
und verlangt in `verwaltung_techn` zusätzlich `objektnr_extern`. Der aktuelle,
von Immoprofessional für CHANGE akzeptierte Export enthält
`objektnr_extern` nicht und verwendet außerdem eine vom Schema nicht definierte
`timestamp`-Eigenschaft an `aktion`. Diese Provider-Toleranz bei CHANGE darf
nicht auf DELETE übertragen werden.

Für einen späteren Delete ist die einzige zulässige fachliche Quelle der
Identität `source.externalId`. Sie wäre Kandidat für sowohl
`objektnr_extern` als auch `openimmo_obid`. Ob Immoprofessional zum Löschen
eines oder beide Felder verlangt und ob `kennung_ursprung` beteiligt ist, ist
nicht belegt. Adresse, Titel, Hausname und Zeitstempel sind als Identität
ausgeschlossen.

## 6. Erwarteter Payload

Es wird in dieser Phase bewusst kein hypothetischer Produktiv-Payload gebaut.
Vor einer Implementierung muss Immoprofessional schriftlich oder durch einen
gesondert freigegebenen Einzeltest mindestens bestätigen:

1. objektbezogenes `aktionart="DELETE"` oder transferbezogenes
   `modus="DELETE"`;
2. `umfang="TEIL"` oder ein abweichender Umfang;
3. erforderliche Objektfelder und deren Reihenfolge;
4. ob ein minimales Immobilien-Element oder ein vollständiger Datensatz nötig
   ist;
5. ZIP-/Dateinamenskonvention;
6. Verwendung derselben Anbieter- und Senderkennung.

Bis dahin ist jeder Delete-Payload `DELETE_CONTRACT_UNCONFIRMED`.

## 7. Transport

Ein später bestätigter Payload könnte den bestehenden expliziten FTPS-Transport
verwenden, darf aber nicht über den normalen Uploadjob wiederverwendet werden.
Delete benötigt eine eigene Jobart, eigene deterministische Job-ID und ein
eigenes persistentes Ledger. `uploadFrom()` darf erst nach einem atomar
persistierten Delete-Claim aufgerufen werden.

Der Transportzustand endet bei `delete_pending_confirmation`, niemals bei
`delete_confirmed` oder `deleted`.

## 8. Bestätigung

Es existiert kein realer Delete-Bericht, keine FTPS-Rückdatei, keine
dokumentierte API-Antwort und kein anderer positiver Immoprofessional-
Löschbeleg. Der bekannte Text `OK: Erfolgreich importiert` bestätigt nur den
Import eines neuen Objekts und darf nicht als Löschbestätigung interpretiert
werden.

Bewertung: `DELETE_CONFIRMATION_UNKNOWN`.

Eine spätere automatische Bestätigung ist nur zulässig, wenn ein positiver
Providerbeleg exakt die Quellobjektnummer und möglichst zusätzlich Dateiname,
Uploadkennung oder Delete-Job-ID enthält. Ein generischer Erfolg, das Fehlen
eines Fehlers, Zeitablauf oder eine nicht belastbar beobachtete Portalansicht
reichen nicht.

## 9. Fehlervertrag

Vorgesehene fachliche Ergebnisse:

- `delete_failed`: Transport oder eindeutig negativer Providerstatus;
- `delete_ambiguous`: mehr als ein passender Job, Quellbeleg oder Report;
- `delete_confirmation_unknown`: Transport abgeschlossen, aber kein bekannter
  positiver Bestätigungsvertrag;
- `delete_manual_review_required`: unbekanntes Format, unvollständige
  Objektkorrelation oder CAS-Konflikt.

Keiner dieser Zustände verändert Quelle oder Replacement. Keine Fehlermeldung
ist keine Erfolgsbestätigung.

## 10. Idempotenz und Jobidentität

Ein späterer Job benötigt mindestens:

```text
deleteJobId
sourceListingId
sourceExternalObjectNumber
replacementListingId
replacementExternalObjectNumber
replacementConfirmedAt
deleteRequestedAt
deleteTransferredAt
deleteConfirmedAt
attempt
status
idempotencyKey
provider
channel
```

Empfohlene kanonische Eingabe für den Idempotency-Key:

```text
immoprofessional-delete:v1
+ providerId
+ sourceListingId
+ sourceExternalObjectNumber
+ replacementListingId
+ replacementExternalObjectNumber
+ replacementConfirmedAt
```

Darüber wird SHA-256 gebildet. Damit ist ein Job an genau eine bestätigte
Replacement-Beziehung gebunden; ein Helper- oder Scheduler-Neustart erzeugt
keine neue fachliche Identität.

## 11. Sicherheitsguards und Eligibility

Automatisches Löschen darf erst qualifizieren, wenn alle Bedingungen gelten:

1. Quelle existiert genau einmal und ist weiterhin `published`.
2. `externalDeletionConfirmedAt` fehlt und `externalDeletionPending` ist wahr.
3. Quelle besitzt genau eine `supersededByListingId`-Beziehung.
4. Source und Replacement haben verschiedene interne IDs.
5. Replacement existiert genau einmal im selben Projekt.
6. Replacement zeigt mit `rotationSourceListingId` auf die Quelle zurück.
7. Replacement ist `published`.
8. Ein positiver Importreport ist über Report-, Listing- und Uploadjob-ID
   eindeutig dem Replacement zugeordnet.
9. Historische positive Mail-Move-Folgestatus bleiben als fachlich bestätigter
   Importbeleg zulässig; sie lösen keine Mailaktion aus.
10. Importreport und Replacement tragen exakt dieselbe externe Objektnummer.
11. `replacementConfirmedAt` ist vorhanden und entspricht dem bestätigten
    Provider-Importzeitpunkt.
12. Die Quelle ist nicht mehr rotationsfähig und besitzt keine Reservation,
    kein Pending-Rotation-Listing und keinen Process-Lease.
13. Es gibt keinen offenen oder bestätigten Delete-Job für die Quelle.
14. Die zu löschende Nummer stammt ausschließlich aus der Quelle.
15. Ein separater globaler Delete-Betriebsmodus steht fail-closed auf `off`;
    der spätere erste Lauf benötigt `canary` mit exakt einer Quellnummer.

Harte Identitätsprüfung:

```text
deleteExternalObjectNumber === source.externalId
deleteExternalObjectNumber !== replacement.externalId
source.id !== replacement.id
```

Jede Verletzung stoppt mit `DELETE_REPLACEMENT_GUARD_VIOLATION`, bevor ein
Payload erzeugt oder ein Transport geclaimt wird.

## 12. Zukünftige Statusmaschine, Claim und CAS

Empfohlenes separates Delete-Modell:

```text
delete_prepared
→ delete_processing
→ delete_transferred
→ delete_pending_confirmation
→ delete_confirmed
```

Fehler- und Prüfzustände bleiben separat. Die Quelle bleibt bis zur positiven
Bestätigung `published` und `externalDeletionPending: true`.

Spätere Atomicitätsgrenze:

```text
Eligibility erneut aus aktuellem Katalog prüfen
→ persistenten source-bezogenen Claim erwerben
→ Delete-Job per Katalog-CAS/Jobledger speichern
→ Transport
→ delete_pending_confirmation persistieren
```

Bestätigungsgrenze:

```text
positiven Providerbeleg validieren und exakt korrelieren
→ aktuellen Claim/Job/Source/Replacement per CAS erneut prüfen
→ delete_confirmed + externalDeletionConfirmedAt
→ Quelle intern auf bestehenden Status deleted setzen
```

Das vorhandene `WORKFLOW_STATUS.DELETED` kann nach bestätigter externer
Löschung verwendet werden. Eine globale Statusmigration oder zusätzliches
Archivieren ist nicht erforderlich. Das Replacement bleibt byte- und
fachlich unverändert; insbesondere `lastUploadedAt`, `nextUpdateAt`,
Importreport, Bilder und Grundstücksdaten werden nicht angefasst.

## 13. Vorbereiteter Einzel-Canary

Read-only geprüft:

- Quelle `30460-032963` existiert genau einmal und ist `published`.
- Status: „Ersetzt · neues Objekt 30460-810978 · externe Löschung ausstehend“.
- `supersededByListingId` zeigt exakt auf das Replacement.
- `replacementConfirmedAt`: `2026-08-13T09:16:00.000Z`.
- `externalDeletionPending: true`; keine Löschbestätigung vorhanden.
- Quelle ist mit `automaticUpdateEnabled: false` nicht mehr rotationsfähig.
- Keine Scheduler-Reservation, kein Pending-Rotation-Listing und kein
  Process-Lease.
- Replacement `30460-810978` existiert genau einmal, ist `published` und zeigt
  über `rotationSourceListingId` auf die Quelle zurück.
- Der positive, historisch kompatible Importbeleg korreliert Replacement,
  Quelle, Providerzeitpunkt und deterministischen Uploadjob eindeutig.
- Es existiert kein Delete-Job.
- `automaticDeletionEnabled: false` bleibt als globale Schutzsperre aktiv.

Bewertung: `DELETE_CANARY_ELIGIBLE` als zukünftiger Einzel-Canary nach
Bestätigung des Providervertrags und Implementierung eines separaten,
fail-closed Delete-Canary-Modus. Diese Bewertung ist keine Ausführungsfreigabe.

## 14. Testplan für die spätere Implementierung

Geplant sind mindestens 28 Sicherheitstests:

### Eligibility

1. Replacement nicht `published` → block.
2. Replacement ohne Importbestätigung → block.
3. Quelle nicht superseded → block.
4. falsche Replacement-ID → block.
5. fehlendes `replacementConfirmedAt` → block.
6. bestehender offener Deletejob → block.
7. bereits extern gelöscht → block.

### Guardrails

8. Delete-Nummer entspricht Quellnummer → zulässig.
9. Delete-Nummer entspricht Replacementnummer → Hard Stop.
10. Source-ID entspricht Replacement-ID → Hard Stop.
11. unbekannte externe Nummer → block.

### Idempotenz und Restart

12. gleicher Deletejob zweimal → nur ein Job.
13. Helper-Neustart → kein zweiter Transfer.
14. Scheduler-Neustart → kein zweiter Transfer.
15. Transfer erfolgreich, Confirmation fehlt → pending, keine Wiederholung.
16. bereits bestätigter Delete → keine weitere Aktion.

### Failure

17. FTPS-Verbindungsfehler.
18. Timeout.
19. Upload-/Transferfehler.
20. unbekannter Providerstatus.
21. negativer Providerstatus.
22. mehrdeutige Bestätigung.
23. CAS-Konflikt.

### Success

24. positive Bestätigung exakt für die Quelle.
25. Quelle erst danach finalisiert.
26. Replacement vollständig unverändert.
27. Scheduler bleibt unverändert beim Replacement.
28. Wiederholung erzeugt keine zweite Deleteausführung.

Zusätzlich müssen Tests den globalen Modus `off | canary`, fehlende oder
beschädigte Konfiguration → `off`, einen einzelnen Canary-Identifier und das
vollständige Verbot von Batch-Catch-up in der ersten Produktionsphase belegen.

## 15. Offene Risiken sowie Go-/No-Go-Kriterien

### No-Go im aktuellen Stand

- Immoprofessional-Unterstützung für OpenImmo-DELETE nicht bestätigt.
- Exakte Payload-Variante nicht bestätigt.
- Verbindliche Objektadressierung nicht bestätigt.
- Positiver Delete-Rückkanal und sein Originalformat unbekannt.
- Der aktuelle CHANGE-Generator ist nicht ohne Weiteres als strikt
  OpenImmo-1.2.7d-konformer Delete-Generator wiederverwendbar.

### Go für eine spätere Einzel-Canary-Implementierung erst nach

1. schriftlicher Providerdokumentation oder separat freigegebenem, kontrolliertem
   Original-Payload-/Report-Test;
2. bestätigter Quellobjektadressierung;
3. eindeutigem positiven Rückkanal;
4. eigenem Delete-Jobledger, Claim, CAS und fail-closed `off | canary`;
5. vollständig grünen 28+ Sicherheitstests;
6. erneuter read-only Eligibility-Prüfung unmittelbar vor dem Einzel-Canary.

Aktuelle Abschlussentscheidung:
`DELETE_CONTRACT_NEEDS_MORE_PROVIDER_INFORMATION`.
