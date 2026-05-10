// Searches Plaid's institution index for Amex + Fidelity and prints coverage.
// Uses /institutions/search to find them, then /institutions/get_by_id to
// inspect supported products for each match.

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SANDBOX_SECRET;
const base = "https://sandbox.plaid.com";

async function plaid(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  return res.json();
}

async function search(query, products) {
  console.log(`\n=== Search: "${query}" — products=${products.join(",")} ===`);
  const r = await plaid("/institutions/search", {
    query,
    country_codes: ["US"],
    products,
  });
  if (!r.institutions) {
    console.log("  error:", r.error_message);
    return;
  }
  for (const inst of r.institutions.slice(0, 4)) {
    console.log(`  • ${inst.name} (${inst.institution_id})`);
    console.log(`    products: ${inst.products.join(", ")}`);
  }
}

await search("American Express", ["transactions"]);
await search("Fidelity", ["investments"]);

// Direct lookup — Plaid's Fidelity Investments brokerage institution
// historically has well-known IDs. Probe a few and any that resolve win.
async function getById(id) {
  const r = await plaid("/institutions/get_by_id", {
    institution_id: id,
    country_codes: ["US"],
  });
  if (r.institution) {
    console.log(`\n  ${id} → ${r.institution.name}`);
    console.log(`    products: ${r.institution.products.join(", ")}`);
  }
}
console.log("\n=== Direct lookups ===");
for (const id of ["ins_12", "ins_115617", "ins_115616", "ins_116794", "ins_127916"]) {
  await getById(id);
}
