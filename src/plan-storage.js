import { getTimeError } from "./plan-ui.js";
import { validateActivePlan } from "./plan-interactions.js";

export const SAVED_PLAN_STORAGE_KEY = "flow-compiler.active-plan.v1";
export const SAVED_PLAN_SCHEMA_VERSION = 1;
export const SAVED_PLAN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SAVED_PLAN_MAX_BYTES = 64 * 1024;

const PLAN_KINDS = new Set(["demo", "demo-revision", "api", "api-revision"]);

function getBrowserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanCompletedIds(plan, completedTaskIds) {
  if (!isRecord(plan) || !Array.isArray(plan.tasks) || !isRecord(completedTaskIds)) return null;
  if (!Object.values(completedTaskIds).every(value => typeof value === "boolean")) return null;
  const scheduledIds = new Set(plan.tasks.map(task => task.id));
  return Object.fromEntries(
    Object.entries(completedTaskIds).filter(([id, checked]) => checked === true && scheduledIds.has(id))
  );
}

export function savePlanSnapshot(
  { plan, completedTaskIds = {}, availableMinutes, planKind },
  storage = getBrowserStorage(),
  now = Date.now()
) {
  if (!storage) return { ok: false, reason: "unavailable" };
  if (!Number.isInteger(availableMinutes) || getTimeError(availableMinutes)) {
    return { ok: false, reason: "invalid-budget" };
  }
  if (!PLAN_KINDS.has(planKind)) return { ok: false, reason: "invalid-plan" };
  const cleanedCompletedIds = cleanCompletedIds(plan, completedTaskIds);
  if (!cleanedCompletedIds) return { ok: false, reason: "invalid-completion-state" };
  if (validateActivePlan(plan, cleanedCompletedIds, availableMinutes)) {
    return { ok: false, reason: "invalid-plan" };
  }

  const snapshot = {
    schemaVersion: SAVED_PLAN_SCHEMA_VERSION,
    savedAt: now,
    availableMinutes,
    planKind,
    plan,
    completedTaskIds: cleanedCompletedIds
  };
  const serialized = JSON.stringify(snapshot);
  if (byteLength(serialized) > SAVED_PLAN_MAX_BYTES) return { ok: false, reason: "too-large" };
  try {
    storage.setItem(SAVED_PLAN_STORAGE_KEY, serialized);
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function clearPlanSnapshot(storage = getBrowserStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(SAVED_PLAN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadPlanSnapshot(storage = getBrowserStorage(), now = Date.now()) {
  if (!storage) return { snapshot: null, status: "unavailable" };
  let serialized;
  try {
    serialized = storage.getItem(SAVED_PLAN_STORAGE_KEY);
  } catch {
    return { snapshot: null, status: "unavailable" };
  }
  if (serialized === null) return { snapshot: null, status: "empty" };

  const discard = status => {
    clearPlanSnapshot(storage);
    return { snapshot: null, status };
  };
  if (typeof serialized !== "string" || byteLength(serialized) > SAVED_PLAN_MAX_BYTES) {
    return discard("invalid");
  }

  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    return discard("invalid");
  }
  if (!isRecord(value)
    || value.schemaVersion !== SAVED_PLAN_SCHEMA_VERSION
    || !Number.isFinite(value.savedAt)
    || value.savedAt > now + 5 * 60 * 1000
    || now - value.savedAt > SAVED_PLAN_MAX_AGE_MS
    || !Number.isInteger(value.availableMinutes)
    || getTimeError(value.availableMinutes)
    || !PLAN_KINDS.has(value.planKind)
    || !isRecord(value.plan)) {
    return discard("invalid");
  }

  const completedTaskIds = cleanCompletedIds(value.plan, value.completedTaskIds);
  if (!completedTaskIds || validateActivePlan(value.plan, completedTaskIds, value.availableMinutes)) return discard("invalid");
  return {
    snapshot: {
      schemaVersion: SAVED_PLAN_SCHEMA_VERSION,
      savedAt: value.savedAt,
      availableMinutes: value.availableMinutes,
      planKind: value.planKind,
      plan: value.plan,
      completedTaskIds
    },
    status: "loaded"
  };
}
