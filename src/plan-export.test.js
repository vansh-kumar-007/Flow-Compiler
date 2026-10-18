import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PLAN } from "./plan-ui.js";
import { createSafePlanExport, serializeSafePlanExport } from "./plan-export.js";

test("safe export retains actionable dependency metadata and completion without free-form notes", () => {
  const exported = createSafePlanExport(DEMO_PLAN, { "demo-t1": true }, "2026-10-19T00:00:00.000Z");
  assert.equal(exported.format, "flow-compiler-safe-plan");
  assert.equal(exported.scheduledMinutes, 70);
  assert.equal(exported.scheduledTasks[0].completed, true);
  assert.deepEqual(exported.scheduledTasks[1].dependsOn, ["demo-t1"]);
  assert.equal("summary" in exported, false);
  assert.equal("reason" in exported.scheduledTasks[0], false);
  assert.equal("deferredReason" in exported.deferredTasks[0], false);
  const serialized = serializeSafePlanExport(DEMO_PLAN, {}, "2026-10-19T00:00:00.000Z");
  for (const privateField of ["brainDump", "accessToken", "NVIDIA_API_KEY", "revisionNote", "deferredReason", "reason"]) {
    assert.equal(serialized.includes(privateField), false);
  }
});

test("safe export refuses malformed plans and completion state", () => {
  assert.throws(() => createSafePlanExport({ ...DEMO_PLAN, tasks: [] }), /validated plan/);
  assert.throws(() => createSafePlanExport(DEMO_PLAN, null), /Completion state/);
});
