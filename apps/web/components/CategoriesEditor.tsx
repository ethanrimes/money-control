"use client";

// Two-column spreadsheet for managing categories + subcategories. Each row is
// either a top-level category (subcategory cell empty) or a subcategory under
// a chosen parent. The transactions table's category dropdown reads from the
// same /categories endpoint, so dropdown options stay in sync automatically.

import { useEffect, useMemo, useState } from "react";
import { api, type CategoryNode } from "@/lib/api";
import { Card } from "./Card";

type CategoryType = "expense" | "income" | "transfer";

interface FlatRow {
  // The (top-level) category this row contributes to.
  categoryId: number;
  categoryName: string;
  categoryType: CategoryType;
  // If null, the row is the parent itself; otherwise it's a subcategory.
  subcategoryId: number | null;
  subcategoryName: string | null;
  subcategoryType: CategoryType | null;
}

export function CategoriesEditor({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [cats, setCats] = useState<CategoryNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Adding a new row state: chooses an existing top-level (or creates one
  // inline by typing a fresh name) and an optional subcategory name.
  const [draftCategory, setDraftCategory] = useState("");
  const [draftSubcategory, setDraftSubcategory] = useState("");
  const [draftType, setDraftType] = useState<CategoryType>("expense");

  useEffect(() => {
    api.categories().then(setCats).catch((e) => setErr(String(e)));
  }, [refreshKey]);

  // Flatten the tree so the grid renders one row per (parent, sub | null).
  // Parents with no subcategories produce one row; those with N subcategories
  // produce N rows (subcategory column shows the sub name).
  const rows = useMemo<FlatRow[]>(() => {
    if (!cats) return [];
    const out: FlatRow[] = [];
    for (const c of cats) {
      if (c.subcategories.length === 0) {
        out.push({
          categoryId: c.id,
          categoryName: c.name,
          categoryType: c.type,
          subcategoryId: null,
          subcategoryName: null,
          subcategoryType: null,
        });
      } else {
        for (const s of c.subcategories) {
          out.push({
            categoryId: c.id,
            categoryName: c.name,
            categoryType: c.type,
            subcategoryId: s.id,
            subcategoryName: s.name,
            subcategoryType: s.type,
          });
        }
      }
    }
    return out.sort((a, b) => {
      const ac = a.categoryName.localeCompare(b.categoryName);
      if (ac !== 0) return ac;
      return (a.subcategoryName ?? "").localeCompare(b.subcategoryName ?? "");
    });
  }, [cats]);

  async function reload() {
    const fresh = await api.categories();
    setCats(fresh);
    onChange();
  }

  async function renameCategory(id: number, name: string) {
    setBusy(true);
    try { await api.patchCategory(id, { name }); await reload(); }
    catch (e) { alert(`Rename failed: ${e}`); }
    finally { setBusy(false); }
  }

  async function changeType(id: number, type: CategoryType) {
    setBusy(true);
    try { await api.patchCategory(id, { type }); await reload(); }
    catch (e) { alert(`Type change failed: ${e}`); }
    finally { setBusy(false); }
  }

  async function deleteRow(row: FlatRow) {
    const target = row.subcategoryId !== null
      ? { id: row.subcategoryId, name: `${row.categoryName} / ${row.subcategoryName}`, isParent: false }
      : { id: row.categoryId, name: row.categoryName, isParent: true };

    let cascade = false;
    if (target.isParent) {
      const parent = cats?.find((c) => c.id === target.id);
      const childCount = parent?.subcategories.length ?? 0;
      if (childCount > 0) {
        cascade = confirm(`"${target.name}" has ${childCount} subcategor${childCount === 1 ? "y" : "ies"}.\n\nOK = delete category AND its subcategories.\nCancel = keep subcategories (promote them to top-level).`);
      } else {
        if (!confirm(`Delete "${target.name}"? Transactions using it become uncategorized.`)) return;
      }
    } else {
      if (!confirm(`Delete subcategory "${target.name}"? Transactions using it become uncategorized.`)) return;
    }

    setBusy(true);
    try { await api.deleteCategory(target.id, { cascade }); await reload(); }
    catch (e) { alert(`Delete failed: ${e}`); }
    finally { setBusy(false); }
  }

  async function addRow() {
    const catName = draftCategory.trim();
    const subName = draftSubcategory.trim();
    if (!catName) {
      alert("Category name is required");
      return;
    }
    setBusy(true);
    try {
      // Reuse existing top-level if name matches; otherwise create.
      const existingTop = cats?.find((c) => c.name.toLowerCase() === catName.toLowerCase());
      const parent = existingTop ?? await api.createCategory({ name: catName, type: draftType });
      if (subName) {
        await api.createCategory({ name: subName, parentId: parent.id });
      }
      setDraftCategory("");
      setDraftSubcategory("");
      await reload();
    } catch (e) {
      alert(`Add failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Categories" subtitle="The transactions table dropdown only allows values from this sheet">
      {err && <div className="text-sm text-negative">{err}</div>}
      {!cats && <div className="h-40 animate-pulse rounded bg-bg" />}
      {cats && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border py-2 pr-4 font-medium">Category</th>
                <th className="border-b border-border py-2 pr-4 font-medium">Subcategory</th>
                <th className="border-b border-border py-2 pr-4 font-medium">Type</th>
                <th className="border-b border-border py-2 pr-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.categoryId}-${r.subcategoryId ?? "_"}`} className="hover:bg-bg/60">
                  <td className="border-b border-border/50 py-1 pr-4">
                    <InlineEdit
                      value={r.categoryName}
                      onCommit={(v) => renameCategory(r.categoryId, v)}
                      disabled={busy}
                    />
                  </td>
                  <td className="border-b border-border/50 py-1 pr-4">
                    {r.subcategoryId !== null ? (
                      <InlineEdit
                        value={r.subcategoryName ?? ""}
                        onCommit={(v) => renameCategory(r.subcategoryId!, v)}
                        disabled={busy}
                      />
                    ) : (
                      <span className="text-xs text-muted/70">—</span>
                    )}
                  </td>
                  <td className="border-b border-border/50 py-1 pr-4">
                    {/* Each row (category OR subcategory) has its own type.
                        Subcategories no longer inherit from parent — the
                        user wants per-row control (e.g. "Sergio" under
                        Transfers should be 'expense', not 'transfer'). */}
                    <select
                      className="rounded border border-border bg-bg px-1.5 py-1 text-xs"
                      value={r.subcategoryType ?? r.categoryType}
                      onChange={(e) => changeType(
                        r.subcategoryId ?? r.categoryId,
                        e.target.value as CategoryType,
                      )}
                      disabled={busy}
                      title={r.subcategoryId !== null
                        ? "Set this subcategory's type (independent of parent)"
                        : "Set category type"}
                    >
                      <option value="expense">expense</option>
                      <option value="income">income</option>
                      <option value="transfer">transfer</option>
                    </select>
                  </td>
                  <td className="border-b border-border/50 py-1 pr-2 text-right">
                    <button
                      onClick={() => deleteRow(r)}
                      disabled={busy}
                      className="rounded-md border border-transparent px-2 py-1 text-xs text-muted hover:border-border hover:text-negative disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-bg/40">
                <td className="py-2 pr-4">
                  <input
                    list="categories-existing"
                    placeholder="Category…"
                    className="w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                  />
                  <datalist id="categories-existing">
                    {cats.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </td>
                <td className="py-2 pr-4">
                  <input
                    placeholder="Subcategory (optional)…"
                    className="w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    value={draftSubcategory}
                    onChange={(e) => setDraftSubcategory(e.target.value)}
                  />
                </td>
                <td className="py-2 pr-4">
                  <select
                    className="rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value as CategoryType)}
                  >
                    <option value="expense">expense</option>
                    <option value="income">income</option>
                    <option value="transfer">transfer</option>
                  </select>
                </td>
                <td className="py-2 pr-2 text-right">
                  <button
                    onClick={addRow}
                    disabled={busy || draftCategory.trim().length === 0}
                    className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    + Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Click-to-edit text. Defers committing until blur or Enter.
function InlineEdit({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep draft in sync with prop when not editing (e.g. after a refresh).
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="w-full rounded border border-transparent px-1 py-0.5 text-left hover:border-border disabled:opacity-50"
      >
        {value}
      </button>
    );
  }
  function commit() {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  }
  return (
    <input
      autoFocus
      className="w-full rounded border border-border bg-bg px-1.5 py-1 text-xs"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
    />
  );
}
