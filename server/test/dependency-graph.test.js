import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGeneratedPlan } from "../src/plan-output.js";
import { validateGeneratedDependencies } from "../src/dependency-graph.js";
import { createNvidiaClient } from "../src/nvidia-client.js";

const SECRET = "dependency-private-sentinel";

function task(id, dependsOn = [], deferred = false) {
  return {
    id,
    title: "Complete task " + id,
    minutes: 1,
    priority: "normal",
    reason: "This is a concrete next action.",
    dependsOn,
    category: "build",
    ...(deferred ? { deferredReason: "Not enough time remains in this execution window." } : {})
  };
}

function plan(tasks, deferredTasks) {
  return {
    summary: "A valid generated dependency graph.",
    totalMinutes: tasks.reduce((sum, current) => sum + current.minutes, 0),
    tasks,
    ...(deferredTasks === undefined ? {} : { deferredTasks })
  };
}

function assertInvalid(value, options, expectedPath) {
  const error = validateGeneratedDependencies(value, options);
  assert.ok(error, "expected invalid dependency graph");
  assert.equal(error.code, "INVALID_MODEL_OUTPUT");
  assert.equal(error.message, "The model returned an invalid plan.");
  if (expectedPath !== undefined) assert.equal(error.path, expectedPath);
  assert.equal(error.message.includes(SECRET), false);
  return error;
}

function mockNvidiaClient(generatedPlan) {
  const body = JSON.stringify({
    choices: [{ message: { content: JSON.stringify(generatedPlan) } }]
  });
  return createNvidiaClient({
    env: { NVIDIA_API_KEY: "test-only-fake-key" },
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });
}

test("accepts several independent tasks mixed with valid dependencies", () => {
  const value = plan([
    task("a"),
    task("b"),
    task("c", ["a"]),
    task("d", ["b", "c"])
  ]);
  assert.equal(validateGeneratedDependencies(value), null);
});

test("accepts an acyclic graph with multiple dependency levels", () => {
  const value = plan([
    task("root"),
    task("level1", ["root"]),
    task("level2", ["level1"]),
    task("level3", ["level2"])
  ]);
  assert.equal(validateGeneratedDependencies(value), null);
});

test("accepts a dependency on a completed task supplied through validated context", () => {
  const value = plan([task("next", ["alreadyDone"])]);
  assert.equal(
    validateGeneratedDependencies(value, { completedTaskIds: ["alreadyDone"] }),
    null
  );
});

test("rejects unknown or dangling dependency IDs", () => {
  assertInvalid(plan([task("a", ["unknownTask"])]), undefined, "tasks[0].dependsOn[0]");
});

test("rejects malformed dependency entries with stable errors", () => {
  for (const dependency of [null, 7, {}, "bad/id", ""]) {
    assertInvalid(plan([task("a", [dependency])]));
  }
});

test("rejects a task that depends on itself", () => {
  assertInvalid(plan([task("a", ["a"])]), undefined, "tasks[0].dependsOn[0]");
});

test("rejects duplicate dependency edges", () => {
  assertInvalid(plan([task("a"), task("b", ["a", "a"])]), undefined, "tasks[1].dependsOn[1]");
});

test("detects a two-task dependency cycle", () => {
  assertInvalid(plan([task("a", ["b"]), task("b", ["a"])]));
});

test("detects cycles involving three or more tasks", () => {
  assertInvalid(plan([
    task("a", ["b"]),
    task("b", ["c"]),
    task("c", ["a"]),
    task("independent")
  ]));
});

test("detects cycles involving deferred tasks across the combined graph", () => {
  assertInvalid(plan(
    [task("scheduled")],
    [task("deferredA", ["deferredB"], true), task("deferredB", ["deferredA"], true)]
  ));
});

test("rejects scheduled work that depends on a deferred prerequisite", () => {
  assertInvalid(
    plan([task("scheduled", ["later"])], [task("later", [], true)]),
    undefined,
    "tasks[0].dependsOn[0]"
  );
});

test("accepts deferred work that depends on scheduled work", () => {
  assert.equal(
    validateGeneratedDependencies(plan(
      [task("scheduled")],
      [task("later", ["scheduled"], true)]
    )),
    null
  );
});

test("rejects duplicate IDs across scheduled and deferred tasks", () => {
  assertInvalid(plan([task("same")], [task("same", [], true)]), undefined, "deferredTasks[0].id");
});

test("rejects generated IDs that collide with completed-task context", () => {
  assertInvalid(
    plan([task("alreadyDone")]),
    { completedTaskIds: ["alreadyDone"] },
    "tasks[0].id"
  );
});

