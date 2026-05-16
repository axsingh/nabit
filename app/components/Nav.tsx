import Link from "next/link";
import SignOutButton from "@/app/components/SignOutButton";

export default function Nav({
  email,
  isAdmin,
}: {
  email: string | null;
  isAdmin: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Nabit
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Admin
          </Link>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-zinc-400">{email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
