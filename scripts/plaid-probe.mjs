// Verifies the Plaid credentials in .env by calling
// POST /institutions/get_by_id — an authenticated endpoint that needs
// client_id + secret but no access_token (no user data exchanged).
//
// 200 OK with a JSON body confirms creds are valid for that environment.
// 400/401 with structured error confirms creds reach Plaid but are rejected.

const ENVS = {
  sandbox: { url: "https://sandbox.plaid.com", secret: process.env.PLAID_SANDBOX_SECRET },
  production: { url: "https://production.plaid.com", secret: process.env.PLAID_PRODUCTION_SECRET },
};

const clientId = process.env.PLAID_CLIENT_ID;
if (!clientId) {
  console.error("PLAID_CLIENT_ID missing from env");
  process.exit(1);
}

for (const [name, { url, secret }] of Object.entries(ENVS)) {
  if (!secret) {
    console.log(`\n[${name}] no secret in env — skipping`);
    continue;
  }
  try {
    const res = await fetch(`${url}/institutions/get_by_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        institution_id: "ins_3", // Chase — well-known stable institution id
        country_codes: ["US"],
      }),
    });
    const body = await res.json();
    if (res.ok) {
      console.log(`\n[${name}] OK — credentials valid`);
      console.log(`  resolved: ${body.institution?.name ?? "(no name)"} (${body.institution?.institution_id})`);
      console.log(`  products: ${body.institution?.products?.join(", ")}`);
    } else {
      console.log(`\n[${name}] HTTP ${res.status} — ${body.error_code}: ${body.error_message}`);
    }
  } catch (err) {
    console.log(`\n[${name}] network error: ${err.message}`);
  }
}
