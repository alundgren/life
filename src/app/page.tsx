"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/placeholder")
      .then((res) => res.json())
      .then((data: { message: string | null }) => setMessage(data.message))
      .catch(() => setError("Failed to load placeholder data."));
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold text-foreground">Life</h1>
      <p className="mt-2 text-muted">{error ?? message ?? "Loading…"}</p>
    </div>
  );
}
