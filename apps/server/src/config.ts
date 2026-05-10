import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const plaidEnv = (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "production";
export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),
  teller: {
    env: (process.env.TELLER_ENV ?? "sandbox") as "sandbox" | "development" | "production",
    appId: process.env.TELLER_APP_ID ?? "",
    signingKey: process.env.TELLER_SIGNING_KEY ?? "",
    certPath: process.env.TELLER_CERT_PATH ?? path.join(repoRoot, "teller", "certificate.pem"),
    keyPath: process.env.TELLER_KEY_PATH ?? path.join(repoRoot, "teller", "private_key.pem"),
    apiBase: "https://api.teller.io",
  },
  plaid: {
    env: plaidEnv,
    clientId: process.env.PLAID_CLIENT_ID ?? "",
    // Per-environment secret. Reads PLAID_SANDBOX_SECRET in sandbox,
    // PLAID_PRODUCTION_SECRET in production — never both at once.
    secret: plaidEnv === "production"
      ? (process.env.PLAID_PRODUCTION_SECRET ?? "")
      : (process.env.PLAID_SANDBOX_SECRET ?? ""),
  },
};
