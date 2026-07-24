"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PlannerStatus = {
  running: boolean;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
};
type PlaceholderResponse = { message: string | null; planner: PlannerStatus };

export default function Home() {
  const [data, setData] = useState<PlaceholderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/placeholder")
      .then((res) => res.json())
      .then((body: PlaceholderResponse) => setData(body))
      .catch(() => setError("Failed to load placeholder data."));
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold text-foreground">Life</h1>
      <p className="mt-2 text-muted">{error ?? data?.message ?? "Loading…"}</p>
      <Link
        className="mt-4 rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium"
        href="/tasks"
      >
        Manage Tasks
      </Link>
      {data?.planner && (
        <p className="mt-1 text-sm text-muted">
          Planner: {data.planner.running ? "running" : "stopped"}
          {data.planner.lastRunAt &&
            ` — last ran ${data.planner.lastRunAt} (${data.planner.lastStatus})`}
        </p>
      )}
    </div>
  );
}
