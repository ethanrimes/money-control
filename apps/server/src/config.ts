import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),
  teller: {
    env: (process.env.TELLER_ENV ?? "sandbox") as "sandbox" | "development" | "production",
    appId: process.env.TELLER_APP_ID ?? "",
    certPath: process.env.TELLER_CERT_PATH ?? path.join(repoRoot, "teller", "certificate.pem"),
    keyPath: process.env.TELLER_KEY_PATH ?? path.join(repoRoot, "teller", "private_key.pem"),
    apiBase: "https://api.teller.io",
  },
};
