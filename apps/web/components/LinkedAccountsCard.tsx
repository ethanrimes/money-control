"use client";

// Shows currently-linked institutions and the "+ Link account" button. When
// no accounts are linked it's the most prominent CTA on the dashboard —
// because none of the live-data widgets make sense until you link something.

import { useEffect, useState } from "react";
import { api, type EnrollmentRow, type TellerConfig } from "@/lib/api";
import { Card } from "./Card";
import { LinkAccountButton } from "./LinkAccountButton";

export function LinkedAccountsCard({
  refreshKey,
  onChange,
}: {
  refreshKey: number;
  onChange: () => void;
}) {
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null);
  const [config, setConfig] = useState<TellerConfig | null>(null);

  useEffect(() => {
    api.enrollments().then(setEnrollments).catch(() => setEnrollments([]));
    api.tellerConfig().then(setConfig).catch(() => {});
  }, [refreshKey]);

  async function disconnect(id: number, name: string) {
    if (!confirm(`Disconnect ${name}? Existing transactions stay in the DB; future syncs will skip this institution.`)) return;
    await api.deleteEnrollment(id);
    onChange();
  }

  const showSetupHint = config && (!config.appId || !config.mtlsConfigured);

  return (
    <Card
      title="Linked institutions"
      action={<LinkAccountButton onLinked={onChange} />}
    >
      {showSetupHint && (
        <div className="mb-3 rounded-md border border-border bg-bg p-3 text-xs text-muted">
          <div className="mb-1 font-medium text-text">Setup needed before you can link an account:</div>
          <ul className="ml-4 list-disc space-y-0.5">
            {config && !config.appId && (
              <li>
                Sign up at <a className="underline" href="https://teller.io" target="_blank" rel="noreferrer">teller.io</a> to get an <code className="rounded bg-surface px-1">Application ID</code>, then set <code className="rounded bg-surface px-1">TELLER_APP_ID</code> in <code className="rounded bg-surface px-1">.env</code> and restart the server.
              </li>
            )}
            {config && !config.mtlsConfigured && (
              <li>
                Put your Teller <code className="rounded bg-surface px-1">certificate.pem</code> + <code className="rounded bg-surface px-1">private_key.pem</code> in the <code className="rounded bg-surface px-1">teller/</code> folder at the repo root.
              </li>
            )}
          </ul>
        </div>
      )}

      {enrollments === null ? (
        <div className="h-16 animate-pulse rounded bg-bg" />
      ) : enrollments.length === 0 ? (
        <p className="text-sm text-muted">
          No accounts linked yet. Click <span className="font-medium text-text">+ Link account</span> above to connect a bank or credit card. Once linked, click <span className="font-medium text-text">Refresh</span> in the top right to pull balances and transactions.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {enrollments.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between border-t border-border/50 pt-2 first:border-0 first:pt-0"
            >
              <div>
                <div className="font-medium">{e.institutionName}</div>
                <div className="text-xs text-muted">
                  Linked {new Date(e.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => disconnect(e.id, e.institutionName)}
                className="rounded-md border border-transparent px-2 py-1 text-xs text-muted hover:border-border hover:text-negative"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
