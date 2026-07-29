import type {
  CompanySettings,
  GeneratedListing,
  ProjectInput,
} from "../types";

export type ExposePdfOptions = {
  includeContact: boolean;
  includeAddress: boolean;
  includeImages: boolean;
  includeLogo: boolean;
  includePageNumbers: boolean;
  includeColors: boolean;
  firstPageOnly: boolean;
};

export type ExposeImage = {
  dataUrl: string;
  caption: string;
};

type PdfDocument = InstanceType<(typeof import("jspdf"))["jsPDF"]>;

function safeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function pdfText(value: string): string {
  return value
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function imageFormat(dataUrl: string): "PNG" | "WEBP" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function addHeader(
  doc: PdfDocument,
  company: CompanySettings,
  options: ExposePdfOptions,
): void {
  const accent = options.includeColors ? [120, 163, 61] as const : [75, 75, 75] as const;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, 210, 11, "F");
  if (options.includeLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(34, 53, 42);
    doc.text(pdfText(company.name || "Inserate Studio"), 16, 22);
  }
}

function addFooter(
  doc: PdfDocument,
  company: CompanySettings,
  page: number,
  pageCount: number,
  options: ExposePdfOptions,
): void {
  doc.setDrawColor(215, 221, 213);
  doc.line(16, 284, 194, 284);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(105, 113, 107);
  doc.text(pdfText(company.name || "Inserate Studio"), 16, 290);
  if (options.includePageNumbers) {
    doc.text(`Seite ${page} von ${pageCount}`, 194, 290, { align: "right" });
  }
}

function drawCoverImage(
  doc: PdfDocument,
  image: ExposeImage | undefined,
): void {
  if (!image?.dataUrl) {
    doc.setFillColor(238, 242, 236);
    doc.roundedRect(16, 31, 178, 86, 3, 3, "F");
    doc.setTextColor(91, 105, 94);
    doc.setFontSize(12);
    doc.text("Objektansicht", 105, 76, { align: "center" });
    return;
  }
  try {
    doc.addImage(image.dataUrl, imageFormat(image.dataUrl), 16, 31, 178, 86, undefined, "FAST");
  } catch {
    doc.setFillColor(238, 242, 236);
    doc.roundedRect(16, 31, 178, 86, 3, 3, "F");
    doc.setTextColor(91, 105, 94);
    doc.setFontSize(11);
    doc.text("Bild konnte nicht in die PDF eingebettet werden.", 105, 76, { align: "center" });
  }
}

export async function buildExposePdf(input: {
  listing: GeneratedListing;
  project: ProjectInput;
  company: CompanySettings;
  images: ExposeImage[];
  options: ExposePdfOptions;
}): Promise<{ blob: Blob; filename: string }> {
  const { jsPDF } = await import("jspdf");
  const { listing, project, company, images, options } = input;
  const details = listing.management?.details;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  addHeader(doc, company, options);
  if (options.includeImages) drawCoverImage(doc, images[0]);

  const titleY = options.includeImages ? 130 : 40;
  doc.setTextColor(31, 45, 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  const titleLines = doc.splitTextToSize(
    pdfText(listing.texts.title || listing.templateName),
    178,
  );
  doc.text(titleLines.slice(0, 3), 16, titleY);

  const metaY = titleY + Math.min(titleLines.length, 3) * 8 + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(91, 105, 94);
  const location = options.includeAddress
    ? [details?.street, details?.houseNumber, details?.zip, details?.city]
      .filter(Boolean)
      .join(" ")
    : [details?.zip || project.zip, details?.city || project.city]
      .filter(Boolean)
      .join(" ");
  doc.text(pdfText(location), 16, metaY);

  const metricsY = metaY + 12;
  const metrics = [
    ["Kaufpreis", euro(details?.purchasePrice ?? listing.price)],
    ["Wohnfläche", `${details?.livingArea ?? 0} m²`],
    ["Zimmer", `${details?.rooms ?? 0}`],
    ["Grundstück", `${details?.plotArea ?? project.plotArea} m²`],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 16 + index * 45;
    if (options.includeColors) {
      doc.setFillColor(244, 248, 239);
      doc.roundedRect(x, metricsY, 41, 20, 2, 2, "F");
    } else {
      doc.setDrawColor(210, 210, 210);
      doc.roundedRect(x, metricsY, 41, 20, 2, 2, "S");
    }
    doc.setFontSize(7);
    doc.setTextColor(105, 113, 107);
    doc.text(pdfText(label.toUpperCase()), x + 3, metricsY + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(31, 45, 36);
    doc.text(pdfText(value), x + 3, metricsY + 14);
    doc.setFont("helvetica", "normal");
  });

  if (options.includeContact) {
    const contactY = metricsY + 30;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(31, 45, 36);
    doc.text("Ihr Kontakt", 16, contactY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(91, 105, 94);
    const contact = [
      `${details?.contactFirstName ?? ""} ${details?.contactLastName ?? ""}`.trim(),
      details?.contactPhone || company.phone,
      details?.contactEmail || company.email,
    ].filter(Boolean).join("  |  ");
    doc.text(pdfText(contact), 16, contactY + 6);
  }

  if (!options.firstPageOnly) {
    const sections = [
      ["Objektbeschreibung", listing.texts.description],
      ["Ausstattung", listing.texts.equipment],
      ["Lage", listing.texts.location],
      ["Weitere Angaben", listing.texts.other],
    ].filter(([, text]) => Boolean(text.trim()));

    sections.forEach(([heading, text]) => {
      doc.addPage();
      addHeader(doc, company, options);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(31, 45, 36);
      doc.text(pdfText(heading), 16, 31);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(58, 69, 61);
      const lines = doc.splitTextToSize(pdfText(text), 178);
      let y = 42;
      for (const line of lines) {
        if (y > 275) {
          doc.addPage();
          addHeader(doc, company, options);
          y = 30;
        }
        doc.text(line, 16, y);
        y += 5.2;
      }
    });

    if (options.includeImages && images.length > 1) {
      const gallery = images.slice(1);
      gallery.forEach((image, index) => {
        if (index % 2 === 0) {
          doc.addPage();
          addHeader(doc, company, options);
        }
        const y = index % 2 === 0 ? 28 : 158;
        try {
          doc.addImage(image.dataUrl, imageFormat(image.dataUrl), 16, y, 178, 112, undefined, "FAST");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(91, 105, 94);
          doc.text(pdfText(image.caption.slice(0, 110)), 16, y + 118);
        } catch {
          doc.setFillColor(238, 242, 236);
          doc.roundedRect(16, y, 178, 112, 3, 3, "F");
        }
      });
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    addFooter(doc, company, page, pageCount, options);
  }

  return {
    blob: doc.output("blob"),
    filename: `expose-${safeFilename(listing.externalId || listing.templateName) || "objekt"}.pdf`,
  };
}
