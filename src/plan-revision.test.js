import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PLAN } from "./plan-ui.js";
import {
  buildPreviousPlan,
  formatFocusTime,
  getNextReadyTask,
  mergeRecompiledPlan,
  recompileLocalDemo
} from "./plan-revision.js";

function makePlan() {
  return {
    summary: "Sample",
    totalMinutes: 15,
    tasks: [
      { id: "a", title: "Prerequisite", minutes: 5, priority: "low", reason: "First.", dependsOn: [], category: "build" },
      { id: "b", title: "Dependent", minutes: 10, priority: "high", reason: "After first.", dependsOn: ["a"], category: "build" }
    ],
    deferredTasks: [
      { id: "c", title: "Later", minutes: 20, priority: "normal", reason: "Later.", dependsOn: ["b"], category: "learn", deferredReason: "Outside this window." }
    ]
  };
}

test("revision requests preserve completed IDs, unfinished tasks and documented context only", () => {
  const prior = buildPreviousPlan(makePlan(), { a: true }, "blocked", {
    note: "Waiting for sample access",
    blockedTaskId: "b"
  });
  assert.deepEqual(prior.completedTaskIds, ["a"]);
  assert.deepEqual(prior.tasks.map(task => task.id), ["b", "c"]);
  assert.ok(prior.tasks.every(task => !("deferredReason" in task)));
  assert.deepEqual(prior.revisionContext, {
    reason: "blocked",
    note: "Waiting for sample access",
    blockers: [{ taskId: "b", description: "Waiting for sample access" }]
  });
});

test("revision request refuses invalid or fully completed plans", () => {
  assert.throws(() => buildPreviousPlan(makePlan(), {}, "blocked", { blockedTaskId: "b" }), /describe its blocker/);
  const fullyDone = { ...makePlan(), deferredTasks: [] };
  assert.throws(() => buildPreviousPlan(fullyDone, { a: true, b: true }, "manual"), /All tasks are complete/);
});

test("merge keeps completed scheduled records and merges new response dependencies", () => {
  const prior = makePlan();
  const revisedResponse = {
    summary: "Do the dependent work",
    totalMinutes: 10,
    tasks: [{ ...prior.tasks[1], dependsOn: ["a"] }],
    deferredTasks: [prior.deferredTasks[0]]
  };
  const merged = mergeRecompiledPlan(prior, { a: true }, revisedResponse);
  assert.deepEqual(merged.tasks.map(task => task.id), ["a", "b"]);
  assert.equal(merged.totalMinutes, 10);
  assert.equal(merged.tasks[1].dependsOn[0], "a");
});

test("next-ready chooses highest priority but never skips an incomplete prerequisite", () => {
  const prior = makePlan();
  assert.equal(getNextReadyTask(prior, {})?.id, "a");
  assert.equal(getNextReadyTask(prior, { a: true })?.id, "b");
  assert.equal(getNextReadyTask(prior, { a: true, b: true }), null);
});

test("focus timer formatting handles minutes, hours and negative values", () => {
  assert.equal(formatFocusTime(0), "00:00");
  assert.equal(formatFocusTime(125), "02:05");
  assert.equal(formatFocusTime(3661), "1:01:01");
  assert.equal(formatFocusTime(-5), "00:00");
});

test("demo recompile preserves completed work and respects the time budget without external calls", () => {
  const result = recompileLocalDemo(DEMO_PLAN, { "demo-t1": true }, 30, { reason: "time_changed" });
  assert.equal(result.tasks.some(task => task.id === "demo-t1"), false);
  assert.ok(result.totalMinutes <= 30);
  assert.equal(result.tasks.reduce((sum, task) => sum + task.minutes, 0), result.totalMinutes);
  assert.ok(result.deferredTasks.length >= 1);
});

test("demo blocked task and its dependents become visibly deferred", () => {
  const result = recompileLocalDemo(DEMO_PLAN, {}, 120, {
    reason: "blocked", blockedTaskId: "demo-t2", note: "Waiting for access"
  });
  assert.equal(result.tasks.some(task => task.id === "demo-t2" || task.id === "demo-t3"), false);
  assert.ok(result.deferredTasks.some(task => task.id === "demo-t2" && task.deferredReason === "Waiting for access"));
  assert.ok(result.deferredTasks.some(task => task.id === "demo-t3"));
});
