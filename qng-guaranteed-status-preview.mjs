import {
  LIVING_HAUS_SERIES_ID,
  QNG_GUARANTEE_SENTENCE,
  QNG_GUARANTEE_TITLE,
  qngGuaranteeSentence,
  qngGuaranteeTitle,
} from "./listing-claim-policy.mjs";

export const QNG_GUARANTEE_PREVIEW_TREATMENT = Object.freeze({
  ADD_TITLE: "ADD_QNG_GUARANTEE_TITLE",
  ADD_DESCRIPTION: "ADD_QNG_GUARANTEE_DESCRIPTION",
  NO_ACTION: "NO_ACTION",
  MANUAL_REVIEW: "MANUAL_REVIEW",
});

const ARCHIVED_STATUSES = new Set(["archived", "deleted"]);

function clean(value) {
  return String(value ?? "").trim();
}

function configuredSeries(house = {}) {
  return clean(house.seriesId || house.houseSeries) || LIVING_HAUS_SERIES_ID;
}

function activeListing(listing = {}) {
  const status = clean(listing.status).toLocaleLowerCase("de-DE");
  return Boolean(clean(listing.id))
    && !clean(listing.rotationArchivedAt)
    && !ARCHIVED_STATUSES.has(status);
}

function contextFor(project, listing, house) {
  return {
    project,
    house,
    houseSeries: configuredSeries(house),
    listingFacts: listing?.listingFacts,
  };
}

function titlePreview(title, marker) {
  const current = clean(title);
  if (current.includes(marker)) return { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION, proposedText: current };
  if (/\bqng\b/iu.test(current)) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      proposedText: "",
      reason: "Die bestehende Überschrift enthält bereits eine abweichende QNG-Aussage.",
    };
  }
  const proposedText = current ? `${current} – ${marker}` : marker;
  if (proposedText.length > 220) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      proposedText: "",
      reason: "Die zentrale QNG-Ergänzung würde die zulässige Überschriftenlänge überschreiten.",
    };
  }
  return { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_TITLE, proposedText };
}

function descriptionPreview(description, sentence) {
  const current = clean(description);
  if (current.includes(sentence)) return { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION, proposedText: current };
  if (/\bqng\b/iu.test(current)) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      proposedText: "",
      reason: "Die bestehende Objektbeschreibung enthält bereits eine abweichende QNG-Aussage.",
    };
  }
  const proposedText = current ? `${current}\n\n${sentence}` : sentence;
  if (proposedText.length > 6000) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      proposedText: "",
      reason: "Die zentrale QNG-Ergänzung würde die zulässige Beschreibungslänge überschreiten.",
    };
  }
  return { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION, proposedText };
}

/**
 * Produces a read-only field plan. It never mutates the supplied catalog
 * state and deliberately refuses to overwrite pre-existing QNG wording.
 */
export function planQngGuaranteedStatusMigration(state = {}) {
  const housesById = new Map((state.houses || []).map((house) => [house.id, house]));
  const listings = [];
  for (const project of state.projects || []) {
    for (const listing of project.listings || []) {
      if (!activeListing(listing)) continue;
      const house = housesById.get(listing.templateId);
      const context = contextFor(project, listing, house);
      const sentence = qngGuaranteeSentence(context);
      const marker = qngGuaranteeTitle(context);
      if (!house || !sentence || !marker) {
        listings.push({
          projectId: project.id,
          listingId: listing.id,
          externalId: clean(listing.externalId),
          houseId: clean(listing.templateId),
          eligible: false,
          title: { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION, proposedText: clean(listing.texts?.title) },
          description: { treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION, proposedText: clean(listing.texts?.description) },
        });
        continue;
      }
      listings.push({
        projectId: project.id,
        listingId: listing.id,
        externalId: clean(listing.externalId),
        houseId: house.id,
        eligible: true,
        title: titlePreview(listing.texts?.title, marker),
        description: descriptionPreview(listing.texts?.description, sentence),
      });
    }
  }
  const counts = {
    scannedListings: listings.length,
    eligibleListings: listings.filter((listing) => listing.eligible).length,
    affectedListings: listings.filter((listing) => (
      listing.title.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_TITLE
      || listing.description.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION
    )).length,
    titleChanges: listings.filter((listing) => listing.title.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_TITLE).length,
    descriptionChanges: listings.filter((listing) => listing.description.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION).length,
    manualReviews: listings.filter((listing) => (
      listing.title.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW
      || listing.description.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW
    )).length,
  };
  return {
    readOnly: true,
    centralTitle: QNG_GUARANTEE_TITLE,
    centralDescription: QNG_GUARANTEE_SENTENCE,
    counts,
    listings,
  };
}
