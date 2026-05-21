// Catch-all bridge from Next.js → the Hono app. Validates the Supabase session
// cookie, then forwards the (Web standard) Request to app.fetch() with an
// internal x-user-id header that Hono's tenancy middleware trusts. Hono in
// turn wraps the handler in withUser(), which sets request.jwt.claims so RLS
// auto-scopes every query.
//
// Why this layout: keeping the auth check in the Next layer means the Supabase
// cookie never has to be parsed by Hono, and Hono stays portable (it still
// runs standalone in dev via apps/server/src/index.ts).

import { createClient } from "@supabase/supabase-js";
import { app } from "@moneycontrol/server/app";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request): Promise<Response> {
  // Two-mode auth so the same API works for the Next.js web client (which
  // sends Supabase session cookies) and the mobile app (which sends an
  // Authorization: Bearer <supabase-jwt> header).
  let userId: string | null = null;

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      // Verify the JWT by asking Supabase who it belongs to. This goes against
      // GoTrue, not the project DB, so it's cheap and stateless on our side.
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await client.auth.getUser(token);
      if (!error && data.user) userId = data.user.id;
    }
  }

  if (!userId) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) userId = user.id;
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Strip the /api prefix so Hono sees /accounts, /transactions, ... — the
  // routes it actually mounts.
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";

  const headers = new Headers(req.headers);
  headers.set("x-user-id", userId);

  const forwarded = new Request(url.toString(), {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error -- duplex is required for streaming bodies in Node 20+
    duplex: "half",
  });
  return app.fetch(forwarded);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
