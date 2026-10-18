import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PLAN } from "./plan-ui.js";
import {
  SAVED_PLAN_STORAGE_KEY,
  SAVED_PLAN_MAX_AGE_MS,
  clearPlanSnapshot,
  loadPlanSnapshot,
  savePlanSnapshot
} from "./plan-storage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test("persists only the validated plan, budget, kind, and completion state", () => {
  const storage = memoryStorage();
  const saved = savePlanSnapshot({
    plan: DEMO_PLAN,
    completedTaskIds: { "demo-t1": true, stale: true },
    availableMinutes: 120,
    planKind: "demo"
  }, storage, 1000);
  assert.deepEqual(saved, { ok: true });
  const raw = storage.getItem(SAVED_PLAN_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(raw.includes("NVIDIA_API_KEY"), false);
  assert.equal(raw.includes("accessToken"), false);
  assert.equal(raw.includes("brainDump"), false);
  const loaded = loadPlanSnapshot(storage, 2000);
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.snapshot.completedTaskIds, { "demo-t1": true });
  assert.deepEqual(loaded.snapshot.plan, DEMO_PLAN);
});

test("rejects invalid plans, budgets, and malformed completion maps on save", () => {
  const storage = memoryStorage();
  assert.equal(savePlanSnapshot({ plan: DEMO_PLAN, availableMinutes: 4, planKind: "demo" }, storage).reason, "invalid-budget");
  assert.equal(savePlanSnapshot({ plan: { ...DEMO_PLAN, tasks: [] }, availableMinutes: 120, planKind: "demo" }, storage).reason, "invalid-plan");
  assert.equal(savePlanSnapshot({ plan: DEMO_PLAN, completedTaskIds: { "demo-t1": "yes" }, availableMinutes: 120, planKind: "demo" }, storage).reason, "invalid-completion-state");
  assert.equal(storage.getItem(SAVED_PLAN_STORAGE_KEY), null);
});

test("discards corrupted, expired, future-dated, and unsupported snapshots", () => {
  const storage = memoryStorage({ [SAVED_PLAN_STORAGE_KEY]: "{" });
  assert.equal(loadPlanSnapshot(storage, 1000).status, "invalid");
  assert.equal(storage.getItem(SAVED_PLAN_STORAGE_KEY), null);

  const stale = memoryStorage();
  savePlanSnapshot({ plan: DEMO_PLAN, availableMinutes: 120, planKind: "demo" }, stale, 1000);
  assert.equal(loadPlanSnapshot(stale, 1000 + SAVED_PLAN_MAX_AGE_MS + 1).status, "invalid");
  assert.equal(stale.getItem(SAVED_PLAN_STORAGE_KEY), null);

  const future = memoryStorage();
  savePlanSnapshot({ plan: DEMO_PLAN, availableMinutes: 120, planKind: "demo" }, future, 1000);
  const value = JSON.parse(future.getItem(SAVED_PLAN_STORAGE_KEY));
  value.savedAt = 1000 + 10 * 60 * 1000;
  future.setItem(SAVED_PLAN_STORAGE_KEY, JSON.stringify(value));
  assert.equal(loadPlanSnapshot(future, 1000).status, "invalid");
});

test("sanitizes stale completion IDs and clear removes only the app's saved plan", () => {
  const storage = memoryStorage({ unrelated: "keep" });
  savePlanSnapshot({ plan: DEMO_PLAN, completedTaskIds: { "demo-t1": true }, availableMinutes: 120, planKind: "demo" }, storage, 1000);
  const value = JSON.parse(storage.getItem(SAVED_PLAN_STORAGE_KEY));
  value.completedTaskIds.stale = true;
  storage.setItem(SAVED_PLAN_STORAGE_KEY, JSON.stringify(value));
  const loaded = loadPlanSnapshot(storage, 1000);
  assert.deepEqual(loaded.snapshot.completedTaskIds, { "demo-t1": true });
  assert.equal(clearPlanSnapshot(storage), true);
  assert.equal(storage.getItem(SAVED_PLAN_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("storage failures are non-fatal and reported", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.equal(savePlanSnapshot({ plan: DEMO_PLAN, availableMinutes: 120, planKind: "demo" }, unavailable).reason, "unavailable");
  assert.equal(loadPlanSnapshot(unavailable).status, "unavailable");
  assert.equal(clearPlanSnapshot(unavailable), false);
});

test("round-trips a recompiled plan whose total describes unfinished work only", () => {
  const storage = memoryStorage();
  const revised = {
    summary: "Continue the remaining task.",
    totalMinutes: 10,
    tasks: [
      { id: "done", title: "Completed prerequisite", minutes: 5, priority: "high", reason: "Already complete.", dependsOn: [], category: "build" },
      { id: "next", title: "Remaining task", minutes: 10, priority: "normal", reason: "Continue.", dependsOn: ["done"], category: "build" }
    ],
    deferredTasks: []
  };
  const saved = savePlanSnapshot({
    plan: revised,
    completedTaskIds: { done: true },
    availableMinutes: 10,
    planKind: "api-revision"
  }, storage, 5000);
  assert.deepEqual(saved, { ok: true });
  const loaded = loadPlanSnapshot(storage, 6000);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.snapshot.plan.totalMinutes, 10);
  assert.deepEqual(loaded.snapshot.completedTaskIds, { done: true });
});

test("discards snapshots whose task arrays contain malformed entries without throwing", () => {
  const storage = memoryStorage({
    [SAVED_PLAN_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      savedAt: 1000,
      availableMinutes: 120,
      planKind: "demo",
      plan: { summary: "broken", totalMinutes: 5, tasks: [null], deferredTasks: [] },
      completedTaskIds: {}
    })
  });
  let loaded;
  assert.doesNotThrow(() => { loaded = loadPlanSnapshot(storage, 1000); });
  assert.equal(loaded.status, "invalid");
  assert.equal(storage.getItem(SAVED_PLAN_STORAGE_KEY), null);
});
