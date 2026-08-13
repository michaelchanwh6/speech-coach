import { createClient } from "@supabase/supabase-js";

// Service-role client for server-only jobs that run without a user session
// (e.g. the retention cleanup cron). Uses the secret key, which bypasses RLS —
// never import this into anything that reaches the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
