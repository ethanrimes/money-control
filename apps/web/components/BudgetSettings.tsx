"use client";

import { useEffect, useState } from "react";
import { api, fmtUsd, type BudgetSettings as BudgetSettingsT } from "@/lib/api";

export function BudgetSettings({ onChange }: { onChange: () => void }) {
  const [settings, setSettings] = useState<BudgetSettingsT | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.budget().then((s) => {
      setSettings(s);
      setDraft(String(s?.monthlySavingsTarget ?? ""));
    }).catch(() => {});
  }, []);

  async function save() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      alert("Enter a non-negative number");
      return;
    }
    setSaving(true);
    try {
      const s = await api.putBudget({ monthlySavingsTarget: n });
      setSettings(s);
      setEditing(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-muted underline-offset-2 hover:underline"
        title="Adjust monthly savings target"
      >
        Savings target: {settings ? fmtUsd(settings.monthlySavingsTarget) : "—"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">$</span>
      <input
        type="number"
        min={0}
        step={50}
        className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-xs tabular"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
      />
      <button onClick={save} disabled={saving} className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="rounded-md border border-border px-2 py-1 text-xs">Cancel</button>
    </div>
  );
}
