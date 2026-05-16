import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import SignOutButton from "@/app/components/SignOutButton";
import Nav from "@/app/components/Nav";
import Dashboard from "@/app/components/Dashboard";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  if (profile.status === "disabled") {
    return (
      <Centered>
        <h1 className="text-xl font-semibold">Account disabled</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Contact the administrator if you think this is a mistake.
        </p>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </Centered>
    );
  }

  if (profile.status === "pending") {
    return (
      <Centered>
        <h1 className="text-xl font-semibold">Waiting for approval</h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          Your account ({profile.email}) is pending admin approval. You&apos;ll
          be able to create watches once approved.
        </p>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </Centered>
    );
  }

  // Approved — full dashboard.
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <Nav email={profile.email} isAdmin={profile.role === "admin"} />
      <Dashboard />
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <div className="flex flex-col items-center">{children}</div>
    </main>
  );
}
