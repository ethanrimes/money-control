// Hits Teller's (BETA) institutions endpoint with our mTLS cert and prints
// anything matching "amex" / "american express". The list is the authoritative
// source for which institutions Teller has integrations with.

import fs from "node:fs";
import path from "node:path";
import { Agent, fetch } from "undici";

const root = path.resolve(import.meta.dirname, "..");
const cert = fs.readFileSync(path.join(root, "teller", "certificate.pem"), "utf8");
const key = fs.readFileSync(path.join(root, "teller", "private_key.pem"), "utf8");
const dispatcher = new Agent({ connect: { cert, key } });

// The institutions endpoint is auth-required but doesn't need an enrollment
// access_token — your application credentials suffice. Try a couple of likely
// auth shapes; print whichever works.
async function tryFetch(label, headers) {
  try {
    const res = await fetch("https://api.teller.io/institutions", { headers, dispatcher });
    const body = await res.text();
    console.log(`\n=== ${label} -> HTTP ${res.status} ===`);
    if (res.ok) return JSON.parse(body);
    console.log(body.slice(0, 200));
    return null;
  } catch (e) {
    console.log(`\n=== ${label} -> error: ${e.message}`);
    return null;
  }
}

// Try with no auth (some BETA endpoints allow it), then with the app id basic-auth.
let data = await tryFetch("no auth", { Accept: "application/json" });
if (!data) {
  const appId = process.env.TELLER_APP_ID;
  if (appId) {
    const basic = "Basic " + Buffer.from(`${appId}:`).toString("base64");
    data = await tryFetch("appId basic auth", { Accept: "application/json", Authorization: basic });
  }
}

if (!data || !Array.isArray(data)) {
  console.log("\nCould not retrieve institutions list. Falling back: just confirming cert works against /accounts.");
  process.exit(1);
}

console.log(`\nTotal institutions returned: ${data.length}`);
const matches = data.filter((i) => /amex|american\s*express/i.test(i.name ?? ""));
console.log(`\nMatches for amex / american express: ${matches.length}`);
for (const m of matches) {
  console.log(JSON.stringify(m, null, 2));
}
