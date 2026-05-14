import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = (() => {
  try {
    const d = import.meta.dirname;
    if (d) return path.resolve(d, "../../..");
  } catch {}
  return process.cwd();
})();

// On serverless platforms (Vercel) the repo's ./teller dir isn't writable and
// the cert/key files aren't checked in. Instead we accept base64-encoded
// material via env vars and write it to /tmp once per cold start. This keeps
// local dev working unchanged (env vars unset → fall back to ./teller/*.pem).
function materializeTellerCert(): { certPath: string; keyPath: string } {
  const certB64 = process.env.TELLER_CERT_B64;
  const keyB64 = process.env.TELLER_KEY_B64;
  if (!certB64 || !keyB64) {
    return {
      certPath:
        process.env.TELLER_CERT_PATH ??
        path.join(repoRoot, "teller", "certificate.pem"),
      keyPath:
        process.env.TELLER_KEY_PATH ??
        path.join(repoRoot, "teller", "private_key.pem"),
    };
  }
  const dir = process.env.TELLER_CERT_DIR ?? os.tmpdir();
  const certPath = path.join(dir, "teller-cert.pem");
  const keyPath = path.join(dir, "teller-key.pem");
  try {
    if (!fs.existsSync(certPath)) {
      fs.writeFileSync(certPath, Buffer.from(certB64, "base64"), { mode: 0o600 });
    }
    if (!fs.existsSync(keyPath)) {
      fs.writeFileSync(keyPath, Buffer.from(keyB64, "base64"), { mode: 0o600 });
    }
  } catch (err) {
    console.error("failed to write Teller cert/key from env:", err);
  }
  return { certPath, keyPath };
}

const tellerPaths = materializeTellerCert();

const plaidEnv = (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "production";
export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),
  teller: {
    env: (process.env.TELLER_ENV ?? "sandbox") as "sandbox" | "development" | "production",
    appId: process.env.TELLER_APP_ID ?? "",
    signingKey: process.env.TELLER_SIGNING_KEY ?? "",
    certPath: tellerPaths.certPath,
    keyPath: tellerPaths.keyPath,
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
