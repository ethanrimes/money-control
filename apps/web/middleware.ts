import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Runs on every request before route handlers / RSC. Refreshes the Supabase
// session cookie and redirects unauthenticated users to /login.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip Next internals and common static assets. Everything else — including
  // /api/* — goes through auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
