import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Components can't write cookies, so cookie writes here are
// swallowed in that context; middleware.ts is what actually persists
// refreshed session cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component without middleware refreshing
            // the session — safe to ignore.
          }
        },
      },
    }
  );
}
