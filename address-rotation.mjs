const text = (value) => String(value ?? "").trim();

export function parseAddressPoolRows(rows, pool) {
  if (pool !== "A" && pool !== "B") throw new Error("Unbekannter Adresspool.");
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Pool_${pool} ist leer.`);
  const normalize = (value) => text(value).toLocaleLowerCase("de-DE").normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "").replace(/ß/gu, "ss").replace(/[^a-z0-9]/gu, "");
  const columns = new Map(rows[0].map((value, index) => [normalize(value), index]));
  const column = (...names) => names.map(normalize).map((name) => columns.get(name)).find((index) => index !== undefined);
  const indexes = {
    plotId: column("plotId", "Grundstücks-ID"), street: column("Straße", "Strasse"),
    houseNumber: column("Hausnummer", "Hausnr"), postalCode: column("PLZ", "Postleitzahl"),
    city: column("Ort", "Stadt"), plotSizeSqm: column("Größe (m²)", "Grundstücksfläche m²"),
    purchasePrice: column("Preis (€)", "Grundstückspreis €"),
  };
  for (const field of ["plotId", "street", "houseNumber", "postalCode", "city"]) {
    if (indexes[field] === undefined) throw new Error(`Pool_${pool}: Pflichtspalte ${field} fehlt.`);
  }
  const parsed = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (!index || row.every((value) => !text(value))) continue;
    const get = (field) => text(row[indexes[field]]);
    const plotId = get("plotId");
    const address = {
      street: get("street"), houseNumber: get("houseNumber"),
      postalCode: get("postalCode").padStart(5, "0"), city: get("city"),
    };
    if (!plotId || !address.street || !address.houseNumber || !/^\d{5}$/u.test(address.postalCode) || !address.city) {
      throw new Error(`Pool_${pool}, Zeile ${index + 1}: plotId oder vollständige Adresse fehlt.`);
    }
    if (seen.has(plotId)) throw new Error(`Pool_${pool}: plotId ${plotId} kommt mehrfach vor.`);
    seen.add(plotId);
    parsed.push({ plotId, pool, address,
      plotSizeSqm: Number(row[indexes.plotSizeSqm]) || 0,
      purchasePrice: Number(row[indexes.purchasePrice]) || 0 });
  }
  return parsed;
}

export function mergeAddressPools(plots, poolA, poolB) {
  const byId = new Map(plots.map((plot) => [plot.id, plot]));
  const result = new Map();
  for (const row of [...poolA, ...poolB]) {
    const entry = result.get(row.plotId) || { A: null, B: null };
    entry[row.pool] = row;
    result.set(row.plotId, entry);
  }
  const unknown = [...result.keys()].filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`${unknown.length} plotId(s) sind im Grundstückskatalog unbekannt: ${unknown.slice(0, 5).join(", ")}.`);
  return plots.map((plot) => {
    const rows = result.get(plot.id);
    if (!rows) return plot;
    const current = plot.addressRotation || {};
    return { ...plot, addressRotation: {
      poolA: rows.A?.address || null, poolB: rows.B?.address || null,
      currentPool: current.currentPool || "",
      cycle: Number(current.cycle) || 0,
      listingIds: Array.isArray(current.listingIds) ? current.listingIds : [],
      lastUsedA: current.lastUsedA || "", lastUsedB: current.lastUsedB || "",
    } };
  });
}

export function addressRotationStatus(state, plotId, options = {}) {
  const plot = (state.plots || []).find((item) => item.id === plotId);
  const rotation = plot?.addressRotation;
  if (!rotation) return { state: "unconfigured", currentPool: "", nextPool: "", remaining: 0, cycle: 0 };
  const currentPool = rotation.currentPool || "";
  const nextPool = currentPool === "A" ? "B" : "A";
  const nextAddress = nextPool === "A" ? rotation.poolA : rotation.poolB;
  const readyPair = Boolean(rotation.poolA && rotation.poolB && rotation.poolB.houseNumber
    && rotation.poolBDetails?.status !== "POOL_B_PRÜFEN");
  if (!currentPool) return { state: readyPair || (options.initialPoolAOnly === true && rotation.poolA) ? "ready" : "incomplete", currentPool, nextPool, remaining: 0, cycle: 0 };
  const ids = rotation.listingIds || [];
  const project = (state.projects || []).find((item) => item.plotId === plotId);
  const entries = (state.deleteBatches || []).flatMap((batch) => batch.entries || []);
  const remaining = ids.filter((id) => {
    const listing = project?.listings?.find((item) => item.id === id);
    const entry = entries.find((item) => item.listingId === id && item.externalId === listing?.externalId && item.status !== "void");
    const control = project?.listingGroup?.listingControls?.find((item) => item.listingId === id);
    return !listing || !entry || entry.status !== "deleted" || control?.premiumPlacement || (control?.manualLock && listing.status !== "deleted");
  }).length;
  return { state: ids.length === 4 && remaining === 0 && nextAddress && readyPair ? "ready" : "active",
    currentPool, nextPool, remaining, cycle: Number(rotation.cycle) || 0 };
}

export function snapshotAddressRotation(state, plotId, listings, at = new Date().toISOString(), options = {}) {
  const status = addressRotationStatus(state, plotId, options);
  if (status.state !== "ready" || listings.length !== 4) throw new Error("Für den nächsten Adresszyklus fehlen die Freigabe oder vier Hausinserate.");
  if (new Set(listings.map((listing) => listing.id)).size !== 4
    || listings.some((listing) => (state.plots.find((plot) => plot.id === plotId)?.addressRotation?.listingIds || []).includes(listing.id))) {
    throw new Error("Der neue Zyklus benötigt vier neue, eindeutige Inserate.");
  }
  const pool = status.nextPool;
  const cycle = status.cycle + 1;
  const plot = state.plots.find((item) => item.id === plotId);
  const address = structuredClone(pool === "A" ? plot.addressRotation.poolA : plot.addressRotation.poolB);
  const entries = (state.deleteBatches || []).flatMap((batch) => batch.entries || []);
  const nextListings = listings.map((listing, index) => {
    const entry = entries.find((item) => item.listingId === listing.id && item.externalId === listing.externalId);
    if (!entry || entry.status !== "planned") throw new Error(`Für Haus ${index + 1} fehlt ein neuer geplanter Lösch-Batch.`);
    return { ...listing, addressSnapshot: { plotId, pool, cycle, housePosition: index + 1,
      address, batchId: entry.batchId, plannedDeletionDate: entry.plannedDeletionDate } };
  });
  return { pool, cycle, address, listings: nextListings, rotation: {
    ...plot.addressRotation, currentPool: pool, cycle, listingIds: nextListings.map((item) => item.id),
    [pool === "A" ? "lastUsedA" : "lastUsedB"]: at,
  } };
}
