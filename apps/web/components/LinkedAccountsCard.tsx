"use client";

// Single card that owns: linked institutions (each with its child accounts),
// orphan accounts (seeded or pre-link), and the running net-cash total at the
// bottom. Replaces the separate NetCashCard.

import { useEffect, useState } from "react";
import {
  api,
  fmtUsd,
  type AccountsSummary,
  type TellerConfig,
} from "@/lib/api";
import { Card } from "./Card";
import { LinkAccountButton } from "./LinkAccountButton";
import { PlaidLinkButton } from "./PlaidLinkButton";

export function LinkedAccountsCard({
  refreshKey,
  onChange,
}: {
  refreshKey: number;
  onChange: () => void;
}) {
  const [summary, setSummary] = useState<AccountsSummary | null>(null);
  const [config, setConfig] = useState<TellerConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.accountsSummary().then(setSummary).catch((e) => setErr(String(e)));
    api.tellerConfig().then(setConfig).catch(() => {});
  }, [refreshKey]);

  async function disconnect(group: AccountsSummary["groups"][number]) {
    if (group.enrollmentId === 0) return; // orphans aren't disconnectable
    if (!confirm(`Disconnect ${group.institutionName}? Past transactions stay in the DB; future syncs will skip this institution.`)) return;
    if (group.kind === "plaid") await api.plaidDeleteItem(group.enrollmentId);
    else await api.deleteEnrollment(group.enrollmentId);
    onChange();
  }

  const showSetupHint = config && (!config.appId || !config.mtlsConfigured);
  // Orphan group (seeded-from-Excel accounts not backed by any aggregator)
  // is intentionally hidden: those accounts have $0 live balance and are
  // just visual noise. Their historical transactions stay in the DB and
  // continue to appear in the transactions table.
  const linkedGroups = summary?.groups.filter((g) => g.enrollmentId !== 0) ?? [];

  return (
    <Card
      title="Accounts"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <PlaidLinkButton onLinked={onChange} />
          <LinkAccountButton onLinked={onChange} />
        </div>
      }
    >
      {err && <div className="mb-3 text-sm text-negative">{err}</div>}

      {showSetupHint && (
        <div className="mb-3 rounded-md border border-border bg-bg p-3 text-xs text-muted">
          <div className="mb-1 font-medium text-text">Setup needed before you can link an account:</div>
          <ul className="ml-4 list-disc space-y-0.5">
            {config && !config.appId && (
              <li>
                Sign up at <a className="underline" href="https://teller.io" target="_blank" rel="noreferrer">teller.io</a>, then set <code className="rounded bg-surface px-1">TELLER_APP_ID</code> in <code className="rounded bg-surface px-1">.env</code> and restart the server.
              </li>
            )}
            {config && !config.mtlsConfigured && (
              <li>
                Put <code className="rounded bg-surface px-1">certificate.pem</code> + <code className="rounded bg-surface px-1">private_key.pem</code> in the <code className="rounded bg-surface px-1">teller/</code> folder.
              </li>
            )}
          </ul>
        </div>
      )}

      {summary === null ? (
        <div className="h-32 animate-pulse rounded bg-bg" />
      ) : summary.groups.length === 0 ? (
        <p className="text-sm text-muted">
          No accounts yet. Click <span className="font-medium text-text">+ Link account</span> to connect a bank or credit card. Then click <span className="font-medium text-text">Refresh</span> in the header to pull balances and transactions.
        </p>
      ) : (
        <div className="space-y-4">
          {linkedGroups.map((g) => (
            <InstitutionBlock
              key={`${g.kind}-${g.enrollmentId}`}
              name={g.institutionName}
              badge={g.kind === "plaid" ? "Plaid" : g.kind === "teller" ? "Teller" : undefined}
              accounts={g.accounts}
              onDisconnect={() => disconnect(g)}
            />
          ))}
        </div>
      )}

      {summary && (
        <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
          <div>
            <div className="text-xs text-muted">Net cash position</div>
            <div className="text-xs text-muted/80">
              {fmtUsd(summary.totalDepository)} cash · {fmtUsd(summary.totalCredit)} debt
            </div>
          </div>
          <div className={`text-2xl font-semibold tabular ${summary.netCash >= 0 ? "text-text" : "text-negative"}`}>
            {fmtUsd(summary.netCash)}
          </div>
        </div>
      )}
    </Card>
  );
}

function InstitutionBlock({
  name,
  accounts,
  onDisconnect,
  subtle = false,
  badge,
}: {
  name: string;
  accounts: AccountsSummary["groups"][number]["accounts"];
  onDisconnect?: () => void;
  subtle?: boolean;
  badge?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`text-sm font-medium ${subtle ? "text-muted" : "text-text"}`}>{name}</div>
          {badge && (
            <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              {badge}
            </span>
          )}
        </div>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="rounded-md border border-transparent px-2 py-1 text-xs text-muted hover:border-border hover:text-negative"
          >
            Disconnect
          </button>
        )}
      </div>
      {accounts.length === 0 ? (
        <p className="ml-3 text-xs text-muted">
          Linked but no accounts pulled yet. Click <span className="font-medium text-text">Refresh</span> to sync.
        </p>
      ) : (
        <ul className="ml-3 space-y-1.5 text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between border-l-2 border-border/60 pl-3">
              <div>
                <div>{a.name}</div>
                <div className="text-xs text-muted">
                  {a.type}
                  {a.lastFour && ` · ••${a.lastFour}`}
                </div>
              </div>
              <div className={`tabular ${a.signedBalance < 0 ? "text-negative" : "text-text"}`}>
                {fmtSignedUsd(a.signedBalance)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtSignedUsd(n: number): string {
  if (n < 0) return `−${fmtUsd(-n)}`;
  if (n > 0) return `+${fmtUsd(n)}`;
  return fmtUsd(0);
}
