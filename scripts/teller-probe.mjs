// Quick connectivity probe to Teller's API using the local mTLS material.
// Sends a fake bearer token, so 401 = mTLS + routing all healthy; cert problem
// would show up as a TLS error before we ever see an HTTP status.

import fs from "node:fs";
import path from "node:path";
import { Agent, fetch } from "undici";

const root = path.resolve(import.meta.dirname, "..");
const certPath = path.join(root, "teller", "certificate.pem");
const keyPath = path.join(root, "teller", "private_key.pem");

console.log(`cert: ${certPath}`);
console.log(`key:  ${keyPath}`);
console.log(`exists: cert=${fs.existsSync(certPath)}, key=${fs.existsSync(keyPath)}`);

const dispatcher = new Agent({
  connect: {
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
  },
});

const auth = "Basic " + Buffer.from("fake_token_for_probe:").toString("base64");
try {
  const res = await fetch("https://api.teller.io/accounts", {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
    dispatcher,
  });
  const body = await res.text();
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log("body:", body.slice(0, 300));
  if (res.status === 401) {
    console.log("\nOK — mTLS handshake succeeded, Teller rejected our fake token. Cert + key are valid.");
  }
} catch (err) {
  console.error("\nERROR:", err.message);
  if (err.cause) console.error("cause:", err.cause);
}
