import test from "node:test";
import assert from "node:assert/strict";
import { buildExposePdf } from "../app/lib/expose-pdf.ts";

test("creates a downloadable multi-page PDF exposé", async () => {
  const listing = {
    id: "listing",
    externalId: "30435-13226",
    templateId: "house",
    templateName: "Sunshine 144",
    price: 460000,
    texts: {
      title: "Familienhaus mit viel Raum",
      description: "Eine ausführliche Objektbeschreibung für das Exposé.",
      equipment: "Moderne Ausstattung und energieeffiziente Haustechnik.",
      location: "Ruhige Lage mit guter Erreichbarkeit.",
      other: "Weitere Informationen erhalten Sie im persönlichen Gespräch.",
    },
    version: 1,
  };
  const result = await buildExposePdf({
    listing,
    project: {
      id: "project",
      owner: "fabian",
      name: "Michendorf",
      street: "Beispielweg",
      houseNumber: "7",
      zip: "14552",
      city: "Michendorf",
      district: "",
      plotArea: 620,
      plotPrice: 160000,
      additionalCosts: 20000,
      locationFacts: "",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: [],
      listings: [],
      createdAt: "2026-07-29T08:00:00.000Z",
    },
    company: {
      name: "Fabian & Pascal",
      legalName: "Fabian & Pascal",
      street: "",
      houseNumber: "",
      zip: "",
      city: "",
      country: "Deutschland",
      phone: "030 123",
      email: "kontakt@example.de",
      website: "",
      managingDirector: "",
      taxId: "",
      tradeRegister: "",
      imprint: "",
      terms: "",
      privacyNotice: "",
      openingHours: [],
    },
    images: [],
    options: {
      includeContact: true,
      includeAddress: false,
      includeImages: false,
      includeLogo: true,
      includePageNumbers: true,
      includeColors: true,
      firstPageOnly: false,
    },
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
  assert.ok(bytes.length > 3000);
  assert.equal(result.filename, "expose-30435-13226.pdf");
});
