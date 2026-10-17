import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGeneratedPlan } from "../src/plan-output.js";
import { validateGeneratedDependencies } from "../src/dependency-graph.js";
import { validateGeneratedSchedule } from "../src/schedule-output.js";

const SECRET = "schedule-private-sentinel";

function task(id, minutes, dependsOn = [], deferredReason) {
  return {
    id,
    title: "Complete " + id,
    minutes,
    priority: "normal",
    reason: "Concrete next action.",
    dependsOn,
    category: "build",
    ...(deferredReason === undefined ? {} : { deferredReason })
  };
}

function plan(tasks, deferredTasks = [], totalMinutes) {
  return {
    summary: "Schedule the highest-value work in the available window.",
    totalMinutes: totalMinutes ?? tasks.reduce((sum, current) => sum + current.minutes, 0),
    tasks,
    ...(deferredTasks.length === 0 ? {} : { deferredTasks })
  };
}

function assertInvalid(value, options, path) {
  const error = validateGeneratedSchedule(value, options);
  assert.ok(error, "expected invalid schedule");
  assert.equal(error.code, "INVALID_MODEL_OUTPUT");
  assert.equal(error.message, "The model returned an invalid plan.");
  if (path !== undefined) assert.equal(error.path, path);
  assert.equal(JSON.stringify(error).includes(SECRET), false);
  return error;
}

test("accepts a schedule that exactly fills the available budget", () => {
  const value = plan([task("a", 20), task("b", 25)], [], 45);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 45 }), null);
});

test("accepts a schedule that uses less than the available budget", () => {
  const value = plan([task("a", 20), task("b", 15)], [], 35);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 50 }), null);
});

test("rejects over-budget scheduled work instead of silently moving or dropping tasks", () => {
  const value = plan([task("a", 30), task("b", 25)], [], 55);
  assertInvalid(value, { availableMinutes: 50 }, "totalMinutes");
});

test("accepts deferred tasks with meaningful deferred reasons without adding their durations", () => {
  const value = plan(
    [task("ship", 20)],
    [task("tutorial", 60, [], "Lower urgency than the release blocker.")],
    20
  );
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 20 }), null);
});

test("does not count deferred durations toward the scheduled total", () => {
  const value = plan(
    [task("now", 10)],
    [task("later", 100, [], "Not enough time remains in this window.")],
    10
  );
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 10 }), null);
});

test("rejects totalMinutes that differs from the scheduled-duration sum", () => {
  const value = plan([task("a", 15), task("b", 15)], [], 29);
  assertInvalid(value, { availableMinutes: 60 }, "totalMinutes");
});

test("accepts the minimum permitted availableMinutes value of five", () => {
  const value = plan([task("small", 5)], [], 5);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 5 }), null);
});

test("accepts the maximum permitted availableMinutes value of 720", () => {
  const value = plan([task("long", 720)], [], 720);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 720 }), null);
});

test("rejects scheduled work above the minimum five-minute budget", () => {
  const value = plan([task("tooLong", 6)], [], 6);
  assertInvalid(value, { availableMinutes: 5 }, "totalMinutes");
});

test("rejects deferred tasks without meaningful deferredReason text", () => {
  for (const reason of [undefined, "", "   ", 5, {}, "x".repeat(501)]) {
    const deferred = task("later", 30, [], reason);
    if (reason === undefined) delete deferred.deferredReason;
    assertInvalid(plan([task("now", 5)], [deferred], 5), { availableMinutes: 5 });
  }
});

test("rejects malformed budget values without throwing", () => {
  for (const budget of [undefined, null, "30", 4, 721, 30.5, Number.NaN]) {
    assert.doesNotThrow(() => validateGeneratedSchedule(plan([task("a", 1)]), { availableMinutes: budget }));
    assertInvalid(plan([task("a", 1)]), { availableMinutes: budget });
  }
});

