"use client";

import { useEffect, useState } from "react";

type PlannerRun = { ranAt: string; status: string; result: string | null };
type PlaceholderResponse = { message: string | null; plannerRun: PlannerRun | null };

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
      {data?.plannerRun && (
        <p className="mt-1 text-sm text-muted">
          Planner last ran {data.plannerRun.ranAt} ({data.plannerRun.status})
        </p>
      )}
    </div>
  );
}
