import {
  LIVING_HAUS_SERIES_ID,
  QNG_GUARANTEE_SENTENCE,
  QNG_GUARANTEE_TITLE,
  qngGuaranteeSentence,
  qngGuaranteeTitle,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import {
  LISTING_TITLE_MAX_LENGTH,
  planListingHeadline,
} from "./listing-copy.mjs";

export const QNG_GUARANTEE_PREVIEW_TREATMENT = Object.freeze({
  REPLACE_TITLE: "REPLACE_TITLE_WITH_TWO_USPS",
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
    titleSeed: `${clean(listing?.id)}:${clean(listing?.externalId)}`,
  };
}

function publicEvidence(fact = {}) {
  return {
    key: clean(fact.key),
    value: fact.value,
    sourceKind: clean(fact.sourceKind),
    scope: clean(fact.scope),
    status: clean(fact.status),
    evidenceKind: clean(fact.evidenceKind),
    evidenceReference: clean(fact.evidenceReference),
    sourceScope: clean(fact.sourceScope),
    projectScope: clean(fact.projectScope),
    seriesId: clean(fact.seriesId),
    packageId: clean(fact.packageId),
  };
}

function titlePreview(project, listing, house, context) {
  const current = clean(listing?.texts?.title);
  const plan = planListingHeadline(house, project, context);
  const claimValidation = validateListingClaims({
    texts: { title: plan.title },
    house,
    project,
    houseSeries: context.houseSeries,
    listingFacts: context.listingFacts,
  });
  const usps = plan.usps.map((usp) => ({
    id: usp.id,
    label: usp.label,
    priority: usp.priority,
    evidence: publicEvidence(usp.fact),
  }));
  const base = {
    previousText: current,
    proposedText: plan.title,
    emotionalOpening: plan.opening,
    usp1: usps[0] || null,
    usp2: usps[1] || null,
    titleLength: plan.length,
    titleLimit: plan.maxLength || LISTING_TITLE_MAX_LENGTH,
    claimValidator: {
      ok: claimValidation.ok,
      blockingIssues: claimValidation.blockingIssues,
    },
  };
  if (!plan.withinLengthLimit) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      ...base,
      reason: "Die Zwei-USP-Überschrift überschreitet das zulässige Titellimit, obwohl der niedrigere USP bereits entfernt wurde.",
    };
  }
  if (!claimValidation.ok) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      ...base,
      reason: "Die Zwei-USP-Überschrift besteht die Claim-Validierung nicht.",
    };
  }
  return {
    treatment: current === plan.title
      ? QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION
      : QNG_GUARANTEE_PREVIEW_TREATMENT.REPLACE_TITLE,
    ...base,
  };
}

function descriptionPreview(description, sentence) {
  const current = clean(description);
  if (current.includes(sentence)) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION,
      previousText: current,
      proposedText: current,
    };
  }
  if (/\bqng\b/iu.test(current)) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      previousText: current,
      proposedText: "",
      reason: "Die bestehende Objektbeschreibung enthält bereits eine abweichende QNG-Aussage.",
    };
  }
  const proposedText = current ? `${current}\n\n${sentence}` : sentence;
  if (proposedText.length > 6000) {
    return {
      treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW,
      previousText: current,
      proposedText: "",
      reason: "Die zentrale QNG-Ergänzung würde die zulässige Beschreibungslänge überschreiten.",
    };
  }
  return {
    treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION,
    previousText: current,
    proposedText,
  };
}

function histogram(values) {
  return Object.fromEntries([...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "de-DE"))
    .map((value) => [value, values.filter((candidate) => candidate === value).length]));
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
          title: {
            treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION,
            previousText: clean(listing.texts?.title),
            proposedText: clean(listing.texts?.title),
            emotionalOpening: "",
            usp1: null,
            usp2: null,
            titleLength: clean(listing.texts?.title).length,
            titleLimit: LISTING_TITLE_MAX_LENGTH,
            claimValidator: { ok: true, blockingIssues: [] },
          },
          description: {
            treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.NO_ACTION,
            previousText: clean(listing.texts?.description),
            proposedText: clean(listing.texts?.description),
          },
        });
        continue;
      }
      listings.push({
        projectId: project.id,
        listingId: listing.id,
        externalId: clean(listing.externalId),
        houseId: house.id,
        eligible: true,
        title: titlePreview(project, listing, house, context),
        description: descriptionPreview(listing.texts?.description, sentence),
      });
    }
  }
  const counts = {
    scannedListings: listings.length,
    eligibleListings: listings.filter((listing) => listing.eligible).length,
    affectedListings: listings.filter((listing) => (
      listing.title.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.REPLACE_TITLE
      || listing.description.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION
    )).length,
    titleChanges: listings.filter((listing) => listing.title.treatment === QNG_GUARANTEE_PREVIEW_TREATMENT.REPLACE_TITLE).length,
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
    distribution: {
      emotionalOpenings: histogram(listings.map((listing) => listing.title.emotionalOpening)),
      usps: histogram(listings.flatMap((listing) => [listing.title.usp1?.label, listing.title.usp2?.label])),
      uspCombinations: histogram(listings.map((listing) => [listing.title.usp1?.label, listing.title.usp2?.label].filter(Boolean).join(" + "))),
    },
    listings,
  };
}