test("rejects malformed context and generated output with safe errors", () => {
  assertInvalid(plan([task("a", 1)]), null, "availableMinutes");
  for (const value of [null, "private string", [], { tasks: {} }]) {
    assert.doesNotThrow(() => validateGeneratedSchedule(value, { availableMinutes: 10 }));
    assertInvalid(value, { availableMinutes: 10 });
  }
  const hostile = Object.defineProperty({}, "tasks", {
    get() { throw new TypeError(SECRET); }
  });
  assert.doesNotThrow(() => validateGeneratedSchedule(hostile, { availableMinutes: 10 }));
  assertInvalid(hostile, { availableMinutes: 10 }, "$");
});

test("rejects a scheduled task that depends on a deferred prerequisite via P2-07", () => {
  const value = plan(
    [task("deploy", 10, ["bugfix"])],
    [task("bugfix", 20, [], "This prerequisite must be resolved first.")],
    10
  );
  assert.equal(validateGeneratedPlan(value), null);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 15 })?.code, "INVALID_MODEL_OUTPUT");
  assert.equal(validateGeneratedDependencies(value)?.path, "tasks[0].dependsOn[0]");
});

test("accepts independent scheduled work while other work is deferred", () => {
  const value = plan(
    [task("independent", 15)],
    [task("later", 30, [], "Lower urgency this session.")],
    15
  );
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 20 }), null);
  assert.equal(validateGeneratedDependencies(value), null);
});

test("preserves dependency chains spanning scheduled and deferred work without dropping edges", () => {
  const valid = plan(
    [task("prerequisite", 10)],
    [task("dependent", 20, ["prerequisite"], "Not enough time remains for both actions.")],
    10
  );
  assert.equal(validateGeneratedSchedule(valid, { availableMinutes: 10 }), null);
  assert.equal(validateGeneratedDependencies(valid), null);

  const invalid = plan(
    [task("dependent", 10, ["prerequisite"])],
    [task("prerequisite", 20, [], "Deferred prerequisite.")],
    10
  );
  assert.equal(validateGeneratedSchedule(invalid, { availableMinutes: 30 })?.code, "INVALID_MODEL_OUTPUT");
  assert.equal(validateGeneratedDependencies(invalid)?.code, "INVALID_MODEL_OUTPUT");
});

test("completed-task context is a dependency-stage concern and completed work is not added to scheduled minutes", () => {
  const value = plan([task("next", 10, ["done1"])], [], 10);
  assert.equal(validateGeneratedSchedule(value, { availableMinutes: 10, completedTaskIds: ["done1"] }), null);
  assert.equal(validateGeneratedDependencies(value, { completedTaskIds: ["done1"] }), null);
});

test("schema, dependency, and scheduling validation remain independent stages", () => {
  const overBudget = plan([task("a", 15), task("b", 15)], [], 30);
  assert.equal(validateGeneratedPlan(overBudget), null);
  assert.equal(validateGeneratedDependencies(overBudget), null);
  assert.equal(validateGeneratedSchedule(overBudget, { availableMinutes: 20 })?.code, "INVALID_MODEL_OUTPUT");

  const invalidSchema = plan([task("a", 15)], [], 14);
  assert.equal(validateGeneratedPlan(invalidSchema)?.path, "totalMinutes");
  assert.equal(validateGeneratedSchedule(invalidSchema, { availableMinutes: 20 })?.code, "INVALID_MODEL_OUTPUT");

  const valid = plan([task("a", 10)]);
  assert.equal(validateGeneratedPlan(valid), null);
  assert.equal(validateGeneratedDependencies(valid), null);
  assert.equal(validateGeneratedSchedule(valid, { availableMinutes: 20 }), null);
});

test("safe schedule errors never reveal model text, task details or sentinel secrets", () => {
  const value = plan([task("privateTask", 40)], [], 40);
  value.summary = SECRET;
  const error = assertInvalid(value, { availableMinutes: 5 }, "totalMinutes");
  assert.equal(error.message.includes("privateTask"), false);
  assert.equal(error.message.includes(SECRET), false);
});
