// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DayView } from "../../day-view";

type PlannedActivity = {
  id: number;
  taskId: number;
  status: "pending" | "done" | "missed";
  startTime?: string;
  endTime?: string;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type AdHocCompletion = {
  id: number;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type Day = {
  date: string;
  plannedActivities: PlannedActivity[];
  adHocCompletions: AdHocCompletion[];
};

type Task = { id: number; description: string };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function day(date: string, overrides: Partial<Day> = {}): Day {
  return { date, plannedActivities: [], adHocCompletions: [], ...overrides };
}

function activity(id: number, description: string, overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id,
    taskId: id,
    status: "pending",
    task: { id, kind: "flexible", description },
    ...overrides,
  };
}

function stubFetch({
  date = "2026-07-21",
  today = "2026-07-23",
  body = day(date),
  dayStatus = 200,
  tasks = [{ id: 1, description: "Read" }] as Task[],
}: {
  date?: string;
  today?: string;
  body?: Day;
  dayStatus?: number;
  tasks?: Task[];
} = {}) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/simulated-clock") {
      return jsonResponse({ enabled: false, now: `${today}T12:00:00.000Z`, today, timeZone: "Europe/Stockholm" });
    }
    if (url === `/api/day/${date}`) return jsonResponse(body, dayStatus);
    if (url === "/api/tasks") return jsonResponse(tasks);
    if (url === "/api/completions" && init?.method === "POST") {
      return jsonResponse({ id: 999 }, 201);
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Day page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the day's Planned Activities and ad-hoc Completions", async () => {
    stubFetch({
      date: "2026-07-21",
      body: day("2026-07-21", {
        plannedActivities: [
          activity(1, "Morning run", { startTime: "07:30", endTime: "08:00" }),
          activity(2, "Meditate"),
        ],
        adHocCompletions: [{ id: 3, task: { id: 3, kind: "flexible", description: "Buy bird seed" } }],
      }),
    });
    render(<DayView date="2026-07-21" />);

    expect(await screen.findByText("Morning run")).toBeInTheDocument();
    expect(screen.getByText(/^07:30–08:00 · Pending/)).toBeInTheDocument();
    expect(screen.getByText("Meditate")).toBeInTheDocument();
    expect(screen.getByText("Buy bird seed")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("says so plainly when the day has nothing recorded", async () => {
    stubFetch({ date: "2026-07-21", body: day("2026-07-21") });
    render(<DayView date="2026-07-21" />);

    expect(await screen.findByText("Nothing recorded for this day.")).toBeInTheDocument();
  });

  it("expands a Completion note only when its toggle is clicked", async () => {
    const user = userEvent.setup();
    stubFetch({
      date: "2026-07-21",
      body: day("2026-07-21", {
        plannedActivities: [activity(1, "Strength training", { status: "done", note: "Felt strong" })],
      }),
    });
    render(<DayView date="2026-07-21" />);

    expect(await screen.findByText("Strength training")).toBeInTheDocument();
    expect(screen.queryByText("Felt strong")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show note" }));
    expect(screen.getByText("Felt strong")).toBeInTheDocument();
  });

  it("ticks off a Pending Planned Activity on a past date, posting that date as completedDate", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({
      date: "2026-07-21",
      today: "2026-07-23",
      body: day("2026-07-21", { plannedActivities: [activity(1, "Morning run")] }),
    });
    render(<DayView date="2026-07-21" />);

    await user.click(await screen.findByRole("button", { name: "Tick off Morning run" }));
    await user.type(screen.getByRole("textbox", { name: "How did it go for Morning run" }), "Great run");
    await user.click(screen.getByRole("button", { name: "Confirm Morning run" }));

    await screen.findByText("Completion recorded.");
    const postCall = fetchMock.mock.calls.find(([url]) => url === "/api/completions");
    expect(postCall).toBeDefined();
    const [, init] = postCall!;
    expect(JSON.parse(String(init!.body))).toEqual({
      taskId: 1,
      completedDate: "2026-07-21",
      plannedActivityId: 1,
      note: "Great run",
    });
  });

  it("logs an ad-hoc Completion against the viewed date", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ date: "2026-07-21", today: "2026-07-23" });
    render(<DayView date="2026-07-21" />);

    await screen.findByRole("heading", { name: "Log something else" });
    await screen.findByRole("option", { name: "Read" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "1");
    await user.type(screen.getByRole("textbox", { name: "How did it go for ad-hoc Completion" }), "Did it anyway");
    await user.click(screen.getByRole("button", { name: "Record Completion" }));

    await screen.findByText("Completion recorded.");
    const postCall = fetchMock.mock.calls.find(([url]) => url === "/api/completions");
    expect(postCall).toBeDefined();
    const [, init] = postCall!;
    expect(JSON.parse(String(init!.body))).toEqual({
      taskId: 1,
      completedDate: "2026-07-21",
      note: "Did it anyway",
    });
  });

  it("renders a future date with no actions at all", async () => {
    stubFetch({
      date: "2026-07-25",
      today: "2026-07-23",
      body: day("2026-07-25", { plannedActivities: [activity(1, "Morning run")] }),
    });
    render(<DayView date="2026-07-25" />);

    expect(await screen.findByText("Morning run")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tick off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Log something else" })).not.toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    stubFetch({ date: "2026-07-21", dayStatus: 500 });
    render(<DayView date="2026-07-21" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load this day.");
  });

  it("surfaces a save error rather than swallowing it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/simulated-clock") {
        return jsonResponse({ enabled: false, now: "2026-07-21T12:00:00.000Z", today: "2026-07-23", timeZone: "Europe/Stockholm" });
      }
      if (url === "/api/day/2026-07-21") return jsonResponse(day("2026-07-21", { plannedActivities: [activity(1, "Morning run")] }));
      if (url === "/api/tasks") return jsonResponse([{ id: 1, description: "Read" }]);
      if (url === "/api/completions" && init?.method === "POST") {
        return jsonResponse({ error: "Failed to record Completion." }, 500);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DayView date="2026-07-21" />);

    await user.click(await screen.findByRole("button", { name: "Tick off Morning run" }));
    await user.click(screen.getByRole("button", { name: "Confirm Morning run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to record Completion.");
  });

  it("links back to the week containing the viewed date", async () => {
    stubFetch({ date: "2026-07-21" });
    render(<DayView date="2026-07-21" />);

    expect(await screen.findByRole("link", { name: "Back to week" })).toHaveAttribute("href", "/week/2026-07-20");
  });
});
