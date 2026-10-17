const MAX_AVAILABLE_MINUTES = 720;
const MIN_AVAILABLE_MINUTES = 5;

const INVALID = Object.freeze({
  code: "INVALID_MODEL_OUTPUT",
  message: "The model returned an invalid plan."
});

function invalid(path) {
  // Paths are authored by this validator and never contain model-supplied values.
  return { ...INVALID, path };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * P2-08 schedule and deferral validation.
 *
 * The model chooses which whole tasks belong in the current window and which
 * should be deferred. This validator never reorders, drops, splits, or silently
 * moves tasks: changing task placement can invalidate dependency semantics.
 * P2-06 validates schema and scheduled-duration equality; P2-07 validates the
 * dependency graph. This stage validates the budget-specific invariants.
 */
export function validateGeneratedSchedule(plan, options = {}) {
  try {
    if (!isRecord(plan)) return invalid("$");
    if (!isRecord(options)) return invalid("availableMinutes");

    const availableMinutes = options.availableMinutes;
    if (!Number.isInteger(availableMinutes)
        || availableMinutes < MIN_AVAILABLE_MINUTES
        || availableMinutes > MAX_AVAILABLE_MINUTES) {
      return invalid("availableMinutes");
    }
    if (!Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 20) {
      return invalid("tasks");
    }
    const deferredTasks = Object.hasOwn(plan, "deferredTasks")
      ? plan.deferredTasks
      : [];
    if (!Array.isArray(deferredTasks) || deferredTasks.length > 20
        || plan.tasks.length + deferredTasks.length > 20) {
      return invalid("deferredTasks");
    }

    let scheduledMinutes = 0;
    for (let index = 0; index < plan.tasks.length; index += 1) {
      const task = plan.tasks[index];
      if (!isRecord(task) || !Number.isInteger(task.minutes)
          || task.minutes < 1 || task.minutes > MAX_AVAILABLE_MINUTES) {
        return invalid("tasks[" + index + "].minutes");
      }
      scheduledMinutes += task.minutes;
      if (!Number.isSafeInteger(scheduledMinutes)) {
        return invalid("totalMinutes");
      }
      if (scheduledMinutes > availableMinutes) {
        return invalid("totalMinutes");
      }
    }

    for (let index = 0; index < deferredTasks.length; index += 1) {
      const task = deferredTasks[index];
      if (!isRecord(task)) return invalid("deferredTasks[" + index + "]");
      if (typeof task.deferredReason !== "string"
          || task.deferredReason.trim().length === 0
          || task.deferredReason.length > 500) {
        return invalid("deferredTasks[" + index + "].deferredReason");
      }
    }

    if (!Number.isInteger(plan.totalMinutes)
        || plan.totalMinutes !== scheduledMinutes
        || plan.totalMinutes > availableMinutes) {
      return invalid("totalMinutes");
    }

    return null;
  } catch {
    // Malformed input is a validation failure, not an uncaught exception.
    return invalid("$");
  }
}
