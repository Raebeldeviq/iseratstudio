# Audit der 41 blockierten Scheduler-Owner

Stand: 3. September 2026
Branch: `fix/inseratstudio-9-day-rotation`

## Ergebnis

- Alle 41 Einträge sind aktuell fällige, veröffentlichte Scheduler-Owner mit
  `automaticUpdateEnabled=true`, deren zugeordneter Ausgangsplatz und Variante
  inaktiv sind.
- 39 Einträge sind exakte Original-A-Beziehungen der abgeschlossenen,
  unveränderten 85er-Kampagne. Für jeden existiert mindestens ein anderer
  aktiver veröffentlichter Scheduler-Owner desselben Grundstücks. Sie werden
  ausschließlich über den hashgebundenen internen Reconciliation-Vertrag aus
  der aktiven Due-Queue entfernt; Inserat, Status und Audit-Historie bleiben
  erhalten.
- `30460-131712` und `30460-628198` gehören nicht zur 85er-Kampagne. Beide
  Objekte sowie jeweils ein aktiver Alternativ-Owner waren in der
  authentifizierten Immoprofessional-Sitzung read-only vorhanden. Sie bleiben
  als fachliche Ausnahmen unverändert und werden nur aus der startfähigen Queue
  ausgeschlossen.

Die Presence-Angabe „85er-Abschluss“ stammt aus der persistenten, hashgebundenen
Abschlussevidenz `REGRESSION_85_CLOSED_MANUAL_RECONCILIATION`. Die beiden
regulären Ausnahmen wurden ausschließlich lesend in der Provider-Sitzung
geprüft. Es fand keine externe Mutation statt.

## Vollständige Klassifikation

`Owner/Slot/Variante` ist in allen Zeilen `ja/nein/nein`.

