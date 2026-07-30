"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ModelCall, ModelCallPreview } from "@/lib/db/modelCall";

function timestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function kindLabel(kind: ModelCallPreview["kind"]): string {
  return kind.replaceAll("-", " ");
}

export default function ModelCallsPage() {
  const [calls, setCalls] = useState<ModelCallPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<number, ModelCall | "loading" | "discarded" | "error">>({});

  useEffect(() => {
    fetch("/api/model-calls")
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((body: ModelCallPreview[]) => setCalls(body))
      .catch(() => setError("Failed to load Model Calls."));
  }, []);

  async function showDetail(id: number) {
    if (details[id] !== undefined) return;
    setDetails((current) => ({ ...current, [id]: "loading" }));
    const res = await fetch(`/api/model-calls/${id}`).catch(() => undefined);
    if (res?.status === 404) {
      setDetails((current) => ({ ...current, [id]: "discarded" }));
      return;
    }
    if (!res?.ok) {
      setDetails((current) => ({ ...current, [id]: "error" }));
      return;
    }
    const detail = (await res.json()) as ModelCall;
    setDetails((current) => ({ ...current, [id]: detail }));
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Model Calls</h1>
          <p className="mt-1 text-sm text-muted">The most recent 100 requests sent to the LLM.</p>
        </div>
        <Link href="/settings" className="text-sm text-muted underline">
          Settings
        </Link>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      ) : calls === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-muted">No Model Calls have been recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {calls.map((call) => {
            const detail = details[call.id];
            return (
              <li key={call.id} className={`rounded-md border p-4 ${call.status === "error" ? "border-red-500/60" : "border-muted/30"}`}>
                <button type="button" onClick={() => void showDetail(call.id)} className="w-full text-left">
                  <span className="block text-sm font-medium">
                    {timestamp(call.calledAt)} · {kindLabel(call.kind)} · {call.status} · {call.durationMs} ms
                  </span>
                  <span className="mt-1 block text-sm text-muted">{call.model}{call.outcome ? ` · ${call.outcome}` : ""}</span>
                  <span className="mt-2 block truncate font-mono text-xs text-muted">{call.requestPreview}</span>
                </button>
                {detail === "loading" && (
                  <p className="mt-3 text-sm text-muted">Loading full request and response…</p>
                )}
                {detail === "discarded" && (
                  <p className="mt-3 text-sm text-muted">
                    This Model Call has been discarded as part of the rolling 100-entry log.
                  </p>
                )}
                {detail === "error" && (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    Failed to load this Model Call.
                  </p>
                )}
                {typeof detail === "object" && (
                  <div className="mt-3 grid gap-3 text-sm">
                    <section>
                      <h2 className="font-medium">Request</h2>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/10 p-3 text-xs">
                        {detail.requestText}
                      </pre>
                    </section>
                    <section>
                      <h2 className="font-medium">{detail.status === "ok" ? "Response" : "Error"}</h2>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/10 p-3 text-xs">
                        {detail.responseText ?? detail.errorText}
                      </pre>
                    </section>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
