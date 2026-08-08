// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import Home from "./page";
import { WeekView } from "./week-view";

type PlannedActivity = {
  id: number;
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status: "pending" | "done" | "missed";
  createdAt: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type AdHocCompletion = {
  id: number;
  completedDate: string;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type Day = {
  date: string;
  plannedActivities: PlannedActivity[];
  adHocCompletions: AdHocCompletion[];
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function week(days: Partial<Record<string, Partial<Day>>> = {}, plannerHasPlanned = true) {
  const dates = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];
  return {
    weekStartDate: "2026-07-20",
    plannerHasPlanned,
    days: dates.map((date) => ({
      date,
      plannedActivities: [],
      adHocCompletions: [],
      ...days[date],
    })),
  };
}

function activity(
  id: number,
  description: string,
  overrides: Partial<PlannedActivity> = {}
): PlannedActivity {
  return {
    id,
    weeklyPlanId: 1,
    taskId: id,
    date: "2026-07-20",
    status: "pending",
    createdAt: "2026-07-19T00:00:00Z",
    task: { id, kind: "flexible", description },
    ...overrides,
  };
}

function stubFetch({ body = week(), weekStatus = 200 }: { body?: ReturnType<typeof week>; weekStatus?: number } = {}) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === "/api/simulated-clock") {
      return jsonResponse({
        enabled: false,
        now: "2026-07-23T12:00:00.000Z",
        today: "2026-07-23",
        timeZone: "Europe/Stockholm",
      });
    }
    if (url === "/api/week/2026-07-20") return jsonResponse(body, weekStatus);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Week view page", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders seven day cells with each kind of activity in its correct day", async () => {
    stubFetch({
      body: week({
        "2026-07-21": {
          plannedActivities: [
            activity(1, "Flexible task"),
            activity(2, "Morning run", {
              date: "2026-07-21",
              task: { id: 2, kind: "scheduled", description: "Morning run" },
              startTime: "07:30",
            }),
          ],
        },
        "2026-07-22": {
          adHocCompletions: [
            { id: 3, completedDate: "2026-07-22", task: { id: 3, kind: "flexible", description: "Buy bird seed" } },
          ],
        },
      }),
    });
    render(<Home />);

    expect(await screen.findAllByRole("article")).toHaveLength(7);
    const tuesday = screen.getByRole("article", { name: "Tuesday, 21 July 2026" });
    expect(within(tuesday).getByText(/^07:30 Morning run/)).toBeInTheDocument();
    expect(within(tuesday).getByText("Flexible task")).toBeInTheDocument();
    expect(within(tuesday).getByText(/^07:30 Morning run/).compareDocumentPosition(within(tuesday).getByText("Flexible task"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    const wednesday = screen.getByRole("article", { name: "Wednesday, 22 July 2026" });
    expect(within(wednesday).getByText("Buy bird seed")).toBeInTheDocument();
    expect(within(wednesday).getByText("Completed")).toBeInTheDocument();
  });

  it("shows five rows in a busy day and links to its Day page for the remainder", async () => {
    stubFetch({
      body: week({
        "2026-07-20": { plannedActivities: Array.from({ length: 7 }, (_, id) => activity(id + 1, `Task ${id + 1}`)) },
      }),
    });
    render(<Home />);

    const monday = await screen.findByRole("article", { name: "Monday, 20 July 2026" });
    expect(within(monday).getByText("Task 5")).toBeInTheDocument();
    expect(within(monday).queryByText("Task 6")).not.toBeInTheDocument();
    expect(within(monday).getByRole("link", { name: "+2 more" })).toHaveAttribute("href", "/day/2026-07-20");
  });

  it("expands a Completion note only when its toggle is clicked", async () => {
    const user = userEvent.setup();
    stubFetch({
      body: week({
        "2026-07-23": {
          plannedActivities: [activity(1, "Strength training", { date: "2026-07-23", status: "done", note: "Felt strong" })],
        },
      }),
    });
    render(<Home />);

    expect(await screen.findByText("Strength training")).toBeInTheDocument();
    expect(screen.queryByText("Felt strong")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show note" }));
    expect(screen.getByText("Felt strong")).toBeInTheDocument();
  });

  it("disables Next on the current week and provides an unbounded previous-week URL", async () => {
    stubFetch();
    render(<Home />);

    expect(await screen.findByRole("button", { name: "Next week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "This week" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Previous week" })).toHaveAttribute("href", "/week/2026-07-13");
  });

  it("warns for an unplanned week but not for an existing empty Weekly Plan", async () => {
    stubFetch({ body: week({}, false) });
    const { unmount } = render(<Home />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Planner has not planned this week.");

    unmount();
    stubFetch({ body: week({}, true) });
    render(<Home />);
    await screen.findByRole("heading", { name: "Week" });
    expect(screen.queryByText("Planner has not planned this week.")).not.toBeInTheDocument();
  });

  it("uses each date header as the sole link into its Day page", async () => {
    stubFetch();
    render(<Home />);

    expect(await screen.findByRole("link", { name: "Open Thursday, 23 July 2026" })).toHaveAttribute(
      "href",
      "/day/2026-07-23"
    );
    expect(screen.getByRole("link", { name: "Manage Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: /Tick off|Record Completion/ })).not.toBeInTheDocument();
  });

  it("surfaces a Week API load error", async () => {
    stubFetch({ weekStatus: 500 });
    render(<Home />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load the Week view.");
  });

  it("renders a requested week when the current-date request fails", async () => {
    const pastWeek = {
      weekStartDate: "2026-07-13",
      plannerHasPlanned: true,
      days: ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"].map(
        (date) => ({ date, plannedActivities: [], adHocCompletions: [] })
      ),
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "/api/simulated-clock") return jsonResponse({}, 500);
      if (url === "/api/week/2026-07-13") return jsonResponse(pastWeek);
      throw new Error(`unexpected request: ${url}`);
    }));
    render(<WeekView weekStartDate="2026-07-13" />);

    expect(await screen.findAllByRole("article")).toHaveLength(7);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load the current date.");
  });
});
