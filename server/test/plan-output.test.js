import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGeneratedPlan } from "../src/plan-output.js";

const validPlan = {
  summary: "Resolve the blocker, then finish the highest-value work.",
  totalMinutes: 40,
  tasks: [
    { id: "t1", title: "Reproduce the login bug", minutes: 15, priority: "high",
      reason: "Confirm the failure before changing code.", dependsOn: [], category: "build" },
    { id: "t2", title: "Fix and verify login", minutes: 25, priority: "normal",
      reason: "Deployment depends on a working login.", dependsOn: ["t1"], category: "build" }
  ]
};
const copyPlan = () => structuredClone(validPlan);
function makeTask(index, overrides = {}) {
  return { id: "t" + index, title: "Complete task " + index, minutes: 1,
    priority: "normal", reason: "This is a concrete next step.", dependsOn: [], category: "build",
    ...overrides };
}
function makePlan(count) {
  return { summary: "A valid generated plan.", totalMinutes: count,
    tasks: Array.from({ length: count }, (_unused, index) => makeTask(index)) };
}
function assertInvalid(value, path) {
  const error = validateGeneratedPlan(value);
  assert.ok(error, "expected validation error");
  assert.equal(error.code, "INVALID_MODEL_OUTPUT");
  assert.equal(error.message, "The model returned an invalid plan.");
  assert.equal(error.path, path);
}

test("accepts a complete valid plan without mutating the input", () => {
  const plan = copyPlan();
  const before = structuredClone(plan);
  assert.equal(validateGeneratedPlan(plan), null);
  assert.deepEqual(plan, before);
});
test("accepts omitted deferredTasks and an empty deferredTasks array", () => {
  assert.equal(validateGeneratedPlan(copyPlan()), null);
  assert.equal(validateGeneratedPlan({ ...copyPlan(), deferredTasks: [] }), null);
});
test("accepts deferred task fields and excludes deferred minutes from totalMinutes", () => {
  const plan = { ...copyPlan(), deferredTasks: [{
    ...makeTask(3, { minutes: 720 }), deferredReason: "Not enough time remains in this execution window."
  }] };
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["string", "not a plan"], ["array", []], ["number", 7], ["null", null]
]) test("rejects wrong root shape: " + label, () => assertInvalid(value, "$"));

for (const field of ["summary", "totalMinutes", "tasks"]) {
  test("rejects missing required plan field: " + field, () => {
    const plan = copyPlan(); delete plan[field]; assertInvalid(plan, field);
  });
}
for (const [label, value] of [
  ["number", 42], ["array", []], ["object", {}], ["null", null],
  ["empty", ""], ["whitespace-only", "   "], ["overlong", "s".repeat(501)]
]) test("rejects invalid summary: " + label, () => {
  const plan = copyPlan(); plan.summary = value; assertInvalid(plan, "summary");
});
test("accepts summary at the 500-character boundary", () => {
  const plan = makePlan(1); plan.summary = "S".repeat(500);
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["number", "40"], ["string", "40"], ["array", []], ["null", null],
  ["fraction", 40.5], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY],
  ["zero", 0], ["negative", -1], ["above maximum", 721]
]) test("rejects invalid totalMinutes: " + label, () => {
  const plan = copyPlan(); plan.totalMinutes = value; assertInvalid(plan, "totalMinutes");
});
test("rejects totalMinutes that differs from scheduled task-duration sum", () => {
  const plan = copyPlan(); plan.totalMinutes = 39; assertInvalid(plan, "totalMinutes");
});
test("rejects scheduled duration sums beyond the totalMinutes limit", () => {
  const plan = { summary: "Overlong schedule", totalMinutes: 720,
    tasks: [makeTask(1, { minutes: 400 }), makeTask(2, { minutes: 400 })] };
  assertInvalid(plan, "totalMinutes");
});

for (const [label, value] of [
  ["object", {}], ["array", []], ["string", "tasks"], ["null", null]
]) test("rejects invalid tasks collection: " + label, () => {
  const plan = copyPlan(); plan.tasks = value; assertInvalid(plan, "tasks");
});
test("rejects an empty scheduled task list", () => {
  const plan = { summary: "Nothing scheduled", totalMinutes: 1, tasks: [] };
  assertInvalid(plan, "tasks");
});
test("rejects too many scheduled tasks", () => assertInvalid(makePlan(21), "tasks"));
test("accepts the task-count minimum of one", () => assert.equal(validateGeneratedPlan(makePlan(1)), null));
test("accepts the scheduled task-count maximum of twenty", () => assert.equal(validateGeneratedPlan(makePlan(20)), null));

for (const field of ["id", "title", "minutes", "priority", "reason", "dependsOn", "category"]) {
  test("rejects missing required task field: " + field, () => {
    const plan = copyPlan(); delete plan.tasks[0][field];
    assertInvalid(plan, "tasks[0]." + field);
  });
}
for (const [label, value] of [
  ["empty", ""], ["whitespace-only", "   "], ["malformed prefix", "1task"],
  ["malformed punctuation", "task/1"], ["overlong", "a" + "b".repeat(64)], ["number", 12]
]) test("rejects invalid task ID: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].id = value; assertInvalid(plan, "tasks[0].id");
});
test("rejects duplicate scheduled task IDs", () => {
  const plan = copyPlan(); plan.tasks[1].id = plan.tasks[0].id;
  assertInvalid(plan, "tasks[1].id");
});
test("rejects duplicate IDs across scheduled and deferred tasks", () => {
  const plan = { ...copyPlan(), deferredTasks: [{
    ...makeTask(3), id: "t1", deferredReason: "Later."
  }] };
  assertInvalid(plan, "deferredTasks[0].id");
});
test("accepts task IDs exactly 64 characters long", () => {
  const plan = makePlan(1); plan.tasks[0].id = "a" + "b".repeat(63);
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["empty", ""], ["whitespace-only", "   "], ["overlong", "t".repeat(161)],
  ["number", 42], ["object", {}], ["null", null]
]) test("rejects invalid title: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].title = value; assertInvalid(plan, "tasks[0].title");
});
test("accepts task titles exactly 160 characters long", () => {
  const plan = makePlan(1); plan.tasks[0].title = "T".repeat(160);
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["zero", 0], ["negative", -1], ["fractional", 1.5], ["string", "15"],
  ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["over maximum", 721], ["null", null]
]) test("rejects invalid duration: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].minutes = value;
  assertInvalid(plan, "tasks[0].minutes");
});

