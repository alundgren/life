// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import SettingsPage from "./page";

type Settings = {
  mode: "work" | "vacation";
  budgets: { work: number; vacation: number };
};
type Clock = { enabled: boolean; now: string; today: string; timeZone: string };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const DEFAULT_SETTINGS: Settings = { mode: "work", budgets: { work: 180, vacation: 600 } };

function stubFetch(
  initial: Settings,
  options: {
    failPut?: string;
    deferPut?: boolean;
    clock?: Clock;
    plannerRunResponse?: { status: number; error?: string };
    resetResponse?: { status: number; error?: string };
  } = {}
) {
  let stored = initial;
  let clock = options.clock ?? {
    enabled: false,
    now: "2026-07-25T12:00:00.000Z",
    today: "2026-07-25",
    timeZone: "Europe/Stockholm",
  };
  const pending = options.deferPut ? deferredResponse() : null;

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET" && input === "/api/settings") {
      return jsonResponse(stored);
    }
    if (method === "GET" && input === "/api/simulated-clock") return jsonResponse(clock);
    if (method === "POST" && input === "/api/simulated-clock") {
      const days = body.days as number;
      const next = new Date(clock.now);
      next.setUTCDate(next.getUTCDate() + days);
      clock = { ...clock, now: next.toISOString(), today: next.toISOString().slice(0, 10) };
      return jsonResponse(clock);
    }
    if (method === "POST" && input === "/api/planner/run") {
      const response = options.plannerRunResponse ?? { status: 204 };
      if (response.status === 204) return new Response(null, { status: 204 });
      return jsonResponse({ error: response.error }, response.status);
    }
    if (method === "POST" && input === "/api/settings/reset") {
      const response = options.resetResponse ?? { status: 204 };
      if (response.status !== 204) return jsonResponse({ error: response.error }, response.status);
      stored = DEFAULT_SETTINGS;
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      if (pending) return pending.promise;
      if (options.failPut) return jsonResponse({ error: options.failPut }, 400);
      stored = body as Settings;
      return jsonResponse(stored);
    }
    throw new Error(`unexpected ${method} ${String(input)}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, pending };
}

const initialSettings: Settings = {
  mode: "work",
  budgets: { work: 180, vacation: 600 },
};

describe("Settings page", () => {
  beforeEach(() => {
    stubFetch(initialSettings);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the current Mode, both budgets, and marks the live budget", async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole("button", { name: /Work \(current\)/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /Vacation/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Work minutes")).toHaveValue(180);
    expect(screen.getByLabelText("Vacation minutes")).toHaveValue(600);
    expect(screen.queryByText("Current Mode")).not.toBeInTheDocument();
    expect(screen.getByText("Scheduled Tasks keep their fixed slots in either Mode.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Model Calls" })).toHaveAttribute(
      "href",
      "/settings/model-calls"
    );
  });

  it("selects the other Mode immediately and confirms from the saved response", async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubFetch(initialSettings);
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /Vacation/ }));

    expect(await screen.findByText("Mode saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vacation \(current\)/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const putCall = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "GET") === "PUT");
    expect(putCall![0]).toBe("/api/settings");
    expect(JSON.parse(putCall![1]!.body as string)).toEqual({
      mode: "vacation",
      budgets: { work: 180, vacation: 600 },
    });
  });

  it("disables Mode controls while a change is in flight", async () => {
    const user = userEvent.setup();
    const { pending } = stubFetch(initialSettings, { deferPut: true });
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /Vacation/ }));

    expect(screen.getByRole("button", { name: /Work \(current\)/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Vacation/ })).toBeDisabled();

    pending!.resolve(jsonResponse({ mode: "vacation", budgets: { work: 180, vacation: 600 } }));
    expect(await screen.findByText("Mode saved.")).toBeInTheDocument();
  });

  it("shows a failed Mode save and leaves the original Mode selected", async () => {
    const user = userEvent.setup();
    stubFetch(initialSettings, { failPut: "Could not save Mode." });
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /Vacation/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save Mode.");
    expect(screen.getByRole("button", { name: /Work \(current\)/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("saves edited budgets with the current Mode and confirms", async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubFetch(initialSettings);
    render(<SettingsPage />);

    await user.clear(await screen.findByLabelText("Vacation minutes"));
    await user.type(screen.getByLabelText("Vacation minutes"), "900");
    await user.click(screen.getByRole("button", { name: "Save Time Budgets" }));

    expect(await screen.findByText("Time Budgets saved.")).toBeInTheDocument();
    expect(screen.getByLabelText("Vacation minutes")).toHaveValue(900);
    const putCall = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "GET") === "PUT");
    expect(JSON.parse(putCall![1]!.body as string)).toEqual({
      mode: "work",
      budgets: { work: 180, vacation: 900 },
    });
  });

  it("shows a rejected budget save and restores the stored value", async () => {
    const user = userEvent.setup();
    stubFetch(initialSettings, { failPut: "Budget for vacation Mode cannot be more than one week." });
    render(<SettingsPage />);

    await user.clear(await screen.findByLabelText("Vacation minutes"));
    await user.type(screen.getByLabelText("Vacation minutes"), "10081");
    await user.click(screen.getByRole("button", { name: "Save Time Budgets" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Budget for vacation Mode cannot be more than one week."
    );
    expect(screen.getByLabelText("Vacation minutes")).toHaveValue(600);
  });

  it("shows a clear message when Settings fail to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "nope" }, 500))
    );

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to load Settings."));
    expect(screen.queryByLabelText("Work minutes")).not.toBeInTheDocument();
  });

  it("shows Simulated Clock advance controls only when the server enables the clock", async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubFetch(initialSettings, {
      clock: {
        enabled: true,
        now: "2026-07-25T12:00:00.000Z",
        today: "2026-07-25",
        timeZone: "Europe/Stockholm",
      },
    });
    render(<SettingsPage />);

    expect(await screen.findByText("Current simulated date: 2026-07-25")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+1 week" }));
    expect(await screen.findByText("Simulated clock advanced by one week.")).toBeInTheDocument();
    expect(screen.getByText("Current simulated date: 2026-08-01")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toContainEqual([
      "/api/simulated-clock",
      expect.objectContaining({ method: "POST" }),
    ]);
  });

  it("hides Simulated Clock advance controls when the clock is disabled, but always shows the Planner section", async () => {
    render(<SettingsPage />);

    await screen.findByRole("button", { name: "Run planner now" });
    expect(screen.queryByText(/Current simulated date/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+1 day" })).not.toBeInTheDocument();
  });

  it("triggers a Planner run on demand and reports success", async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubFetch(initialSettings);
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Run planner now" }));

    expect(await screen.findByText("Planner run finished.")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toContainEqual(["/api/planner/run", { method: "POST" }]);
  });

  it("shows a clear message when the Planner is already running", async () => {
    const user = userEvent.setup();
    stubFetch(initialSettings, {
      plannerRunResponse: { status: 409, error: "The Planner is already running." },
    });
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Run planner now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The Planner is already running.");
  });

  it("disables the Reset button until the confirm phrase is typed, then wipes data and reloads Settings", async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubFetch({ mode: "vacation", budgets: { work: 240, vacation: 900 } });
    render(<SettingsPage />);

    await screen.findByLabelText("Work minutes");
    const resetButton = screen.getByRole("button", { name: "Reset all data" });
    expect(resetButton).toBeDisabled();

    await user.type(screen.getByLabelText('Type "reset" to confirm'), "reset");
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(await screen.findByText("All data has been reset.")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toContainEqual([
      "/api/settings/reset",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirm: "reset" }),
      }),
    ]);
    expect(screen.getByLabelText("Work minutes")).toHaveValue(180);
    expect(screen.getByLabelText('Type "reset" to confirm')).toHaveValue("");
  });

  it("shows a clear message when Reset is rejected", async () => {
    const user = userEvent.setup();
    stubFetch(initialSettings, {
      resetResponse: { status: 409, error: "The Planner is running. Try again shortly." },
    });
    render(<SettingsPage />);

    await user.type(await screen.findByLabelText('Type "reset" to confirm'), "reset");
    await user.click(screen.getByRole("button", { name: "Reset all data" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Planner is running. Try again shortly."
    );
  });
});
