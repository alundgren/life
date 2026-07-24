// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TasksPage from "./page";

const scheduledTask = {
  id: 1,
  kind: "scheduled",
  description: "Strength training",
  createdAt: "2026-07-24T08:00:00.000Z",
  weekday: 2,
  startTime: "16:00",
  endTime: "19:00",
  recurrenceIntervalWeeks: 1,
};

const flexibleTask = {
  id: 2,
  kind: "flexible",
  description: "Clean the windows",
  createdAt: "2026-07-24T08:00:00.000Z",
  frequencyText: "about every three months",
  durationMinutes: 45,
};

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(tasks = [scheduledTask, flexibleTask]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === "/api/tasks" && !init) {
      return okJson({ tasks });
    }

    if (url === "/api/tasks" && init?.method === "POST") {
      return okJson(
        {
          task: {
            id: 3,
            createdAt: "2026-07-24T09:00:00.000Z",
            ...JSON.parse(String(init.body)),
          },
        },
        201
      );
    }

    if (url === "/api/tasks/1" && init?.method === "PATCH") {
      return okJson({
        task: {
          ...scheduledTask,
          ...JSON.parse(String(init.body)),
        },
      });
    }

    return okJson({ error: "Unhandled request" }, 500);
  });
}

describe("TasksPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders both Task kinds with their kind-specific fields", async () => {
    vi.stubGlobal("fetch", stubFetch());

    render(<TasksPage />);

    expect(await screen.findByText("Strength training")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, 16:00-19:00, every 1 week")).toBeInTheDocument();
    expect(screen.getByText("Clean the windows")).toBeInTheDocument();
    expect(screen.getByText("about every three months, 45 minutes")).toBeInTheDocument();
  });

  it("switches the add form between Scheduled and Flexible fields", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", stubFetch([]));

    render(<TasksPage />);
    await screen.findByText("No Tasks yet.");

    expect(screen.getByLabelText("Weekday")).toBeInTheDocument();
    expect(screen.queryByLabelText("Frequency")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "flexible");

    expect(screen.getByLabelText("Frequency")).toBeInTheDocument();
    expect(screen.queryByLabelText("Weekday")).not.toBeInTheDocument();
  });

  it("submits a new Flexible Task and shows confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);
    await screen.findByText("No Tasks yet.");

    await user.selectOptions(screen.getByLabelText("Kind"), "flexible");
    await user.type(screen.getByLabelText("Description"), "Oil bike chain");
    await user.type(screen.getByLabelText("Frequency"), "monthly");
    await user.clear(screen.getByLabelText("Duration minutes"));
    await user.type(screen.getByLabelText("Duration minutes"), "20");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await screen.findByText("Task created.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          kind: "flexible",
          description: "Oil bike chain",
          frequencyText: "monthly",
          durationMinutes: 20,
        }),
      })
    );
    expect(screen.getByText("Oil bike chain")).toBeInTheDocument();
  });

  it("blocks submission when description is blank", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);
    await screen.findByText("No Tasks yet.");

    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(screen.getByText("Description is required.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefills and locks kind when editing a Task", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);
    const item = (await screen.findByText("Strength training")).closest("li");
    expect(item).not.toBeNull();

    await user.click(within(item!).getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Edit Task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toHaveValue("Strength training");

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Morning training");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/tasks/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            kind: "scheduled",
            description: "Morning training",
            weekday: 2,
            startTime: "16:00",
            endTime: "19:00",
            recurrenceIntervalWeeks: 1,
          }),
        })
      )
    );
    expect(await screen.findByText("Task updated.")).toBeInTheDocument();
  });
});
