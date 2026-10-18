import { validatePlanResponse } from "./plan-ui.js";

export function buildDependencyGraph(plan) {
  if (!plan || !Array.isArray(plan.tasks) || !Array.isArray(plan.deferredTasks ?? [])) {
    return { valid: false, reason: "Plan task collections are invalid.", nodes: [], edges: [] };
  }

  const nodes = [
    ...plan.tasks.map(task => ({ ...task, status: "scheduled" })),
    ...(plan.deferredTasks ?? []).map(task => ({ ...task, status: "deferred" }))
  ];
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !Array.isArray(node.dependsOn) || byId.has(node.id)) {
      return { valid: false, reason: "Task IDs or dependency lists are invalid.", nodes: [], edges: [] };
    }
    byId.set(node.id, node);
  }

  const edges = [];
  for (const node of nodes) {
    const seen = new Set();
    for (const prerequisiteId of node.dependsOn) {
      if (typeof prerequisiteId !== "string" || !byId.has(prerequisiteId) || seen.has(prerequisiteId) || prerequisiteId === node.id) {
        return { valid: false, reason: "A dependency is missing, duplicated, or self-referential.", nodes: [], edges: [] };
      }
      seen.add(prerequisiteId);
      // Edge direction is prerequisite -> dependent task. Only declared dependsOn
      // references create edges; display order never creates a dependency.
      edges.push({
        from: prerequisiteId,
        to: node.id,
        fromStatus: byId.get(prerequisiteId).status,
        toStatus: node.status
      });
    }
  }

  const visitState = new Map();
  function visit(id) {
    const state = visitState.get(id) ?? 0;
    if (state === 1) return false;
    if (state === 2) return true;
    visitState.set(id, 1);
    for (const prerequisiteId of byId.get(id).dependsOn) {
      if (!visit(prerequisiteId)) return false;
    }
    visitState.set(id, 2);
    return true;
  }
  for (const node of nodes) {
    if (!visit(node.id)) {
      return { valid: false, reason: "Cyclic dependency data cannot be displayed.", nodes: [], edges: [] };
    }
  }

  return { valid: true, reason: null, nodes, edges };
}

/**
 * Validate an active UI plan, where completed task records remain visible but
 * totalMinutes represents the unfinished scheduled work after a recompile.
 */
export function validateActivePlan(plan, completedIds = {}, availableMinutes) {
  if (!plan || !Array.isArray(plan.tasks) || !Array.isArray(plan.deferredTasks ?? [])) {
    return "plan task collections are invalid.";
  }
  const completedTasks = plan.tasks.filter(task => completedIds?.[task.id] === true);
  const remainingTasks = plan.tasks.filter(task => completedIds?.[task.id] !== true);
  const budget = Number.isInteger(availableMinutes) ? availableMinutes : Math.max(5, plan.totalMinutes || 5);

  if (remainingTasks.length === 0) {
    // Preserve a fully completed plan as a durable history even if deferred
    // tasks remain; its original scheduled total still matches its task list.
    return validatePlanResponse(plan, Math.max(budget, plan.totalMinutes));
  }

  const normalized = {
    ...plan,
    tasks: remainingTasks,
    totalMinutes: remainingTasks.reduce((sum, task) => sum + task.minutes, 0)
  };
  return validatePlanResponse(
    normalized,
    Math.max(budget, normalized.totalMinutes),
    completedTasks.map(task => task.id)
  );
}

export function getCompletionProgress(plan, completedIds = {}) {
  const scheduled = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const completed = scheduled.filter(task => completedIds[task.id] === true).length;
  const total = scheduled.length;
  return {
    completed,
    total,
    remaining: total - completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    deferred: Array.isArray(plan?.deferredTasks) ? plan.deferredTasks.length : 0
  };
}

export function setScheduledTaskCompletion(plan, completedIds, taskId, checked) {
  const scheduledIds = new Set((Array.isArray(plan?.tasks) ? plan.tasks : []).map(task => task.id));
  if (!scheduledIds.has(taskId)) return { ...completedIds };
  const next = { ...completedIds };
  if (checked) next[taskId] = true;
  else delete next[taskId];
  // Discard stale IDs from an earlier plan and never count deferred tasks.
  for (const id of Object.keys(next)) {
    if (!scheduledIds.has(id)) delete next[id];
  }
  return next;
}

export function isCurrentPlanRequest(requestId, currentRequestId, mounted, signal) {
  return requestId === currentRequestId && mounted === true && !signal?.aborted;
}

export function buildPlanPresentation(plan) {
  const graph = buildDependencyGraph(plan);
  if (!graph.valid) return { valid: false, reason: graph.reason, summary: "", totalMinutes: 0, tasks: [], deferredTasks: [] };
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const presentTask = task => ({
    ...task,
    prerequisites: task.dependsOn.map(id => ({ id, title: byId.get(id).title, status: byId.get(id).status }))
  });
  return {
    valid: true,
    reason: null,
    summary: plan.summary,
    totalMinutes: plan.totalMinutes,
    tasks: plan.tasks.map(presentTask),
    deferredTasks: (plan.deferredTasks ?? []).map(presentTask)
  };
}
