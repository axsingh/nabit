import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "disabled";
};

// Returns the logged-in user's profile, or null if not authenticated.
// Auto-promotes the configured OWNER_EMAIL to admin+approved on first login
// (so the owner never has to run manual SQL).
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let { data: profile } = await supabase
    .from("profiles")
    .select("id,email,display_name,role,status")
    .eq("id", user.id)
    .single();

  // Owner bootstrap: first time the owner logs in, elevate via service role.
  const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase();
  if (
    profile &&
    ownerEmail &&
    profile.email?.toLowerCase() === ownerEmail &&
    (profile.role !== "admin" || profile.status !== "approved")
  ) {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ role: "admin", status: "approved" })
      .eq("id", user.id);
    profile = { ...profile, role: "admin", status: "approved" };
  }

  return (profile as Profile) ?? null;
}
