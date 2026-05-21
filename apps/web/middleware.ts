import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Runs on every request before route handlers / RSC. Refreshes the Supabase
// session cookie and redirects unauthenticated users to /login.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip Next internals, common static assets, and /api/*. The /api wrapper
  // (apps/web/app/api/[[...path]]/route.ts) does its own auth — it accepts
  // both Supabase session cookies and `Authorization: Bearer <jwt>` from
  // the mobile app, so middleware here would just bounce mobile clients to
  // /login.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
