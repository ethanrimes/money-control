"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="text-sm text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
