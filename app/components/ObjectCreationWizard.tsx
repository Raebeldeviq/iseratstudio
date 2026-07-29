"use client";

import {
  useMemo,
  useState,
} from "react";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import {
  createDirectObject,
  type DirectObjectDraft,
} from "../lib/management";
import type {
  ListingObjectCategory,
  StudioState,
} from "../types";

type ObjectCreationWizardProps = {
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
  onClose: () => void;
  onCreated: (listingId: string, externalId: string) => void;
};

const CATEGORY_OPTIONS: Array<{
  id: ListingObjectCategory;
  title: string;
  description: string;
  eyebrow: string;
}> = [
  {
    id: "house-purchase",
    title: "Haus Kauf",
    description: "Haus, Projektierung oder Bestandsimmobilie mit Wohn- und Grundstücksfläche.",
    eyebrow: "Wohnen · Kauf",
  },
  {
    id: "apartment-purchase",
    title: "Wohnung Kauf",
    description: "Eigentumswohnung mit Etage, Hausgeld und wohnungsspezifischer Ausstattung.",
    eyebrow: "Wohnen · Kauf",
  },
  {
    id: "land",
    title: "Grundstück",
    description: "Grundstück zum Kauf, zur Pacht oder in Erbpacht mit Angaben zur Bebaubarkeit.",
    eyebrow: "Grundstück",
  },
];

const STEPS = [
  ["Grunddaten", "Objektart und Grundlage"],
  ["Adresse", "Lage und Sichtbarkeit"],
  ["Haus & Preis", "Flächen und Konditionen"],
  ["Medien", "Bilder und Unterlagen"],
  ["KI-Texte", "Kontakt und Inhalte"],
  ["Prüfen", "Freigabe und Portale"],
] as const;