| Objektnummer | Interne Listing-ID | Grundstück/Projekt | Slot-ID / Variante | Presence / Herkunft | Aktive Alternativ-Owner | Empfehlung |
| --- | --- | --- | --- | --- | --- | --- |
| 30460-001278 | c8f45a49-1c93-41de-9483-2a87d0550b52 | Kloster Lehnin · Krahne · Schwarzer Weg · 898 m² | 433f54dd-7dd2-4fe0-a712-27ef91b7fe42 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-652450, 30460-690949 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-006135 | 3103eed9-b136-420f-ade0-8bf2bfb4485e | Teltow · Iserstraße 96 · 950 m² | 3e76221f-065b-4045-8edf-5b21e5391a20 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-592596, 30460-982057 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-012739 | 66c5d913-1548-455d-a456-36a7b3eedc9e | Bundschuhweg 11a, 14542 Werder (Havel), Phöben | f2cfd925-1e64-456b-a265-497d560c5ce8 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-403576, 30460-957396, 30460-608405 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-025335 | d6b71d8c-182f-4815-b4ea-423e7c5b9556 | Beetzsee · Brielow · Hohenferchesarer Straße 14 · 482 m² | 5300c735-3985-43fc-9eb6-bf5a550d3f7f / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-948294, 30460-317339, 30460-112498 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-082412 | cd0019c3-9a1c-4de0-8067-8503036af1de | Werder · Immenstraße 4 · 800 m² | d7fc061e-0954-4efa-a103-f73496211263 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-395672, 30460-858401, 30460-892403 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-104413 | 489f37e0-115c-440e-8231-a82298754c95 | Am Silbergraben 8B, 14480 Potsdam-Drewitz | 93fe5942-9abd-4b07-bb3b-e064b8130bf6 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-541378, 30460-108028, 30460-652921 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-131712 | rotation-3017faee-fc928a2d-6155ea04-copy | Ginsterweg 2, 14797 Damsdorf | 7122c780-0272-4a66-a7de-c36c4a1d4c1e / SOL 242 V4 | Provider read-only present / regulär | 30460-578535, 30460-590537, 30460-864107 | Fachlich isoliert klären; nicht automatisch reaktivieren |
| 30460-187555 | f1892abc-b6ec-4838-ba0d-c45b7bd75ed0 | Ziesar · Bücknitz · Fiener Straße 72 · 850 m² | d0e95e49-9700-4046-9fbf-e5d911df5028 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-804269, 30460-315086, 30460-454598 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-320266 | c9934349-f743-427d-a83d-7260d4ee381a | Niemegk · Wendemark 14B · 902 m² | d8874875-f73e-4580-97b3-bbd65110a68d / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-334245, 30460-725547, 30460-004334 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-347121 | e5fb0b9f-40e2-4c06-a817-674a93708201 | Elisabethstraße 0, 14542 Werder (Havel) | b8d7243a-5709-4193-8a38-78bffd7614a3 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-566473, 30460-101141, 30460-057911 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-349664 | 56b9bec6-a44e-4baa-93ed-3801eeb0e3ee | Potsdam · Bornstedt · Kirschallee · 651 m² | 64c52f38-f15e-4a0e-a663-1a3a186be23f / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-988879, 30460-127493 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-358724 | 6ce18171-dad5-4e2f-b839-f382716d3d15 | Teltow · Richard-Wagner-Straße 74 · 817 m² | 2ab14f08-a50c-4745-96c4-74b233305388 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-621860, 30460-661192 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-365939 | faf2d633-1e74-4324-974c-3e551308cd4c | Potsdam · Groß Glienicke · Schulzenlandweg 8 · 773 m² | 2e3da3a5-9e6d-4251-b23a-a2202cf91da3 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-929728, 30460-732324, 30460-563888 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-392161 | eb7684ab-2adb-4dcb-95f7-fa054fc5b268 | Roskow · Weseram · Garten 1? · 900 m² | b0687e67-bd0d-49fd-94bf-eb4196317267 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-817556, 30460-722452, 30460-695984 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-425879 | 35e3a1e0-27fc-44ff-b843-0371b3afcc6c | Teltow · Osdorfer Straße 62 · 894 m² | a0c25da2-bd28-4f72-946a-abb6a3e82e0a / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-888034, 30460-018548, 30460-865717 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-461582 | f3d4294b-a31a-4a5f-9739-c2fcb634c8c4 | Brück · Gartenstr 1? · 1.386 m² | 4ce45a55-2010-4897-b263-e5a6aceb6bf6 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-038271, 30460-954961, 30460-593015 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-488711 | 977a373b-04d9-4e23-b927-010f028d8d9d | Groß Kreutz · Kirschenallee 1? · 890 m² | 774f0ac7-03a6-45bd-a9da-2b254377f508 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-649292, 30460-243315 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-495614 | 579eb23a-aedb-45d6-84e6-a6669455124b | Schwielowsee · Geltow – Wildpark West · Am Pappeltor 1 · 719 m² | e83df66a-b522-497a-9e4d-2e0c8227882c / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-972126, 30460-056361, 30460-934549 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-506538 | ce3dd033-8f14-4684-9462-dc5ea984a0c3 | Werder · Eisenbahnstraße 1 · 660 m² | a6dfea73-00e6-469e-b571-cf93ab0b2140 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-550735, 30460-311309, 30460-991962 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-507567 | b1f24d27-44fa-4d16-9975-b683b8b6ff2a | Michendorf · Stichweg 3 · 684 m² | cd4550c4-fd14-4eb7-b8cf-c6d2a1b3acdc / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-698356, 30460-226234, 30460-271417 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-510292 | 8c3c059e-2b57-4e09-9115-9fe1e05577c8 | Beelitz · Wilmersdorfer Str. 15 · 900 m² | c741c08c-c822-40b3-9a32-966dca0b7f91 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-583442, 30460-076200, 30460-693019 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-546580 | f708026c-8d49-40bc-8751-10858bb0ffb4 | Michendorf · Wilhelmshorst · Ahornweg 9 · 1.455 m² | 124fa9d2-dcce-4bbd-b91b-db9b78e17f85 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-296646, 30460-097195, 30460-857915 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-561531 | 6f5ab4b0-945a-4eb5-8551-efa84f7d6d1d | Borkwalde · Olof-Palme-Ring 1? · 550 m² | 20729c3b-5d17-43b1-892f-63fe0e45164e / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-992471, 30460-009419, 30460-273436 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-580496 | a8e008bf-9e93-4284-942b-bae225e9012f | Zossen · Hildegardtstraße 1 · 600 m² | 648ea40b-47da-48d7-8c41-27a979f94139 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-045552, 30460-702753, 30460-379803 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-628198 | rotation-508018eb-812d5312-ac1f6f37-copy | Michendorf · Stücken · Am Sonnendeck – Baugebiet 310 · 706 m² | 8f5e388b-03f8-4219-a865-3ae9a99555d4 / SOL 242 V4 | Provider read-only present / regulär | 30460-810978, 30460-666145, 30460-178674 | Fachlich isoliert klären; nicht automatisch reaktivieren |
| 30460-633966 | feff73b5-83fa-4119-a4f2-097a080b5d23 | Berlin · Jägerstätter Weg 14 · 514 m² | 2bc3ef82-7881-4ed0-aa7d-7ea7bc8d35be / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-593021, 30460-337880 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-634259 | 7e997154-fd12-4d27-a01c-1a798f2e68ed | Treuenbrietzen · Marzahna · Schönefelder Straße 1? · 800 m² | d217a145-a43c-44ed-b3a2-e2da5373dbbf / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-570466, 30460-846950, 30460-921909 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-645940 | 20607e66-416f-4c10-9e0b-2ea40dc5bde1 | Katharinastraße 17, 14480 Potsdam-Stern | a9fd8d6f-cdf7-4194-9b55-b150b4cffead / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-108038, 30460-836533, 30460-993198 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-663810 | 3fe56f56-b402-4934-9e1e-9982ca6fadaa | Brandenburg an der Havel · Neustadt · Birkenweg 1? · 800 m² | 63c7f711-c708-47d8-a198-769cdcc08564 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-640012, 30460-105649 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-672197 | 7388ac86-8743-447f-b548-96181ce8c468 | Wenzlow · Grüninger Dorfstraße 3 · 671 m² | 1a2c0a5e-a1d2-4985-83d4-0fad798193ac / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-470524, 30460-556964, 30460-973424 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-706616 | 14a06552-0d03-4fba-88ab-3bb35d26915f | Borkheide · Auf der Heide 13 · 869 m² | 1a1e0020-3c87-44b5-b839-4aea21ca9423 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-925444, 30460-942103 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-713794 | a9729e86-f7c3-4058-b3ca-63755e7e6462 | Stahnsdorf · Bahnhofstraße 75 · 1.247 m² | 97622cb0-50e7-4e0e-800f-f9e99e6fbc1e / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-755080, 30460-373525, 30460-737310 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-713866 | ba5e6ed0-23d0-4b43-a7c4-9b17a12cc034 | Schongauerstraße 24, 12623 Berlin-Mahlsdorf | f5e1b9a4-7b2a-448a-86a9-d18df3cf368a / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-303814, 30460-671259 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-733449 | e522bc54-bc7c-4043-986a-a617277ee4fc | Bad Belzig · Lütte · Bruchstraße 4 · 1.390 m² | 2f9f2d2c-82b0-4d86-bacd-4ddfea55b33a / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-202403, 30460-935491, 30460-504374 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-761728 | be13f29e-6c0c-4d44-9f44-642f91b4d845 | Grunowstraße 37, 12623 Berlin-Mahlsdorf | 522dad7d-8e35-4882-89a9-59c819dca109 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-207059, 30460-502563, 30460-077477 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-792742 | 67ecfca5-da43-4c61-8bd1-e3f9a48ef911 | Kloster Lehnin · Lehnin · Lerchenwinkel 1 · 459 m² | edb871e3-c9ae-40d1-9ba8-b0fee8bc77f8 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-195813, 30460-459135, 30460-620431 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-797964 | 6ca4a99f-7ba6-4ba5-9b41-6f2d15e7b42d | Teltow · Brunhildstr. 53 · 630 m² | f6faa543-abf8-44f1-a192-7a5642054fac / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-257383, 30460-130820, 30460-295497 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-820686 | 61c3c001-48d2-4c99-8539-d73894ca8456 | Max-Eyth-Allee 8, 14469 Potsdam-Bornim | dcd89030-2940-4f3a-a59c-b65b95eaeeff / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-608823, 30460-031161, 30460-947317 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-845718 | 84c90000-e08a-4f56-95a4-955ba3091770 | Wacholderheide 50, 12623 Berlin-Mahlsdorf | 2cc3f2db-7814-4bc4-8438-1b89a5ca2b76 / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-708152, 30460-118851 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-934478 | cfab00b6-205d-420d-821c-c25a86aed751 | Wiesenburg/Mark · Borner Weg 1? · 815 m² | 25a18822-9dcc-4127-82c3-46f5d448920a / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-479102, 30460-565336, 30460-640700 | Historische Altlast aus Scheduler-Scope entfernen |
| 30460-999074 | c4b67112-6a20-4505-b2c1-57976051f78c | Werder · Töplitz · Leester Straße 21E · 801 m² | c8c9b151-e5f3-4e2c-9a80-b3c6d452167d / SOL 242 V4 | A present laut 85er-Abschluss / historisch | 30460-639444, 30460-160509, 30460-823942 | Historische Altlast aus Scheduler-Scope entfernen |

## Reconciliation-Vertrag

Die interne Korrektur darf nur ausgeführt werden, wenn Scope-Hash,
Evidence-Hash, Classification-Fingerprint und manueller Abschlussstatus exakt
dem bekannten 85er-Vertrag entsprechen. Sie deaktiviert ausschließlich die
automatische Aktualisierung der 39 historischen Original-A-Owner, löscht keine
Listings und verändert keinen externen Status. Jeder Eingriff wird als
`closed-regression-85-inactive-owner-v1` im Katalog protokolliert und ist bei
Wiederholung idempotent.

Die zwei regulären Ausnahmen sind ausdrücklich nicht Bestandteil dieses
Vertrags.
