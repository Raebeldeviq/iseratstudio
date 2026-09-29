export function filterManagedListingsByObjectNumber(entries, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("de-DE");
  if (!needle) return entries;
  return entries.filter(({ listing }) =>
    String(listing.externalId || "").toLocaleLowerCase("de-DE").includes(needle));
}
