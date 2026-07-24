// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Task } from "@/lib/db/task";
import TasksPage from "./page";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A stateful fetch stub standing in for the Tasks API — no real network or DB. */
function stubFetch(initialTasks: Task[] = []) {
  let tasks = [...initialTasks];
  let nextId = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET") {
      return jsonResponse(tasks);
    }
    if (method === "POST") {
      const created = { id: nextId++, createdAt: "2026-07-24T00:00:00Z", ...body } as Task;
      tasks = [...tasks, created];
      return jsonResponse(created, 201);
    }
    if (method === "PUT") {
      const id = Number(url.split("/").pop());
      const updated = { id, createdAt: "2026-07-24T00:00:00Z", ...body } as Task;
      tasks = tasks.map((t) => (t.id === id ? updated : t));
      return jsonResponse(updated);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("Tasks page", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the chosen kind's fields", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    // Scheduled by default.
    expect(screen.getByLabelText("Start time")).toBeInTheDocument();
    expect(screen.getByLabelText("Weekday")).toBeInTheDocument();
    expect(screen.queryByLabelText("Frequency")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "flexible");

    expect(screen.getByLabelText("Frequency")).toBeInTheDocument();
    expect(screen.getByLabelText("Duration (minutes)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Start time")).not.toBeInTheDocument();
  });

  it("submits the add form to the create endpoint and confirms", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<TasksPage />);

    await user.type(screen.getByLabelText("Description"), "Morning run");
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    await screen.findByText("Task created.");

    const postCall = fetchMock.mock.calls.find((c) => (c[1]?.method ?? "GET") === "POST");
    expect(postCall).toBeDefined();
    expect(postCall![0]).toBe("/api/tasks");
    const sent = JSON.parse(postCall![1]!.body as string);
    expect(sent).toMatchObject({ kind: "scheduled", description: "Morning run" });

    // The newly created Task shows up in the list.
    expect(await screen.findByText("Morning run")).toBeInTheDocument();
  });

  it("blocks submission and shows an error when the description is blank", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<TasksPage />);

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Description is required.");
    expect(fetchMock.mock.calls.some((c) => (c[1]?.method ?? "GET") === "POST")).toBe(false);
  });

  it("pre-fills the edit form, locks the kind, and saves to the edit endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([scheduledTask]);
    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: "Edit Strength training" }));

    expect(screen.getByRole("heading", { name: "Edit Task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Strength training");
    expect(screen.getByLabelText("Weekday")).toHaveValue("2");
    expect(screen.getByLabelText("Kind")).toBeDisabled();

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Renamed training");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Task saved.");

    const putCall = fetchMock.mock.calls.find((c) => (c[1]?.method ?? "GET") === "PUT");
    expect(putCall).toBeDefined();
    expect(putCall![0]).toBe("/api/tasks/1");
    const sent = JSON.parse(putCall![1]!.body as string);
    expect(sent).toMatchObject({ kind: "scheduled", description: "Renamed training" });
  });

  it("renders both kinds with their kind-appropriate fields", async () => {
    stubFetch([scheduledTask, flexibleTask]);
    render(<TasksPage />);

    expect(await screen.findByText("Strength training")).toBeInTheDocument();
    expect(screen.getByText(/Tuesday 16:00–19:00 · every 1 week/)).toBeInTheDocument();

    expect(screen.getByText("Clean the windows")).toBeInTheDocument();
    expect(
      screen.getByText(/about every three months · 45 min/)
    ).toBeInTheDocument();
  });
});