for (const [label, value] of [
  ["unsupported value", "urgent"], ["wrong case", "HIGH"], ["number", 2], ["null", null]
]) test("rejects unsupported priority: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].priority = value;
  assertInvalid(plan, "tasks[0].priority");
});
for (const [label, value] of [
  ["unsupported value", "design"], ["wrong case", "Build"], ["number", 1], ["null", null]
]) test("rejects unsupported category: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].category = value;
  assertInvalid(plan, "tasks[0].category");
});

for (const [label, value] of [
  ["empty", ""], ["whitespace-only", "   "], ["overlong", "r".repeat(501)],
  ["number", 9], ["array", []], ["null", null]
]) test("rejects invalid reason: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].reason = value;
  assertInvalid(plan, "tasks[0].reason");
});
test("accepts reason text exactly 500 characters long", () => {
  const plan = makePlan(1); plan.tasks[0].reason = "R".repeat(500);
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["string", "t1"], ["object", {}], ["null", null],
  ["contains non-string", ["t2", 9]], ["contains malformed ID", ["bad/id"]],
  ["too many IDs", Array.from({ length: 21 }, (_unused, index) => "d" + index)]
]) test("rejects invalid dependsOn: " + label, () => {
  const plan = copyPlan(); plan.tasks[0].dependsOn = value;
  assertInvalid(plan, "tasks[0].dependsOn");
});
test("accepts twenty syntactically valid dependency IDs without resolving their graph", () => {
  const plan = makePlan(1);
  plan.tasks[0].dependsOn = Array.from({ length: 20 }, (_unused, index) => "dep" + index);
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["object", {}], ["string", "not a list"], ["null", null],
  ["too many", Array.from({ length: 21 }, (_unused, index) => ({
    ...makeTask(index), deferredReason: "Deferred for later."
  }))]
]) test("rejects invalid deferredTasks: " + label, () => {
  const plan = copyPlan(); plan.deferredTasks = value;
  assertInvalid(plan, "deferredTasks");
});
test("rejects more than twenty scheduled and deferred nodes combined", () => {
  const plan = { summary: "Combined cap", totalMinutes: 1, tasks: [makeTask(0)],
    deferredTasks: Array.from({ length: 20 }, (_unused, index) => ({
      ...makeTask(index + 1), deferredReason: "Deferred for later."
    })) };
  assertInvalid(plan, "$");
});
test("accepts exactly twenty scheduled and deferred nodes combined", () => {
  const plan = { summary: "Combined cap", totalMinutes: 1, tasks: [makeTask(0)],
    deferredTasks: Array.from({ length: 19 }, (_unused, index) => ({
      ...makeTask(index + 1), deferredReason: "Deferred for later."
    })) };
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, value] of [
  ["missing", undefined], ["empty", ""], ["whitespace-only", "   "],
  ["overlong", "d".repeat(501)], ["number", 8], ["array", []], ["null", null]
]) test("rejects invalid deferredReason: " + label, () => {
  const plan = { summary: "Deferred work", totalMinutes: 1, tasks: [makeTask(0)],
    deferredTasks: [{ ...makeTask(1), deferredReason: value }] };
  assertInvalid(plan, "deferredTasks[0].deferredReason");
});
test("accepts deferredReason exactly 500 characters long", () => {
  const plan = { summary: "Deferred work", totalMinutes: 1, tasks: [makeTask(0)],
    deferredTasks: [{ ...makeTask(1), deferredReason: "D".repeat(500) }] };
  assert.equal(validateGeneratedPlan(plan), null);
});

for (const [label, mutate, path] of [
  ["unexpected top-level field", plan => { plan.internalToken = "private-sentinel"; }, "$"],
  ["unexpected scheduled-task field", plan => { plan.tasks[0].extraField = "private-sentinel"; }, "tasks[0]"],
  ["unexpected deferred-task field", plan => { plan.deferredTasks = [{
    ...makeTask(3), deferredReason: "Later.", unsupportedField: "private-sentinel"
  }]; }, "deferredTasks[0]"],
  ["deferred-only field on scheduled task", plan => { plan.tasks[0].deferredReason = "Not allowed."; }, "tasks[0]"]
]) test("rejects " + label + " without echoing model data", () => {
  const plan = copyPlan(); mutate(plan);
  const error = validateGeneratedPlan(plan);
  assert.ok(error);
  assert.equal(error.code, "INVALID_MODEL_OUTPUT");
  assert.equal(error.message, "The model returned an invalid plan.");
  assert.equal(error.path, path);
  assert.equal(error.message.includes("private-sentinel"), false);
  assert.equal(error.message.includes("unsupportedField"), false);
});
test("rejects malformed nested task objects", () => {
  const plan = copyPlan(); plan.tasks[1] = null;
  assertInvalid(plan, "tasks[1]");
});
test("valid JSON syntax alone does not make a value a plan", () => {
  assertInvalid([], "$");
  assertInvalid({ summary: "only a summary" }, "totalMinutes");
});
