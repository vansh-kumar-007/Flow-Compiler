import { buildDependencyGraph, validateActivePlan } from "./plan-interactions.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Export a deliberately minimal shareable view. Raw thoughts, plan summary,
 * task reasons, blocker notes, tokens, and other free-form context are excluded.
 */
export function createSafePlanExport(plan, completedTaskIds = {}, exportedAt = new Date().toISOString()) {
  const budget = Math.max(5, Number.isInteger(plan?.totalMinutes) ? plan.totalMinutes : 5);
  if (validateActivePlan(plan, completedTaskIds, budget)) throw new Error("Only a validated plan can be exported.");
  if (!isRecord(completedTaskIds) || !Object.values(completedTaskIds).every(value => typeof value === "boolean")) {
    throw new Error("Completion state is invalid; export was not created.");
  }
  const graph = buildDependencyGraph(plan);
  if (!graph.valid) throw new Error("Dependency data is invalid; export was not created.");
  const fields = task => ({
    id: task.id,
    title: task.title,
    minutes: task.minutes,
    priority: task.priority,
    dependsOn: [...task.dependsOn],
    category: task.category
  });
  return {
    format: "flow-compiler-safe-plan",
    schemaVersion: 1,
    exportedAt,
    scheduledMinutes: plan.totalMinutes,
    scheduledTasks: plan.tasks.map(task => ({
      ...fields(task),
      completed: completedTaskIds[task.id] === true
    })),
    deferredTasks: (plan.deferredTasks ?? []).map(fields)
  };
}

export function serializeSafePlanExport(plan, completedTaskIds = {}, exportedAt) {
  return JSON.stringify(createSafePlanExport(plan, completedTaskIds, exportedAt), null, 2);
}
