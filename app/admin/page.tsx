import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Nav from "@/app/components/Nav";
import { setUserStatus } from "./actions";

type Row = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
};

export default async function AdminPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  if (me.role !== "admin" || me.status !== "approved") redirect("/");

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id,email,display_name,role,status,created_at")
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Row[];

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <Nav email={me.email} isAdmin />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="text-lg font-semibold">Users</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Approve new signups. Disable to revoke access.
        </p>
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <div>
                <p className="text-sm font-medium">{r.email}</p>
                <p className="text-xs text-zinc-400">
                  {r.role} · joined{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    r.status === "approved"
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : r.status === "pending"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  }`}
                >
                  {r.status}
                </span>
                {r.id !== me.id && (
                  <>
                    {r.status !== "approved" && (
                      <form
                        action={async () => {
                          "use server";
                          await setUserStatus(r.id, "approved");
                        }}
                      >
                        <button className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-white dark:text-black">
                          Approve
                        </button>
                      </form>
                    )}
                    {r.status !== "disabled" && (
                      <form
                        action={async () => {
                          "use server";
                          await setUserStatus(r.id, "disabled");
                        }}
                      >
                        <button className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700">
                          Disable
                        </button>
                      </form>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