function numberValue(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function Field(props: {
  label: string;
  value: string | number;
  type?: "text" | "number" | "email";
  required?: boolean;
  min?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="management-field">
      <span>{props.label}{props.required ? " *" : ""}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        min={props.min}
        required={props.required}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="management-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function initialDraft(state: StudioState): DirectObjectDraft {
  const firstHouse = state.houses.find((house) => house.archived !== true);
  return {
    objectCategory: "house-purchase",
    templateId: firstHouse?.id,
    title: "",
    owner: "fabian",
    country: "Deutschland",
    street: "",
    houseNumber: "",
    zip: "",
    city: "",
    district: "",
    areaType: "Wohngebiet",
    addressPublished: false,
    googleMapsPublished: true,
    purchasePrice: firstHouse?.housePrice ?? 0,
    annualLeasePrice: 0,
    livingArea: firstHouse?.livingArea ?? 0,
    usableArea: firstHouse?.livingArea ?? 0,
    plotArea: 0,
    rooms: firstHouse?.rooms ?? 0,
    bedrooms: firstHouse?.bedrooms ?? 0,
    bathrooms: firstHouse?.bathrooms ?? 0,
    floors: firstHouse?.floors ?? 0,
    houseType: firstHouse?.houseType ?? "Einfamilienhaus",
    apartmentType: "Etagenwohnung",
    marketingType: "purchase",
    landUse: "WOHNEN",
    developmentStatus: "",
    buildingLaw: "",
    buildableSoon: false,
    ownerSalutation: "",
    ownerCompany: "",
    ownerFirstName: "",
    ownerLastName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerIsPropertyOwner: false,
    internalNotes: "",
    released: false,
    portalIds: state.management?.portals
      .filter((portal) => portal.enabled)
      .map((portal) => portal.id) ?? [],
  };
}

export default function ObjectCreationWizard({
  state,
  setState,
  onClose,
  onCreated,
}: ObjectCreationWizardProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DirectObjectDraft>(() => initialDraft(state));
  const [error, setError] = useState("");
  const activeHouses = useMemo(
    () => state.houses.filter((house) => house.archived !== true),
    [state.houses],
  );
  const category = CATEGORY_OPTIONS.find((item) => (
    item.id === draft.objectCategory
  )) ?? CATEGORY_OPTIONS[0];
  const selectedTemplate = activeHouses.find((house) => house.id === draft.templateId);

  const patch = (value: Partial<DirectObjectDraft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError("");
  };

  const chooseCategory = (objectCategory: ListingObjectCategory) => {
    const firstHouse = activeHouses[0];
    patch({
      objectCategory,
      templateId: objectCategory === "house-purchase" ? firstHouse?.id : undefined,
      marketingType: "purchase",
      livingArea: objectCategory === "land" ? 0 : firstHouse?.livingArea ?? 0,
      usableArea: objectCategory === "house-purchase" ? firstHouse?.livingArea ?? 0 : 0,
      rooms: objectCategory === "land" ? 0 : firstHouse?.rooms ?? 0,
      bedrooms: objectCategory === "land" ? 0 : firstHouse?.bedrooms ?? 0,
      bathrooms: objectCategory === "land" ? 0 : firstHouse?.bathrooms ?? 0,
      floors: objectCategory === "house-purchase" ? firstHouse?.floors ?? 0 : 0,
      purchasePrice: objectCategory === "house-purchase" ? firstHouse?.housePrice ?? 0 : 0,
      houseType: objectCategory === "house-purchase"
        ? firstHouse?.houseType ?? "Einfamilienhaus"
        : "",
      apartmentType: objectCategory === "apartment-purchase" ? "Etagenwohnung" : "",
    });
  };

  const chooseHouse = (templateId: string) => {
    const house = activeHouses.find((item) => item.id === templateId);
    patch({
      templateId,
      purchasePrice: house?.housePrice ?? draft.purchasePrice,
      livingArea: house?.livingArea ?? draft.livingArea,
      usableArea: house?.livingArea ?? draft.usableArea,
      rooms: house?.rooms ?? draft.rooms,
      bedrooms: house?.bedrooms ?? draft.bedrooms,
      bathrooms: house?.bathrooms ?? draft.bathrooms,
      floors: house?.floors ?? draft.floors,
      houseType: house?.houseType ?? draft.houseType,
    });
  };

  const validateStep = (): boolean => {
    if (step === 0 && !draft.title.trim()) {
      setError("Bitte eine Überschrift für das Objekt eintragen.");
      return false;
    }
    if (step === 1 && (!draft.zip.trim() || !draft.city.trim())) {
      setError("PLZ und Ort sind für die Objektanlage erforderlich.");
      return false;
    }
    if (step === 2) {
      if (draft.objectCategory === "land" && draft.plotArea <= 0) {
        setError("Für ein Grundstück muss die Grundstücksfläche größer als 0 sein.");
        return false;
      }
      if (
        draft.objectCategory !== "land"
        && (draft.livingArea <= 0 || draft.rooms <= 0)
      ) {
        setError("Wohnfläche und Zimmerzahl müssen größer als 0 sein.");
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const create = () => {
    if (!validateStep()) return;
    const result = createDirectObject(state, draft);
    setState(result.state);
    onCreated(result.listingId, result.externalId);
  };

  return (
    <div className="object-wizard-backdrop" role="presentation">
      <section
        className="object-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="object-wizard-title"
      >
        <header className="object-wizard-header">
          <div>
            <span className="eyebrow">Direkte Objektanlage</span>
            <h2 id="object-wizard-title">Neues Objekt anlegen</h2>
            <p>Die Objektakte entsteht sofort mit eigener Objektnummer, Medienbereich und Portalfreigaben.</p>
          </div>
          <button type="button" aria-label="Objektanlage schließen" onClick={onClose}>×</button>
        </header>

        <nav className="object-wizard-steps" aria-label="Schritte der Objektanlage">
          {STEPS.map(([title, subtitle], index) => (
            <button
              key={title}
              type="button"
              className={step === index ? "active" : step > index ? "complete" : ""}
              disabled={index > step}
              onClick={() => setStep(index)}
            >
              <span>{index + 1}</span>
              <b>{title}</b>
              <small>{subtitle}</small>
            </button>
          ))}
        </nav>

        <div className="object-wizard-body">
          {step === 0 ? (
            <>
              <div className="object-category-grid">
                {CATEGORY_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={draft.objectCategory === item.id ? "selected" : ""}
                    aria-pressed={draft.objectCategory === item.id}
                    onClick={() => chooseCategory(item.id)}
                  >
                    <span>{item.eyebrow}</span>
                    <b>{item.title}</b>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
              <div className="management-form-grid three">
                <Field
                  label="Überschrift Ihres Objektes"
                  value={draft.title}
                  required
                  onChange={(title) => patch({ title })}
                />
                <label className="management-field">
                  <span>Zuständiges Adressbuch</span>
                  <select value={draft.owner} onChange={(event) => patch({ owner: event.target.value as DirectObjectDraft["owner"] })}>
                    <option value="fabian">Fabian</option>
                    <option value="pascal">Pascal</option>
                  </select>
                </label>
                <label className="management-field">
                  <span>Objektnummer</span>
                  <input value="wird automatisch vergeben" disabled />
                </label>
                {draft.objectCategory === "house-purchase" ? (
                  <label className="management-field management-field-wide">
                    <span>Haustyp als Grundlage</span>
                    <select value={draft.templateId ?? ""} onChange={(event) => chooseHouse(event.target.value)}>
                      <option value="">Freies Hausobjekt ohne Vorlage</option>
                      {activeHouses.map((house) => (
                        <option key={house.id} value={house.id}>
                          {house.name} · {house.livingArea} m² · {house.rooms} Zimmer
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="object-wizard-section-heading">
                <div><span className="eyebrow">{category.title}</span><h3>Adressinformationen</h3></div>
                <p>PLZ und Ort sind Pflicht. Straße und Hausnummer können intern bleiben.</p>
              </div>
              <div className="management-form-grid three">
                <Field label="Land" value={draft.country} onChange={(country) => patch({ country })} />
                <Field label="Straße" value={draft.street} onChange={(street) => patch({ street })} />
                <Field label="Hausnummer" value={draft.houseNumber} onChange={(houseNumber) => patch({ houseNumber })} />
                <Field label="PLZ" value={draft.zip} required onChange={(zip) => patch({ zip })} />
                <Field label="Ort" value={draft.city} required onChange={(city) => patch({ city })} />
                <Field label="Stadtteil" value={draft.district} onChange={(district) => patch({ district })} />
                <label className="management-field">
                  <span>Gebiet</span>
                  <select value={draft.areaType} onChange={(event) => patch({ areaType: event.target.value })}>
                    <option value="">Keine Angabe</option>
                    <option value="Neubaugebiet">Neubaugebiet</option>
                    <option value="Ortslage">Ortslage</option>
                    <option value="Siedlung">Siedlung</option>
                    <option value="Stadtrand">Stadtrand</option>
                    <option value="Stadtzentrum">Stadtzentrum</option>
                    <option value="Wohngebiet">Wohngebiet</option>
                    <option value="Mischgebiet">Mischgebiet</option>
                    <option value="Gewerbegebiet">Gewerbegebiet</option>
                  </select>
                </label>
              </div>
              <div className="management-checkbox-grid">
                <Toggle label="Adresse veröffentlichen" checked={draft.addressPublished} onChange={(addressPublished) => patch({ addressPublished })} />
                <Toggle label="In Google Maps anzeigen" checked={draft.googleMapsPublished} onChange={(googleMapsPublished) => patch({ googleMapsPublished })} />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="object-wizard-section-heading">
                <div><span className="eyebrow">{category.title}</span><h3>Basisinformationen</h3></div>
                <p>Die Felder passen sich an die ausgewählte Hauptrubrik an.</p>
              </div>

              {draft.objectCategory === "land" ? (
                <>
                  <div className="management-form-grid four">
                    <label className="management-field">
                      <span>Vermarktungsart *</span>
                      <select value={draft.marketingType} onChange={(event) => patch({ marketingType: event.target.value as DirectObjectDraft["marketingType"] })}>
                        <option value="purchase">Kauf</option>
                        <option value="rent-lease">Pacht</option>
                        <option value="leasehold">Erbpacht</option>
                      </select>
                    </label>
                    <Field label="Grundstücksfläche m²" type="number" min={0} required value={draft.plotArea} onChange={(value) => patch({ plotArea: numberValue(value) })} />
                    {draft.marketingType === "purchase" ? (
                      <Field label="Kaufpreis" type="number" min={0} value={draft.purchasePrice} onChange={(value) => patch({ purchasePrice: numberValue(value) })} />
                    ) : (
                      <Field label="Preis/Pacht pro Jahr" type="number" min={0} value={draft.annualLeasePrice} onChange={(value) => patch({ annualLeasePrice: numberValue(value) })} />
                    )}
                    <label className="management-field">
                      <span>Nutzungsart *</span>
                      <select value={draft.landUse} onChange={(event) => patch({ landUse: event.target.value })}>
                        <option value="WOHNEN">Wohnen</option>
                        <option value="GEWERBE">Gewerbe</option>
                        <option value="ANLAGE">Anlage</option>
                        <option value="LAND_FORSTWIRTSCHAFT">Land-/Forstwirtschaft</option>
                        <option value="FREIZEIT">Freizeit</option>
                      </select>
                    </label>
                    <label className="management-field">
                      <span>Erschließung</span>
                      <select value={draft.developmentStatus} onChange={(event) => patch({ developmentStatus: event.target.value })}>
                        <option value="">Keine Angabe</option>
                        <option value="UNERSCHLOSSEN">Unerschlossen</option>
                        <option value="TEILERSCHLOSSEN">Teilerschlossen</option>
                        <option value="VOLLERSCHLOSSEN">Vollerschlossen</option>
                        <option value="ORTSUEBLICHERSCHLOSSEN">Ortsüblich erschlossen</option>
                      </select>
                    </label>
                    <label className="management-field">
                      <span>Bebaubar nach</span>
                      <select value={draft.buildingLaw} onChange={(event) => patch({ buildingLaw: event.target.value })}>
                        <option value="">Keine Angabe</option>
                        <option value="34_NACHBARSCHAFT">§ 34 Nachbarschaft</option>
                        <option value="35_AUSSENGEBIET">§ 35 Außengebiet</option>
                        <option value="B_PLAN">Bebauungsplan</option>
                        <option value="KEIN BAULAND">Kein Bauland</option>
                        <option value="BAUERWARTUNGSLAND">Bauerwartungsland</option>
                        <option value="BAULAND_OHNE_B_PLAN">Bauland ohne B-Plan</option>
                      </select>
                    </label>
                  </div>
                  <div className="management-checkbox-grid">
                    <Toggle label="Kurzfristig bebaubar" checked={draft.buildableSoon} onChange={(buildableSoon) => patch({ buildableSoon })} />
                  </div>
                </>
              ) : (
                <div className="management-form-grid four">
                  <Field label="Kaufpreis" type="number" min={0} value={draft.purchasePrice} onChange={(value) => patch({ purchasePrice: numberValue(value) })} />
                  <Field label="Wohnfläche m²" type="number" min={0} required value={draft.livingArea} onChange={(value) => patch({ livingArea: numberValue(value) })} />
                  <Field label="Nutzfläche m²" type="number" min={0} value={draft.usableArea} onChange={(value) => patch({ usableArea: numberValue(value) })} />
                  {draft.objectCategory === "house-purchase" ? (
                    <Field label="Grundstücksfläche m²" type="number" min={0} value={draft.plotArea} onChange={(value) => patch({ plotArea: numberValue(value) })} />
                  ) : null}
                  <Field label="Zimmer" type="number" min={0} required value={draft.rooms} onChange={(value) => patch({ rooms: numberValue(value) })} />
                  <Field label="Schlafzimmer" type="number" min={0} value={draft.bedrooms} onChange={(value) => patch({ bedrooms: numberValue(value) })} />
                  <Field label="Badezimmer" type="number" min={0} value={draft.bathrooms} onChange={(value) => patch({ bathrooms: numberValue(value) })} />
                  <Field label="Etagenanzahl" type="number" min={0} value={draft.floors} onChange={(value) => patch({ floors: numberValue(value) })} />
                  {draft.objectCategory === "house-purchase" ? (
                    <Field label="Haustyp" value={draft.houseType} onChange={(houseType) => patch({ houseType })} />
                  ) : (
                    <Field label="Wohnungstyp" value={draft.apartmentType} onChange={(apartmentType) => patch({ apartmentType })} />
                  )}
                </div>
              )}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="object-wizard-section-heading">
                <div><span className="eyebrow">Medienbereich</span><h3>Bilder und Unterlagen vorbereiten</h3></div>
                <p>Vorlagenbilder werden direkt übernommen. Weitere Bilder, Grundrisse, PDFs, Videos und 3D-Touren ergänzt du danach in der Objektakte.</p>
              </div>
              <div className="object-wizard-media-summary">
                <div className="object-wizard-media-icon">▧</div>
                <div>
                  <span>Gewählte Grundlage</span>
                  <h4>{selectedTemplate?.name ?? "Freies Objekt ohne Medienvorlage"}</h4>
                  <p>
                    {selectedTemplate
                      ? `${selectedTemplate.images.length} Bilder werden in die neue Objektakte übernommen.`
                      : "Die Medienakte wird leer angelegt und kann anschließend befüllt werden."}
                  </p>
                </div>
                <b>{selectedTemplate?.images.length ?? 0} Medien</b>
              </div>
              <div className="object-wizard-checklist">
                <div><i>1</i><span><b>Titelbild festlegen</b><small>Reihenfolge und Freigabe direkt in der Objektakte ändern</small></span></div>
                <div><i>2</i><span><b>Grundrisse & Dokumente</b><small>Dateien getrennt kennzeichnen und für Exposés freigeben</small></span></div>
                <div><i>3</i><span><b>Links & Touren</b><small>Video- und 3D-Links objektbezogen hinterlegen</small></span></div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="object-wizard-section-heading">
                <div><span className="eyebrow">KI-Texte & Kontakt</span><h3>Inhalte vorbereiten</h3></div>
                <p>Die KI-Texte werden nach der Anlage in der Objektakte erzeugt und geprüft. Hier ordnest du den internen Kontakt zu.</p>
              </div>
              <div className="management-form-grid four">
                <label className="management-field">
                  <span>Anrede</span>
                  <select value={draft.ownerSalutation} onChange={(event) => patch({ ownerSalutation: event.target.value })}>
                    <option value="">Keine Angabe</option>
                    <option value="Herr">Herr</option>
                    <option value="Frau">Frau</option>
                    <option value="Firma">Firma</option>
                    <option value="Familie">Familie</option>
                    <option value="Eheleute">Eheleute</option>
                    <option value="Erbengemeinschaft">Erbengemeinschaft</option>
                    <option value="Neutral">Neutral</option>
                  </select>
                </label>
                <Field label="Firma" value={draft.ownerCompany} onChange={(ownerCompany) => patch({ ownerCompany })} />
                <Field label="Vorname" value={draft.ownerFirstName} onChange={(ownerFirstName) => patch({ ownerFirstName })} />
                <Field label="Nachname" value={draft.ownerLastName} onChange={(ownerLastName) => patch({ ownerLastName })} />
                <Field label="E-Mail" type="email" value={draft.ownerEmail} onChange={(ownerEmail) => patch({ ownerEmail })} />
                <Field label="Telefon" value={draft.ownerPhone} onChange={(ownerPhone) => patch({ ownerPhone })} />
              </div>
              <label className="management-field management-field-wide">
                <span>Interne Notizen zum Auftrag / Kontakt</span>
                <textarea rows={4} value={draft.internalNotes} onChange={(event) => patch({ internalNotes: event.target.value })} />
              </label>
              <div className="management-checkbox-grid">
                <Toggle label="Kontakt ist Eigentümer" checked={draft.ownerIsPropertyOwner} onChange={(ownerIsPropertyOwner) => patch({ ownerIsPropertyOwner })} />
              </div>
              <div className="object-wizard-ai-note">
                <span>AI</span>
                <div><b>Nächster Schritt nach der Anlage</b><p>Überschrift, Objektbeschreibung, Ausstattung, Lage und sonstige Angaben werden in einem eigenen Prüfschritt bearbeitet.</p></div>
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="object-wizard-section-heading">
                <div><span className="eyebrow">Abschlussprüfung</span><h3>Freigabe und Portale</h3></div>
                <p>Die Objektakte wird jetzt angelegt. Eine Übertragung erfolgt erst, wenn du sie später ausdrücklich veröffentlichst.</p>
              </div>
              <div className="management-checkbox-grid">
                <Toggle label="Objekt nach Anlage freigeben" checked={draft.released} onChange={(released) => patch({ released })} />
              </div>
              <div className="object-wizard-portals">
                <h4>Exportschnittstellen</h4>
                <p>Ausgewählte Ziele werden in der Objektakte vorgemerkt. Ohne Übertragung bleiben alle Daten lokal.</p>
                <div className="management-checkbox-grid">
                  {state.management?.portals.map((portal) => (
                    <Toggle
                      key={portal.id}
                      label={`${portal.name}${portal.quota ? ` · ${portal.currentOnline}/${portal.quota}` : ""}`}
                      checked={draft.portalIds.includes(portal.id)}
                      onChange={(enabled) => patch({
                        portalIds: enabled
                          ? [...draft.portalIds, portal.id]
                          : draft.portalIds.filter((id) => id !== portal.id),
                      })}
                    />
                  ))}
                </div>
              </div>
              <div className="object-wizard-review">
                <div><span>Objektart</span><b>{category.title}</b></div>
                <div><span>Ort</span><b>{draft.zip} {draft.city}</b></div>
                <div><span>Medien</span><b>{selectedTemplate?.images.length ?? 0} vorbereitet</b></div>
                <div><span>Freigabe</span><b>{draft.released ? "Freigegeben" : "Entwurf"}</b></div>
                <div><span>Portale</span><b>{draft.portalIds.length} vorgemerkt</b></div>
              </div>
            </>
          ) : null}

          {error ? <div className="object-wizard-error" role="alert">{error}</div> : null}
        </div>

        <footer className="object-wizard-footer">
          <button type="button" onClick={step === 0 ? onClose : () => setStep((current) => current - 1)}>
            {step === 0 ? "Abbrechen" : "Zurück"}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="primary" onClick={next}>Weiter</button>
          ) : (
            <button type="button" className="primary" onClick={create}>Objektakte anlegen</button>
          )}
        </footer>
      </section>
    </div>
  );
}
