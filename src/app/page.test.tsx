// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Task } from "@/lib/db/task";
import Home from "./page";

type Activity = {
  id: number;
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status: "pending" | "done" | "missed";
  createdAt: string;
  startTime?: string;
  endTime?: string;
  task: Pick<Task, "id" | "kind" | "description">;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const scheduledTask: Task = {
  id: 1,
  kind: "scheduled",
  description: "Strength training",
  createdAt: "2026-07-24T00:00:00Z",
  weekday: 2,
  startTime: "16:00",
  endTime: "19:00",
  recurrenceIntervalWeeks: 1,
};

const flexibleTask: Task = {
  id: 2,
  kind: "flexible",
  description: "Clean the windows",
  createdAt: "2026-07-24T00:00:00Z",
  frequencyText: "about every three months",
  durationMinutes: 45,
};

const scheduledActivity: Activity = {
  id: 10,
  weeklyPlanId: 1,
  taskId: scheduledTask.id,
  date: "2026-07-25",
  status: "pending",
  createdAt: "2026-07-24T00:00:00Z",
  startTime: "16:00",
  endTime: "19:00",
  task: {
    id: scheduledTask.id,
    kind: scheduledTask.kind,
    description: scheduledTask.description,
  },
};

const flexibleActivity: Activity = {
  id: 11,
  weeklyPlanId: 1,
  taskId: flexibleTask.id,
  date: "2026-07-25",
  status: "pending",
  createdAt: "2026-07-24T00:00:00Z",
  task: {
    id: flexibleTask.id,
    kind: flexibleTask.kind,
    description: flexibleTask.description,
  },
};

function stubFetch({
  activities = [],
  tasks = [scheduledTask, flexibleTask],
  failCompletion = false,
}: {
  activities?: Activity[];
  tasks?: Task[];
  failCompletion?: boolean;
} = {}) {
  let storedActivities = activities.map((activity) => ({ ...activity }));
  const posts: unknown[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET" && url.startsWith("/api/planned-activities")) {
      return jsonResponse(storedActivities);
    }
    if (method === "GET" && url === "/api/tasks") {
      return jsonResponse(tasks);
    }
    if (method === "GET" && url === "/api/placeholder") {
      return jsonResponse({
        message: "Placeholder is alive.",
        planner: { running: true, lastRunAt: null, lastStatus: null, lastResult: null },
      });
    }
    if (method === "POST" && url === "/api/completions") {
      posts.push(body);
      if (failCompletion) {
        return jsonResponse({ error: "Could not record that." }, 500);
      }
      if (body.plannedActivityId) {
        storedActivities = storedActivities.map((activity) =>
          activity.id === body.plannedActivityId ? { ...activity, status: "done" } : activity
        );
      }
      return jsonResponse({ id: posts.length, ...body, createdAt: "2026-07-25T00:00:00Z" }, 201);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, posts };
}

describe("daily view page", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders today's Planned Activities, with slot times only for Scheduled Tasks", async () => {
    stubFetch({ activities: [scheduledActivity, flexibleActivity] });
    render(<Home />);

    expect(await screen.findByRole("button", { name: "Tick off Strength training" })).toBeInTheDocument();
    expect(screen.getByText("16:00-19:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tick off Clean the windows" })).toBeInTheDocument();
    expect(screen.queryByText(/Clean the windows.*16:00/s)).not.toBeInTheDocument();
    expect(screen.getByText("Planner: running")).toBeInTheDocument();
  });

  it("shows the empty-day message while ad-hoc logging remains available", async () => {
    stubFetch({ activities: [] });
    render(<Home />);

    expect(await screen.findByText("Nothing planned for today yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Completion" })).toBeEnabled();
  });

  it("ticks off a Planned Activity with a note, refreshes it as done, and removes the control", async () => {
    const user = userEvent.setup();
    const { posts } = stubFetch({ activities: [scheduledActivity] });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Tick off Strength training" }));
    await user.type(screen.getByLabelText("How did it go for Strength training"), "Felt good");
    await user.click(screen.getByRole("button", { name: "Confirm Strength training" }));

    expect(await screen.findByText("Completion recorded.")).toBeInTheDocument();
    expect(posts[0]).toMatchObject({
      taskId: scheduledTask.id,
      plannedActivityId: scheduledActivity.id,
      note: "Felt good",
    });
    expect(posts[0]).toHaveProperty("completedDate");
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tick off Strength training" })).not.toBeInTheDocument();
  });

  it("confirms with no note and sends no note field", async () => {
    const user = userEvent.setup();
    const { posts } = stubFetch({ activities: [scheduledActivity] });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Tick off Strength training" }));
    await user.click(screen.getByRole("button", { name: "Confirm Strength training" }));

    await screen.findByText("Completion recorded.");
    expect(posts[0]).toMatchObject({
      taskId: scheduledTask.id,
      plannedActivityId: scheduledActivity.id,
    });
    expect(posts[0]).not.toHaveProperty("note");
  });

  it("cancels the note field without recording anything", async () => {
    const user = userEvent.setup();
    const { posts } = stubFetch({ activities: [scheduledActivity] });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Tick off Strength training" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(posts).toEqual([]);
    expect(screen.getByRole("button", { name: "Tick off Strength training" })).toBeInTheDocument();
  });

  it("logs an ad-hoc Completion with no Planned Activity id", async () => {
    const user = userEvent.setup();
    const { posts } = stubFetch({ activities: [] });
    render(<Home />);

    await screen.findByText("Nothing planned for today yet.");
    await user.selectOptions(screen.getByLabelText("Task"), String(flexibleTask.id));
    await user.type(screen.getByLabelText("How did it go for ad-hoc Completion"), "Did it early");
    await user.click(screen.getByRole("button", { name: "Record Completion" }));

    expect(await screen.findByText("Completion recorded.")).toBeInTheDocument();
    expect(posts[0]).toMatchObject({ taskId: flexibleTask.id, note: "Did it early" });
    expect(posts[0]).not.toHaveProperty("plannedActivityId");
  });

  it("surfaces a failed Completion request and leaves the item pending", async () => {
    const user = userEvent.setup();
    stubFetch({ activities: [scheduledActivity], failCompletion: true });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Tick off Strength training" }));
    await user.click(screen.getByRole("button", { name: "Confirm Strength training" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record that.");
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
