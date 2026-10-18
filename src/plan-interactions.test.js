import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PLAN } from "./plan-ui.js";
import {
  buildDependencyGraph,
  getCompletionProgress,
  isCurrentPlanRequest,
  setScheduledTaskCompletion
} from "./plan-interactions.js";

function plan(overrides = {}) {
  return {
    summary: "A small dependency plan.",
    totalMinutes: 15,
    tasks: [
      { id: "a", title: "First", minutes: 5, priority: "high", reason: "Start.", dependsOn: [], category: "build" },
      { id: "b", title: "Second", minutes: 10, priority: "normal", reason: "Follow first.", dependsOn: ["a"], category: "build" }
    ],
    deferredTasks: [
      { id: "c", title: "Later", minutes: 20, priority: "low", reason: "Later.", dependsOn: ["b"], category: "learn", deferredReason: "Outside this window." }
    ],
    ...overrides
  };
}

test("dependency view uses only declared edges and labels deferred nodes", () => {
  const graph = buildDependencyGraph(plan());
  assert.equal(graph.valid, true);
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.edges, [
    { from: "a", to: "b", fromStatus: "scheduled", toStatus: "scheduled" },
    { from: "b", to: "c", fromStatus: "scheduled", toStatus: "deferred" }
  ]);
});

test("dependency view supports no dependencies and multiple prerequisites", () => {
  const noEdges = buildDependencyGraph(plan({ deferredTasks: [] }));
  assert.equal(noEdges.valid, true);
  assert.equal(noEdges.edges.length, 1);
  const multiple = plan({
    tasks: [
      { id: "a", title: "A", minutes: 5, priority: "high", reason: "A.", dependsOn: [], category: "build" },
      { id: "b", title: "B", minutes: 5, priority: "high", reason: "B.", dependsOn: [], category: "build" },
      { id: "c", title: "C", minutes: 5, priority: "normal", reason: "C.", dependsOn: ["a", "b"], category: "build" }
    ],
    deferredTasks: [],
    totalMinutes: 15
  });
  const graph = buildDependencyGraph(multiple);
  assert.equal(graph.valid, true);
  assert.deepEqual(graph.edges.map(edge => edge.from).sort(), ["a", "b"]);
  assert.ok(graph.edges.every(edge => edge.to === "c"));
});

test("dependency view fails closed for unknown IDs, duplicate IDs, and cycles", () => {
  assert.equal(buildDependencyGraph(plan({ tasks: [{ ...plan().tasks[0], dependsOn: ["missing"] }] })).valid, false);
  assert.equal(buildDependencyGraph(plan({ tasks: [plan().tasks[0], plan().tasks[0]] })).valid, false);
  const cyclic = plan({
    tasks: [
      { id: "a", title: "A", minutes: 5, priority: "high", reason: "A.", dependsOn: ["b"], category: "build" },
      { id: "b", title: "B", minutes: 10, priority: "normal", reason: "B.", dependsOn: ["a"], category: "build" }
    ],
    deferredTasks: []
  });
  assert.match(buildDependencyGraph(cyclic).reason, /Cyclic/);
});

test("progress counts only scheduled tasks and handles none/all complete", () => {
  assert.deepEqual(getCompletionProgress(plan(), {}), { completed: 0, total: 2, remaining: 2, percent: 0, deferred: 1 });
  assert.deepEqual(getCompletionProgress(plan(), { a: true, b: true, c: true, stale: true }), { completed: 2, total: 2, remaining: 0, percent: 100, deferred: 1 });
  assert.deepEqual(getCompletionProgress(plan({ tasks: [], deferredTasks: [] }), {}), { completed: 0, total: 0, remaining: 0, percent: 0, deferred: 0 });
});

test("completion toggles are immutable, unmark correctly, and ignore deferred/stale task IDs", () => {
  const source = { stale: true };
  const marked = setScheduledTaskCompletion(plan(), source, "a", true);
  assert.deepEqual(source, { stale: true });
  assert.deepEqual(marked, { a: true });
  assert.deepEqual(setScheduledTaskCompletion(plan(), marked, "a", false), {});
  assert.deepEqual(setScheduledTaskCompletion(plan(), marked, "c", true), { a: true });
});

test("changing plans derives progress only from IDs in the active plan", () => {
  const completedFromOldPlan = { "demo-t1": true, a: true };
  const current = plan();
  assert.deepEqual(getCompletionProgress(current, completedFromOldPlan), { completed: 1, total: 2, remaining: 1, percent: 50, deferred: 1 });
  assert.equal(getCompletionProgress(DEMO_PLAN, {}).total, 3);
});

test("stale, unmounted, and aborted request results cannot be applied", () => {
  const controller = new AbortController();
  assert.equal(isCurrentPlanRequest(3, 3, true, controller.signal), true);
  assert.equal(isCurrentPlanRequest(2, 3, true, controller.signal), false);
  assert.equal(isCurrentPlanRequest(3, 3, false, controller.signal), false);
  controller.abort();
  assert.equal(isCurrentPlanRequest(3, 3, true, controller.signal), false);
});
