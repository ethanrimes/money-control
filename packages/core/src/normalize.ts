// Description normalization for categorization rule lookup.
// Strip noise so "AMZN MKTP US*ABC123" and "AMZN Mktp US*XYZ789" collapse
// onto a stable rule key.
export function normalizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[*#]+\s*\w+/g, "") // strip "*ABC123" suffixes
    .replace(/\b\d{6,}\b/g, "")  // strip long digit runs (txn ids, ref nums)
    .replace(/[^a-z0-9 ./&-]/g, "")
    .trim();
}
