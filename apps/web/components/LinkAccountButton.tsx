"use client";

// Loads the Teller Connect JS SDK and renders a "Link account" button that
// opens its modal. On success, POSTs the enrollment to /teller/enrollments
// (which persists the access_token in SQLite so the link survives restarts).

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { api, type TellerConfig, type TellerEnrollmentPayload } from "@/lib/api";

interface TellerConnectInstance {
  open: () => void;
}

interface TellerConnectSDK {
  setup(opts: {
    applicationId: string;
    environment: "sandbox" | "development" | "production";
    selectAccount?: "single" | "multiple" | "disabled";
    products?: Array<"transactions" | "balance" | "identity" | "verify">;
    onInit?: () => void;
    onSuccess?: (enrollment: TellerEnrollmentPayload) => void;
    onExit?: () => void;
    onFailure?: (failure: unknown) => void;
  }): TellerConnectInstance;
}

declare global {
  interface Window {
    TellerConnect?: TellerConnectSDK;
  }
}

export function LinkAccountButton({ onLinked }: { onLinked: () => void }) {
  const [config, setConfig] = useState<TellerConfig | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const tellerRef = useRef<TellerConnectInstance | null>(null);

  useEffect(() => {
    api.tellerConfig()
      .then(setConfig)
      .catch((e) => setStatus({ kind: "error", msg: String(e) }));
  }, []);

  // (Re-)initialize when the script loads AND we have a valid appId. Teller's
  // SDK lets us setup() once and call open() many times.
  useEffect(() => {
    if (!scriptReady || !config?.appId) return;
    if (typeof window === "undefined" || !window.TellerConnect) return;

    tellerRef.current = window.TellerConnect.setup({
      applicationId: config.appId,
      environment: config.environment,
      selectAccount: "multiple",
      products: ["transactions", "balance"],
      onSuccess: async (payload) => {
        try {
          await api.createEnrollment(payload);
          setStatus({
            kind: "success",
            msg: `Linked ${payload.enrollment.institution.name}. Click Refresh to sync.`,
          });
          onLinked();
        } catch (e) {
          setStatus({ kind: "error", msg: String(e) });
        } finally {
          setBusy(false);
        }
      },
      onExit: () => setBusy(false),
      onFailure: (failure) => {
        setStatus({ kind: "error", msg: `Teller error: ${JSON.stringify(failure)}` });
        setBusy(false);
      },
    });
  }, [scriptReady, config, onLinked]);

  const reasonDisabled = (() => {
    if (!config) return "Loading…";
    if (!config.appId) return "Set TELLER_APP_ID in .env to enable linking";
    if (!config.mtlsConfigured) return "Missing teller/certificate.pem + private_key.pem";
    if (!scriptReady) return "Loading Teller Connect…";
    return null;
  })();
  const disabled = busy || reasonDisabled !== null;

  function openModal() {
    if (!tellerRef.current) return;
    setBusy(true);
    setStatus(null);
    tellerRef.current.open();
  }

  return (
    <>
      <Script
        src="https://cdn.teller.io/connect/connect.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setStatus({ kind: "error", msg: "Failed to load Teller Connect SDK" })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={openModal}
          disabled={disabled}
          title={reasonDisabled ?? "Link a bank or credit card via Teller"}
          className="inline-flex items-center gap-2 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-bg disabled:text-muted"
        >
          <span aria-hidden>+</span>
          {busy ? "Opening…" : "Link account"}
        </button>
        {status && (
          <span className={`text-xs ${status.kind === "success" ? "text-positive" : "text-negative"}`}>
            {status.msg}
          </span>
        )}
        {!status && reasonDisabled && config && (
          <span className="text-xs text-muted">{reasonDisabled}</span>
        )}
      </div>
    </>
  );
}
