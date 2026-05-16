import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import SignOutButton from "@/app/components/SignOutButton";

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
        <SignOutButton />
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
        <SignOutButton />
      </Centered>
    );
  }

  // Approved — placeholder until the dashboard slice lands.
  return (
    <Centered>
      <h1 className="text-2xl font-semibold tracking-tight">Nabit</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Signed in as {profile.email}
        {profile.role === "admin" && " · admin"}
      </p>
      <p className="mt-6 text-sm text-zinc-400">
        Dashboard &amp; chat agent coming in the next build slice.
      </p>
      <SignOutButton />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <div className="flex flex-col items-center">{children}</div>
    </main>
  );
}
