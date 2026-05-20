import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Email-confirmation landing. Supabase redirects here with ?code=... after the
// user clicks the link in their confirmation email; we exchange the code for
// a session cookie, then bounce them to ?next or /.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // Prefer NEXT_PUBLIC_SITE_URL so the post-confirmation redirect lands on the
  // canonical deployment even when the request hits a Vercel preview URL.
  const base = process.env.NEXT_PUBLIC_SITE_URL || origin;
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${next}`);
  }
  return NextResponse.redirect(`${base}/login?error=callback`);
}
