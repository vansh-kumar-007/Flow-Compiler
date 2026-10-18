import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEMO_INPUT,
  DEMO_PLAN,
  getInputError,
  getTimeError,
  TIME_PRESETS,
  formatTimePreset,
  validatePlanResponse
} from "./plan-ui.js";

function validPlan() {
  return {
    summary: "Resolve the blocker first.",
    totalMinutes: 40,
    tasks: [
      { id: "t1", title: "Reproduce the bug", minutes: 15, priority: "high", reason: "Find the cause.", dependsOn: [], category: "build" },
      { id: "t2", title: "Fix and verify", minutes: 25, priority: "normal", reason: "Unblock the release.", dependsOn: ["t1"], category: "build" }
    ],
    deferredTasks: [
      { id: "t3", title: "Study React Query", minutes: 45, priority: "low", reason: "Useful later.", dependsOn: ["t2"], category: "learn", deferredReason: "The current window is full." }
    ]
  };
}

test("thought input rejects non-string, empty, whitespace-only and more than 5,000 characters", () => {
  assert.match(getInputError(null), /Enter the work/);
  assert.match(getInputError(""), /non-whitespace/);
  assert.match(getInputError(" \n\t "), /non-whitespace/);
  assert.equal(getInputError("x".repeat(5000)), null);
  assert.match(getInputError("x".repeat(5001)), /5,000/);
});

test("time control requires integer minutes in the API contract range", () => {
  assert.equal(getTimeError(5), null);
  assert.equal(getTimeError(720), null);
  for (const bad of [4, 721, 0, -5, 15.5, "120", NaN, Infinity, null]) {
    assert.match(getTimeError(bad), /whole number/);
  }
});

test("demo fixture is clearly separate, immutable, and within its stated time sum", () => {
  assert.ok(DEMO_INPUT.trim().length > 0);
  assert.equal(DEMO_PLAN.totalMinutes, DEMO_PLAN.tasks.reduce((sum, task) => sum + task.minutes, 0));
  assert.equal(DEMO_PLAN.tasks.length, 3);
  assert.equal(DEMO_PLAN.deferredTasks.length, 2);
  assert.ok(Object.isFrozen(DEMO_PLAN));
  assert.ok(Object.isFrozen(DEMO_PLAN.tasks));
  assert.ok(Object.isFrozen(DEMO_PLAN.tasks[0]));
});

test("valid response with scheduled and deferred tasks is accepted", () => {
  assert.equal(validatePlanResponse(validPlan(), 60), null);
});

test("response rejects malformed root, unknown fields, blank summary, over-budget total, and mismatched total", () => {
  const good = validPlan();
  for (const payload of [null, [], "plan", { ...good, surprise: true }, { ...good, summary: " " }, { ...good, totalMinutes: 61 }, { ...good, totalMinutes: 39 }]) {
    assert.notEqual(validatePlanResponse(payload, 60), null);
  }
});

test("response rejects malformed tasks and unsupported enums", () => {
  const good = validPlan();
  const invalids = [
    { ...good, tasks: [{ ...good.tasks[0], id: "not allowed!" }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], title: "" }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], minutes: 0 }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], priority: "urgent" }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], category: "unknown" }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], dependsOn: ["ghost"] }, good.tasks[1]] },
    { ...good, tasks: [{ ...good.tasks[0], dependsOn: ["t1"] }, good.tasks[1]] },
    { ...good, deferredTasks: [{ ...good.deferredTasks[0], deferredReason: "" }] }
  ];
  for (const payload of invalids) assert.notEqual(validatePlanResponse(payload, 60), null);
});

test("response rejects duplicate IDs, duplicate edges, and oversized node count", () => {
  const good = validPlan();
  assert.match(validatePlanResponse({ ...good, tasks: [good.tasks[0], { ...good.tasks[1], id: "t1", dependsOn: [] }] }, 60), /unique/);
  assert.match(validatePlanResponse({ ...good, tasks: [good.tasks[0], { ...good.tasks[1], dependsOn: ["t1", "t1"] }] }, 60), /duplicate/);
  assert.match(validatePlanResponse({ ...good, tasks: good.tasks, deferredTasks: Array.from({length: 19}, (_,i)=>({...good.deferredTasks[0],id:"d"+i,dependsOn:[]})) }, 60), /cannot exceed 20/);
});

test("response rejects a cycle without implementing the dependency graph UI", () => {
  const good = validPlan();
  const cyclic = {
    summary: "Cycle test.",
    totalMinutes: 40,
    tasks: [
      { id: "t1", title: "Start first step", minutes: 15, priority: "high", reason: "Start.", dependsOn: ["t2"], category: "build" },
      { id: "t2", title: "Finish second step", minutes: 25, priority: "normal", reason: "Finish.", dependsOn: ["t1"], category: "build" }
    ]
  };
  assert.match(validatePlanResponse(cyclic, 60), /circular/);
  assert.equal(validatePlanResponse(good, 60), null);
  assert.equal(good.totalMinutes, 40);
  assert.equal(good.deferredTasks[0].minutes, 45);
});


test("dependency titles are renderable from the validated plan IDs without changing graph scope", () => {
  const plan = validPlan();
  const byId = new Map([...plan.tasks, ...plan.deferredTasks].map(task => [task.id, task]));
  const resolved = plan.tasks[1].dependsOn.map(id => {
    const task = byId.get(id);
    return task ? task.title + " (" + id + ")" : id;
  });
  assert.deepEqual(resolved, ["Reproduce the bug (t1)"]);
  assert.equal(validatePlanResponse(plan, 60), null);
});

test("time presets remain integer values within the slider/API range and format consistently", () => {
  assert.ok(TIME_PRESETS.length > 0);
  assert.equal(new Set(TIME_PRESETS).size, TIME_PRESETS.length);
  for (const preset of TIME_PRESETS) {
    assert.ok(Number.isInteger(preset));
    assert.ok(preset >= 5 && preset <= 720);
    assert.equal(getTimeError(preset), null);
  }
  assert.equal(formatTimePreset(15), "15M");
  assert.equal(formatTimePreset(60), "1H");
  assert.equal(formatTimePreset(720), "12H");
});

test("response accepts completed prerequisites as satisfied revision dependencies", () => {
  const revised = {
    summary: "Continue remaining work.",
    totalMinutes: 10,
    tasks: [{
      id: "t2", title: "Continue work", minutes: 10, priority: "high",
      reason: "Its prerequisite is complete.", dependsOn: ["t1"], category: "build"
    }]
  };
  assert.equal(validatePlanResponse(revised, 15, ["t1"]), null);
  assert.match(validatePlanResponse(revised, 15, []), /unknown dependency/);
  assert.match(validatePlanResponse({ ...revised, tasks: [{ ...revised.tasks[0], id: "t1" }] }, 15, ["t1"]), /collide/);
});