test("rejects malformed dependency-array values without throwing", () => {
  for (const value of ["a", 7, null, {}, true, undefined]) {
    const candidate = plan([task("a")]);
    candidate.tasks[0].dependsOn = value;
    assert.doesNotThrow(() => validateGeneratedDependencies(candidate));
    assertInvalid(candidate);
  }
});

test("accepts empty dependency lists and tasks without dependencies", () => {
  assert.equal(validateGeneratedDependencies(plan([task("a"), task("b", [])])), null);
});

test("accepts the 20-generated-node boundary deterministically", () => {
  const scheduled = [task("t0")];
  const deferred = [];
  let previous = "t0";
  for (let index = 1; index < 20; index += 1) {
    const id = "d" + index;
    deferred.push(task(id, [previous], true));
    previous = id;
  }
  assert.equal(validateGeneratedDependencies(plan(scheduled, deferred)), null);
});

test("rejects a generated graph beyond the 20-node contract maximum", () => {
  const deferred = Array.from({ length: 20 }, (_unused, index) =>
    task("d" + index, [], true)
  );
  assertInvalid(plan([task("scheduled")], deferred), undefined, "$");
});

test("accepts 20 distinct completed prerequisites at the documented dependency boundary", () => {
  const completedTaskIds = Array.from({ length: 20 }, (_unused, index) => "done" + index);
  const value = plan([task("next", completedTaskIds)]);
  assert.equal(validateGeneratedDependencies(value, { completedTaskIds }), null);
});

test("rejects malformed or duplicate completed-task context safely", () => {
  assertInvalid(plan([task("next")]), { completedTaskIds: "done" });
  assertInvalid(plan([task("next")]), { completedTaskIds: ["done", "done"] });
  assertInvalid(plan([task("next")]), { completedTaskIds: ["bad/id"] });
});

test("returns safe stable errors without revealing model text or sentinel secrets", () => {
  const privateText = SECRET + " must never be exposed in a public error";
  const value = plan([task("safeTask", ["unknownTask"])]);
  value.summary = privateText;
  const error = assertInvalid(value);
  assert.equal(JSON.stringify(error).includes(SECRET), false);
  assert.equal(error.message, "The model returned an invalid plan.");
  assert.equal(error.path, "tasks[0].dependsOn[0]");
});

test("malformed plans and task objects never throw unhandled TypeError exceptions", () => {
  const malformed = [
    null,
    "not a plan",
    { tasks: {} },
    { tasks: [null] },
    { tasks: [task("a")], deferredTasks: {} },
    { tasks: [task("a")], completedTaskIds: null }
  ];
  for (const candidate of malformed) {
    assert.doesNotThrow(() => validateGeneratedDependencies(candidate));
    assertInvalid(candidate);
  }

  const hostile = Object.defineProperty({}, "tasks", {
    get() { throw new TypeError(SECRET); }
  });
  assert.doesNotThrow(() => validateGeneratedDependencies(hostile));
  assertInvalid(hostile);
});

test("P2-06 schema validation and P2-07 dependency validation remain separate stages", () => {
  const dangling = plan([task("t1", ["missing"])]);
  assert.equal(validateGeneratedPlan(dangling), null);
  assert.equal(validateGeneratedDependencies(dangling)?.code, "INVALID_MODEL_OUTPUT");

  const malformedArray = plan([task("t1")]);
  malformedArray.tasks[0].dependsOn = "t2";
  assert.equal(validateGeneratedPlan(malformedArray)?.path, "tasks[0].dependsOn");
  assert.equal(validateGeneratedDependencies(malformedArray)?.code, "INVALID_MODEL_OUTPUT");
});

test("NVIDIA adapter passes explicit completed-task context to dependency validation", async () => {
  const output = plan([task("next", ["done1"])]);
  const client = mockNvidiaClient(output);
  const result = await client.createChatCompletion({
    messages: [{ role: "user", content: "Make a revised plan." }],
    completedTaskIds: ["done1"]
  });
  assert.deepEqual(result.output, output);
});

test("NVIDIA adapter rejects invalid dependency graphs without exposing raw model content", async () => {
  const output = plan([task("next", ["dangling"])]);
  output.summary = SECRET;
  const client = mockNvidiaClient(output);
  await assert.rejects(client.createChatCompletion({
    messages: [{ role: "user", content: "Plan tasks." }]
  }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(SECRET), false);
    assert.equal(error.message.includes("dangling"), false);
    return true;
  });
});

test("NVIDIA adapter rejects generated IDs that collide with completed context", async () => {
  const client = mockNvidiaClient(plan([task("done1")]));
  await assert.rejects(client.createChatCompletion({
    messages: [{ role: "user", content: "Revise the plan." }],
    completedTaskIds: ["done1"]
  }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    return true;
  });
});
