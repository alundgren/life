/**
 * PROTOTYPE TUI for issue #6 — see the question statement at the top of
 * src/lib/planner/weeklyPlanLogic.prototype.ts. Throwaway shell only; all the logic worth
 * keeping lives in that module.
 *
 * Run: pnpm prototype:weekly-plan
 */
import {
  activeTasks,
  cycleActivityStatus,
  findTask,
  initialState,
  setBudget,
  tick,
  toggleGroup,
  type FlexibleTaskDef,
  type PlannedActivity,
  type PlannerState,
} from "../src/lib/planner/weeklyPlanLogic.prototype.ts";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function weekdayName(date: string): string {
  return WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function statusGlyph(status: PlannedActivity["status"]): string {
  if (status === "done") return `${GREEN}✓${RESET}`;
  if (status === "missed") return `${RED}✗${RESET}`;
  return `${DIM}·${RESET}`;
}

function activityLine(state: PlannerState, activity: PlannedActivity, index: number): string {
  const task = findTask(state, activity.taskId)!;
  const when =
    activity.startTime && activity.endTime
      ? `${weekdayName(activity.date)} ${activity.startTime}-${activity.endTime}`
      : `${DIM}(day TBD)${RESET}      `;
  const extra = task.kind === "flexible" ? `${DIM} — ${task.durationMinutes}min${RESET}` : "";
  return `  ${statusGlyph(activity.status)} ${BOLD}[${index}]${RESET} ${when}  ${task.description}${extra}`;
}

function render(state: PlannerState, numberedTaskIds: string[]): void {
  console.clear();
  console.log(
    `${BOLD}Weekly Plan prototype${RESET} ${DIM}(issue #6 — Planner weekly plan generation)${RESET}`
  );
  console.log(`${BOLD}Week of ${state.weekStartDate}${RESET}\n`);

  console.log(
    `Scenarios: Training ${state.enabledGroups.training ? BOLD + "[on]" + RESET : DIM + "[off]" + RESET}` +
      `   Chores ${state.enabledGroups.chores ? BOLD + "[on]" + RESET : DIM + "[off]" + RESET}`
  );
  console.log(
    `Time Budget (chores only): ${state.currentPlan.budgetUsedMinutes}/${state.currentPlan.budgetMinutes} min\n`
  );

  console.log(`${BOLD}This week's Planned Activities${RESET}`);
  const sorted = [...state.currentPlan.activities].sort((a, b) => {
    const timeA = a.startTime ?? "99:99";
    const timeB = b.startTime ?? "99:99";
    return timeA === timeB ? a.taskId.localeCompare(b.taskId) : timeA.localeCompare(timeB);
  });
  numberedTaskIds.length = 0;
  if (sorted.length === 0) {
    console.log(`  ${DIM}(nothing planned this week)${RESET}`);
  }
  for (const activity of sorted) {
    numberedTaskIds.push(activity.taskId);
    console.log(activityLine(state, activity, numberedTaskIds.length));
  }

  if (state.currentPlan.skipped.length > 0) {
    console.log(`\n${YELLOW}${BOLD}Left off this week — Time Budget exhausted${RESET}`);
    for (const s of state.currentPlan.skipped) {
      const task = findTask(state, s.taskId) as FlexibleTaskDef;
      console.log(
        `  ${YELLOW}!${RESET} ${task.description} ${DIM}(${s.weeksOverdue.toFixed(1)} wks overdue, ${task.durationMinutes}min)${RESET}`
      );
    }
  }

  const notYetDue = activeTasks(state).filter(
    (t): t is FlexibleTaskDef =>
      t.kind === "flexible" && !state.currentPlan.activities.some((a) => a.taskId === t.id)
  );
  if (notYetDue.length > 0) {
    console.log(`\n${DIM}Not yet due this week:${RESET}`);
    for (const t of notYetDue) {
      const last = state.lastCompletedDate[t.id];
      console.log(
        `  ${DIM}- ${t.description} (${t.frequencyText}; last done ${last ?? "never"})${RESET}`
      );
    }
  }

  if (state.history.length > 0) {
    console.log(`\n${BOLD}History${RESET} ${DIM}(most recent first)${RESET}`);
    for (const plan of state.history.slice(0, 3)) {
      const done = plan.activities.filter((a) => a.status === "done").length;
      const missed = plan.activities.filter((a) => a.status === "missed").length;
      console.log(
        `  ${DIM}${plan.weekStartDate}: ${done} done, ${missed} missed, budget ${plan.budgetUsedMinutes}/${plan.budgetMinutes} min${RESET}`
      );
    }
  }

  console.log(
    `\n${BOLD}[1-9]${RESET}${DIM} cycle status${RESET}  ${BOLD}[n]${RESET}${DIM} next week${RESET}  ` +
      `${BOLD}[+/-]${RESET}${DIM} budget ±15min${RESET}  ${BOLD}[t]${RESET}${DIM} toggle training${RESET}  ` +
      `${BOLD}[c]${RESET}${DIM} toggle chores${RESET}  ${BOLD}[q]${RESET}${DIM} quit${RESET}`
  );
}

let state = initialState();
const numberedTaskIds: string[] = [];
render(state, numberedTaskIds);

if (!process.stdin.isTTY) {
  console.log(`\n${RED}stdin is not a TTY — run this directly in a terminal.${RESET}`);
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

process.stdin.on("data", (key: string) => {
  if (key === "" || key === "q") {
    console.clear();
    process.exit(0);
  }

  if (key === "n") {
    state = tick(state);
  } else if (key === "+") {
    state = setBudget(state, state.budgetMinutes + 15);
  } else if (key === "-") {
    state = setBudget(state, state.budgetMinutes - 15);
  } else if (key === "t") {
    state = toggleGroup(state, "training");
  } else if (key === "c") {
    state = toggleGroup(state, "chores");
  } else if (/^[1-9]$/.test(key)) {
    const taskId = numberedTaskIds[Number(key) - 1];
    if (taskId) state = cycleActivityStatus(state, taskId);
  }

  render(state, numberedTaskIds);
});
