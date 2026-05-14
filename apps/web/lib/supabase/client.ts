"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Used for sign-in/sign-up forms and the
// sign-out button. Server components should use lib/supabase/server.ts.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
