// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ModelCallsPage from "./page";

const preview = {
  id: 1,
  calledAt: "2026-07-30T10:00:00.000Z",
  kind: "plan-generation" as const,
  model: "test-model",
  status: "ok" as const,
  durationMs: 42,
  outcome: "1 proposed; 1 planned.",
  requestPreview: "short prompt",
  responsePreview: "short response",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Model Calls page", () => {
  it("renders collapsed rows and fetches full text only after expansion", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/model-calls") return jsonResponse([preview]);
      if (input === "/api/simulated-clock") return jsonResponse({ timeZone: "Europe/Stockholm" });
      if (input === "/api/model-calls/1") {
        return jsonResponse({ ...preview, requestText: "full prompt", responseText: "full response" });
      }
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ModelCallsPage />);

    expect(await screen.findByText("short prompt")).toBeInTheDocument();
    expect(screen.queryByText("full prompt")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /plan generation/i }));

    expect(await screen.findByText("full prompt")).toBeInTheDocument();
    expect(screen.getByText("full response")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("explains when an expanded Model Call has been discarded", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ ...preview, status: "error", errorPreview: "connection refused" }]))
        .mockResolvedValueOnce(jsonResponse({ timeZone: "Europe/Stockholm" }))
        .mockResolvedValueOnce(jsonResponse({ error: "Model Call not found." }, 404))
    );
    const user = userEvent.setup();

    render(<ModelCallsPage />);
    await user.click(await screen.findByRole("button", { name: /plan generation/i }));

    expect(await screen.findByText(/discarded as part of the rolling 100-entry log/i)).toBeInTheDocument();
  });

  it("renders an empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(input === "/api/model-calls" ? jsonResponse([]) : jsonResponse({ timeZone: "Europe/Stockholm" }))
      )
    );

    render(<ModelCallsPage />);

    expect(await screen.findByText("No Model Calls have been recorded yet.")).toBeInTheDocument();
  });
});
