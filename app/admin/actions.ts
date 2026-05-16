"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function assertAdmin() {
  const me = await getProfile();
  if (!me || me.role !== "admin" || me.status !== "approved") {
    throw new Error("forbidden");
  }
}

export async function setUserStatus(
  userId: string,
  status: "approved" | "disabled" | "pending"
) {
  await assertAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
