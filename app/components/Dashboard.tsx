import { createClient } from "@/lib/supabase/server";
import Chat from "@/app/components/Chat";

type Watch = {
  id: string;
  name: string;
  source: string;
  category: string | null;
  status: string;
  alert_mode: string;
  channels: string[];
  last_checked_at: string | null;
  created_at: string;
};

type Alert = {
  id: string;
  watch_id: string;
  matched_at: string;
  payload: { title?: string; price?: number; url?: string };
};

export default async function Dashboard() {
  const supabase = await createClient();
  const [{ data: watches }, { data: alerts }] = await Promise.all([
    supabase
      .from("watches")
      .select("id,name,source,category,status,alert_mode,channels,last_checked_at,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("alerts")
      .select("id,watch_id,matched_at,payload")
      .order("matched_at", { ascending: false })
      .limit(20),
  ]);

  const w = (watches ?? []) as Watch[];
  const a = (alerts ?? []) as Alert[];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Create a watch</h2>
        <Chat />
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Your watches</h2>
          <span className="text-xs text-zinc-400">{w.length} total</span>
        </div>

        {w.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500">No watches yet.</p>
            <p className="mt-1 text-xs text-zinc-400">
              Use the chat above — describe a deal and I&apos;ll set up a watch.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {w.map((x) => (
              <li
                key={x.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div>
                  <p className="text-sm font-medium">{x.name}</p>
                  <p className="text-xs text-zinc-400">
                    {x.source}
                    {x.category ? ` · ${x.category}` : ""} · {x.channels.join(", ")} ·{" "}
                    {x.alert_mode}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    x.status === "active"
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {x.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Recent alerts</h2>
        {a.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No alerts yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {a.map((al) => (
              <li
                key={al.id}
                className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <p className="text-sm">
                  {al.payload?.title ?? "Match"}
                  {al.payload?.price != null && (
                    <span className="font-medium"> — ${al.payload.price}</span>
                  )}
                </p>
                <p className="text-xs text-zinc-400">
                  {new Date(al.matched_at).toLocaleString()}
                  {al.payload?.url && (
                    <>
                      {" · "}
                      <a
                        href={al.payload.url}
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        open
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
