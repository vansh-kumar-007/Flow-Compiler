import { buildDependencyGraph } from "./plan-interactions.js";

const REVISION_REASONS = new Set(["manual", "time_changed", "completed_early", "blocked"]);
const PRIORITY_RANK = Object.freeze({ high: 0, normal: 1, low: 2 });

function taskWithoutDeferredReason(task) {
  const { deferredReason, ...fields } = task;
  return fields;
}

/**
 * Construct only the documented, non-secret revision context accepted by the API.
 * Completed task records remain client-side; the request contains their stable IDs.
 */
export function buildPreviousPlan(plan, completedIds = {}, reason = "manual", options = {}) {
  if (!plan || !Array.isArray(plan.tasks) || !Array.isArray(plan.deferredTasks ?? [])) {
    throw new Error("The current plan cannot be revised because its task collections are invalid.");
  }
  if (!REVISION_REASONS.has(reason)) throw new Error("Unsupported recompile reason.");
  const note = typeof options.note === "string" ? options.note.trim() : "";
  const blockedTaskId = options.blockedTaskId ?? null;
  if (reason === "blocked" && (!blockedTaskId || !note)) {
    throw new Error("Select a task and describe its blocker before recompiling.");
  }
  if (note.length > 1000) throw new Error("Revision notes must be 1,000 characters or fewer.");
  if (reason === "blocked" && note.length > 500) throw new Error("Blocker descriptions must be 500 characters or fewer.");

  const scheduled = plan.tasks;
  const deferred = plan.deferredTasks ?? [];
  const allIds = new Set([...scheduled, ...deferred].map(task => task?.id));
  if (allIds.size !== scheduled.length + deferred.length) {
    throw new Error("The current plan has duplicate task IDs and cannot be revised safely.");
  }
  const completedTaskIds = scheduled
    .filter(task => completedIds?.[task.id] === true)
    .map(task => task.id);
  const unfinished = [
    ...scheduled.filter(task => completedIds?.[task.id] !== true),
    ...deferred
  ];
  if (unfinished.length === 0) throw new Error("All tasks are complete. There is no remaining work to recompile.");
  if (unfinished.length + completedTaskIds.length > 20) {
    throw new Error("The revision exceeds the 20-task contract limit.");
  }
  if (reason === "blocked" && !unfinished.some(task => task.id === blockedTaskId)) {
    throw new Error("The blocked task must be unfinished and present in the current plan.");
  }

  const revisionContext = { reason };
  if (note) revisionContext.note = note;
  if (reason === "blocked") {
    revisionContext.blockers = [{ taskId: blockedTaskId, description: note }];
  }
  const totalMinutes = unfinished
    .filter(task => scheduled.some(item => item.id === task.id))
    .reduce((sum, task) => sum + task.minutes, 0);
  return {
    summary: plan.summary,
    ...(Number.isInteger(totalMinutes) && totalMinutes >= 1 && totalMinutes <= 720 ? { totalMinutes } : {}),
    tasks: unfinished.map(taskWithoutDeferredReason),
    completedTaskIds,
    revisionContext
  };
}

/** Preserve completed scheduled records while replacing only the unfinished schedule. */
export function mergeRecompiledPlan(currentPlan, completedIds, response) {
  if (!currentPlan || !Array.isArray(currentPlan.tasks) || !response || !Array.isArray(response.tasks)) {
    throw new Error("The recompiled response is not a usable plan.");
  }
  const completedTasks = currentPlan.tasks.filter(task => completedIds?.[task.id] === true);
  const nextPlan = {
    summary: response.summary,
    // Contractually this is the duration of the newly scheduled remaining work.
    totalMinutes: response.totalMinutes,
    tasks: [...completedTasks, ...response.tasks],
    deferredTasks: response.deferredTasks ?? []
  };
  if (nextPlan.tasks.length + nextPlan.deferredTasks.length > 20) {
    throw new Error("The revised plan exceeds the 20-task contract limit.");
  }
  const graph = buildDependencyGraph(nextPlan);
  if (!graph.valid) throw new Error("The revised plan contains invalid dependency data.");
  return nextPlan;
}

