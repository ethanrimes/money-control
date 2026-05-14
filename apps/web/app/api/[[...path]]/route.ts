// Catch-all bridge from Next.js → the Hono app. Validates the Supabase session
// cookie, then forwards the (Web standard) Request to app.fetch() with an
// internal x-user-id header that Hono's tenancy middleware trusts. Hono in
// turn wraps the handler in withUser(), which sets request.jwt.claims so RLS
// auto-scopes every query.
//
// Why this layout: keeping the auth check in the Next layer means the Supabase
// cookie never has to be parsed by Hono, and Hono stays portable (it still
// runs standalone in dev via apps/server/src/index.ts).

import { app } from "@moneycontrol/server/app";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
  headers.set("x-user-id", user.id);

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
