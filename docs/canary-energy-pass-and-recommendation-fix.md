# Canary-Energypass und Empfehlungstext

## Implementierung

- Der bestätigte Energiepass des Canarys `FPI-E0B464-V1-A4810212` wird über die bereits vorhandenen, verifizierten `listingFacts` wiederhergestellt.
- Die einmalige Korrektur ist auf die feste externe und interne Objekt-ID sowie die Hausvorlage `SUN 113 V6` begrenzt, idempotent und bricht bei abweichenden Bestandsdaten ab.
- Ein Ende-zu-Ende-Test prüft nach Schema-Normalisierung das tatsächlich erzeugte OpenImmo-XML auf Energieausweistyp `BEDARF`, Endenergiebedarf `18`, Klasse `A+` und Baujahr `2027`.
- Der globale Immoprofessional-Standardtext für Empfehlungen wird an seiner tatsächlichen Portalquelle korrigiert; der bestehende XML-Wert `allgemein2` bleibt als zusätzliche Übertragung erhalten.

## Begründung

Der OpenImmo-Export akzeptiert reguläre Energieausweisfelder bewusst nur aus verifizierten Energieausweis-Fakten. Die Korrektur nutzt genau diese bestehende Compliance-Architektur und lockert weder Policy noch Exportbarriere. Energiebedarf und Baujahr stammen unverändert aus der Hausvorlage; `A+` ist durch den vom Auftraggeber bestätigten früheren Portalstand und die übereinstimmenden Bestandswerte derselben Hausvorlage abgesichert.

## Hürden und Risiken

Der Empfehlungstext wird von Immoprofessional aus einem kontoweiten vordefinierten Text befüllt; der bisher zusätzlich übertragene OpenImmo-Benutzerwert wurde dort nicht als Quelle dieses Feldes übernommen. Die Portaländerung ist daher global wirksam und wird ausschließlich am Empfehlungstext vorgenommen. Die Energypass-Korrektur ist absichtlich nicht global: Eine Übertragung auf andere Inserate wäre ohne individuelle Freigabe fachlich unzulässig.
