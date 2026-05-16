import { createClient } from "@supabase/supabase-js";

// SERVICE-ROLE client. Bypasses RLS. Server-only — never import in client code.
// Used for admin operations and the worker, per the architect's RLS design.
export function createAdminClient() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
