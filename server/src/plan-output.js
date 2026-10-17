const TASK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PRIORITIES = new Set(["high", "normal", "low"]);
const CATEGORIES = new Set(["build", "learn", "admin", "review"]);

const PLAN_FIELDS = new Set(["summary", "totalMinutes", "tasks", "deferredTasks"]);
const TASK_FIELDS = new Set([
  "id", "title", "minutes", "priority", "reason", "dependsOn", "category"
]);
const DEFERRED_TASK_FIELDS = new Set([...TASK_FIELDS, "deferredReason"]);

const INVALID = Object.freeze({
  code: "INVALID_MODEL_OUTPUT",
  message: "The model returned an invalid plan."
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyFields(value, allowedFields) {
  return Object.keys(value).every(field => allowedFields.has(field));
}
function isBoundedText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}
function invalid(path) {
  // Paths contain only validator-authored labels/indices, never model-supplied keys or values.
  return { ...INVALID, path };
}

function validateTask(task, index, deferred = false) {
  const label = (deferred ? "deferredTasks" : "tasks") + "[" + index + "]";
  if (!isRecord(task) || !hasOnlyFields(task, deferred ? DEFERRED_TASK_FIELDS : TASK_FIELDS)) {
    return invalid(label);
  }
  if (typeof task.id !== "string" || !TASK_ID.test(task.id)) return invalid(label + ".id");
  if (!isBoundedText(task.title, 160)) return invalid(label + ".title");
  if (!Number.isInteger(task.minutes) || task.minutes < 1 || task.minutes > 720) {
    return invalid(label + ".minutes");
  }
  if (!PRIORITIES.has(task.priority)) return invalid(label + ".priority");
  if (!isBoundedText(task.reason, 500)) return invalid(label + ".reason");
  if (!Array.isArray(task.dependsOn) || task.dependsOn.length > 20) {
    return invalid(label + ".dependsOn");
  }
  // P2-06 validates dependency field shape and ID syntax only. Reference, edge,
  // ordering, and cycle semantics belong to P2-07.
  for (const dependencyId of task.dependsOn) {
    if (typeof dependencyId !== "string" || !TASK_ID.test(dependencyId)) {
      return invalid(label + ".dependsOn");
    }
  }
  if (!CATEGORIES.has(task.category)) return invalid(label + ".category");
  if (deferred && !isBoundedText(task.deferredReason, 500)) {
    return invalid(label + ".deferredReason");
  }
  return null;
}

/**
 * Validate a parsed model value against the documented plan/task response schema.
 * Return null when valid, otherwise a stable safe INVALID_MODEL_OUTPUT error.
 * Does not coerce or mutate data; dependency graph checks are P2-07 and budget
 * scheduling/deferred-work selection are P2-08.
 */
export function validateGeneratedPlan(plan) {
  if (!isRecord(plan) || !hasOnlyFields(plan, PLAN_FIELDS)) return invalid("$");
  if (!isBoundedText(plan.summary, 500)) return invalid("summary");
  if (!Number.isInteger(plan.totalMinutes) || plan.totalMinutes < 1 || plan.totalMinutes > 720) {
    return invalid("totalMinutes");
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 20) {
    return invalid("tasks");
  }
  if (Object.hasOwn(plan, "deferredTasks")
      && (!Array.isArray(plan.deferredTasks) || plan.deferredTasks.length > 20)) {
    return invalid("deferredTasks");
  }

  const deferredTasks = Object.hasOwn(plan, "deferredTasks") ? plan.deferredTasks : [];
  if (plan.tasks.length + deferredTasks.length > 20) return invalid("$");

  const ids = new Set();
  let scheduledMinutes = 0;
  for (let index = 0; index < plan.tasks.length; index += 1) {
    const task = plan.tasks[index];
    const error = validateTask(task, index);
    if (error) return error;
    if (ids.has(task.id)) return invalid("tasks[" + index + "].id");
    ids.add(task.id);
    scheduledMinutes += task.minutes;
  }

  for (let index = 0; index < deferredTasks.length; index += 1) {
    const task = deferredTasks[index];
    const error = validateTask(task, index, true);
    if (error) return error;
    if (ids.has(task.id)) return invalid("deferredTasks[" + index + "].id");
    ids.add(task.id);
  }

  // totalMinutes is the sum of scheduled tasks only, not deferred tasks.
  if (scheduledMinutes > 720 || plan.totalMinutes !== scheduledMinutes) {
    return invalid("totalMinutes");
  }
  return null;
}