/** Pick a high-priority incomplete task whose prerequisites are already complete. */
export function getNextReadyTask(plan, completedIds = {}) {
  if (!plan || !Array.isArray(plan.tasks)) return null;
  return plan.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => completedIds?.[task.id] !== true)
    .filter(({ task }) => Array.isArray(task.dependsOn)
      && task.dependsOn.every(id => completedIds?.[id] === true))
    .sort((a, b) => (PRIORITY_RANK[a.task.priority] ?? 99) - (PRIORITY_RANK[b.task.priority] ?? 99) || a.index - b.index)[0]?.task ?? null;
}

export function formatFocusTime(totalSeconds) {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0")
    : String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

/**
 * Recompile the fixed demo fixture deterministically and entirely in memory.
 * It is illustrative only and never invokes fetch or an AI provider.
 */
export function recompileLocalDemo(currentPlan, completedIds = {}, availableMinutes = 120, options = {}) {
  if (!Number.isInteger(availableMinutes) || availableMinutes < 5 || availableMinutes > 720) {
    throw new Error("Available time must be a whole number from 5 to 720 minutes.");
  }
  const reason = options.reason ?? "manual";
  const note = typeof options.note === "string" ? options.note.trim() : "";
  const blockedTaskId = options.blockedTaskId ?? null;
  const previous = buildPreviousPlan(currentPlan, completedIds, reason, { note, blockedTaskId });
  const completed = currentPlan.tasks.filter(task => completedIds?.[task.id] === true);
  const pending = previous.tasks.map(taskWithoutDeferredReason);
  const originalDeferredReasons = new Map((currentPlan.deferredTasks ?? []).map(task => [task.id, task.deferredReason]));
  const deferredIds = new Set();
  const scheduled = [];
  const deferred = [];
  let remainingMinutes = availableMinutes;

  // A blocker also defers every unfinished downstream dependent.
  const blockedIds = new Set();
  if (reason === "blocked") {
    blockedIds.add(blockedTaskId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of pending) {
        if (!blockedIds.has(task.id) && task.dependsOn.some(id => blockedIds.has(id))) {
          blockedIds.add(task.id);
          changed = true;
        }
      }
    }
  }

  const left = new Map(pending.map(task => [task.id, task]));
  const maxPasses = pending.length + 1;
  for (let pass = 0; left.size && pass < maxPasses; pass += 1) {
    let changed = false;
    for (const task of pending) {
      if (!left.has(task.id)) continue;
      if (blockedIds.has(task.id)) {
        deferred.push({ ...task, deferredReason: task.id === blockedTaskId ? note : "Deferred because an upstream task is blocked." });
        deferredIds.add(task.id);
        left.delete(task.id);
        changed = true;
        continue;
      }
      if (task.dependsOn.some(id => deferredIds.has(id))) {
        deferred.push({ ...task, deferredReason: "A prerequisite is deferred and must be resolved first." });
        deferredIds.add(task.id);
        left.delete(task.id);
        changed = true;
        continue;
      }
      const ready = task.dependsOn.every(id =>
        completed.some(item => item.id === id) || scheduled.some(item => item.id === id)
      );
      if (!ready) continue;
      if (task.minutes <= remainingMinutes) {
        scheduled.push(task);
        remainingMinutes -= task.minutes;
      } else {
        deferred.push({ ...task, deferredReason: originalDeferredReasons.get(task.id) || "The remaining time window is too short." });
        deferredIds.add(task.id);
      }
      left.delete(task.id);
      changed = true;
    }
    if (!changed) break;
  }
  for (const task of pending) {
    if (!left.has(task.id)) continue;
    deferred.push({ ...task, deferredReason: "A prerequisite could not be scheduled in this time window." });
    deferredIds.add(task.id);
    left.delete(task.id);
  }

  return {
    summary: reason === "blocked"
      ? "Revised locally around the reported blocker. This is a deterministic demo, not an AI plan."
      : "Remaining demo tasks were rescheduled locally. This is illustrative, not an AI-generated plan.",
    totalMinutes: scheduled.reduce((sum, task) => sum + task.minutes, 0),
    tasks: scheduled,
    deferredTasks: deferred
  };
}
