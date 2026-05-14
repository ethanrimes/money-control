import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Supabase session refresh + auth gate. Called from middleware.ts on every
// request. Pattern from the official @supabase/ssr Next.js guide: we must
// create a fresh response and copy cookies onto it whenever Supabase rotates
// the access token, otherwise the new tokens never reach the browser.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching getUser() forces token refresh if expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const isPublic =
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/_next") ||
    url.pathname === "/favicon.ico";

  if (!user && !isPublic) {
    const redirect = url.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", url.pathname + url.search);
    return NextResponse.redirect(redirect);
  }

  return response;
}
