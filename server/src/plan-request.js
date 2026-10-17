const TASK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PRIORITIES = new Set(["high", "normal", "low"]);
const CATEGORIES = new Set(["build", "learn", "admin", "review"]);
const REVISION_REASONS = new Set([
  "time_changed",
  "completed_early",
  "blocked",
  "manual"
]);

const TOP_LEVEL_FIELDS = new Set([
  "brainDump",
  "availableMinutes",
  "previousPlan"
]);
const PREVIOUS_PLAN_FIELDS = new Set([
  "summary",
  "totalMinutes",
  "tasks",
  "completedTaskIds",
  "revisionContext"
]);
const REVISION_CONTEXT_FIELDS = new Set(["reason", "note", "blockers"]);
const TASK_FIELDS = new Set([
  "id",
  "title",
  "minutes",
  "priority",
  "reason",
  "dependsOn",
  "category"
]);
const BLOCKER_FIELDS = new Set(["taskId", "description"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(value, allowedFields) {
  return Object.keys(value).every(field => allowedFields.has(field));
}

function isBoundedText(value, maxLength) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength;
}

function invalid(message) {
  return { code: "INVALID_REQUEST", message };
}

function validateTask(task, label) {
  if (!isRecord(task) || !hasOnlyFields(task, TASK_FIELDS)) {
    return invalid(label + " must be a task object with only documented fields.");
  }

  if (typeof task.id !== "string" || !TASK_ID.test(task.id)) {
    return invalid(label + ".id must be a valid task ID.");
  }
  if (!isBoundedText(task.title, 160)) {
    return invalid(label + ".title must be a non-empty string of at most 160 characters.");
  }
  if (!Number.isInteger(task.minutes) || task.minutes < 1 || task.minutes > 720) {
    return invalid(label + ".minutes must be an integer between 1 and 720.");
  }
  if (!PRIORITIES.has(task.priority)) {
    return invalid(label + ".priority must be high, normal, or low.");
  }
  if (!isBoundedText(task.reason, 500)) {
    return invalid(label + ".reason must be a non-empty string of at most 500 characters.");
  }
  if (!Array.isArray(task.dependsOn) || task.dependsOn.length > 20) {
    return invalid(label + ".dependsOn must be an array containing at most 20 task IDs.");
  }
  const dependencyIds = new Set();
  for (const dependencyId of task.dependsOn) {
    if (typeof dependencyId !== "string" || !TASK_ID.test(dependencyId)) {
      return invalid(label + ".dependsOn contains an invalid task ID.");
    }
    if (dependencyIds.has(dependencyId)) {
      return invalid(label + ".dependsOn must not contain duplicate IDs.");
    }
    dependencyIds.add(dependencyId);
  }
  if (!CATEGORIES.has(task.category)) {
    return invalid(label + ".category must be build, learn, admin, or review.");
  }

  return null;
}

function validatePreviousPlan(previousPlan) {
  if (!isRecord(previousPlan) || !hasOnlyFields(previousPlan, PREVIOUS_PLAN_FIELDS)) {
    return invalid("previousPlan must be an object containing only documented fields or null.");
  }

  if (Object.hasOwn(previousPlan, "summary") && !isBoundedText(previousPlan.summary, 500)) {
    return invalid("previousPlan.summary must be a non-empty string of at most 500 characters.");
  }
  if (Object.hasOwn(previousPlan, "totalMinutes")
      && (!Number.isInteger(previousPlan.totalMinutes)
        || previousPlan.totalMinutes < 1
        || previousPlan.totalMinutes > 720)) {
    return invalid("previousPlan.totalMinutes must be an integer between 1 and 720.");
  }
  if (!Array.isArray(previousPlan.tasks)
      || previousPlan.tasks.length < 1
      || previousPlan.tasks.length > 20) {
    return invalid("previousPlan.tasks must contain between 1 and 20 unfinished tasks.");
  }

  const taskIds = new Set();
  for (let index = 0; index < previousPlan.tasks.length; index += 1) {
    const task = previousPlan.tasks[index];
    const taskError = validateTask(task, "previousPlan.tasks[" + index + "]");
    if (taskError) return taskError;
    if (taskIds.has(task.id)) {
      return invalid("previousPlan.tasks must use unique task IDs.");
    }
    taskIds.add(task.id);
  }

  let completedIds = [];
  if (Object.hasOwn(previousPlan, "completedTaskIds")) {
    if (!Array.isArray(previousPlan.completedTaskIds)
        || previousPlan.completedTaskIds.length > 20) {
      return invalid("previousPlan.completedTaskIds must be an array containing at most 20 IDs.");
    }
    const completedSet = new Set();
    for (const completedId of previousPlan.completedTaskIds) {
      if (typeof completedId !== "string" || !TASK_ID.test(completedId)) {
        return invalid("previousPlan.completedTaskIds contains an invalid task ID.");
      }
      if (completedSet.has(completedId)) {
        return invalid("previousPlan.completedTaskIds must not contain duplicates.");
      }
      if (taskIds.has(completedId)) {
        return invalid("A task ID cannot be both unfinished and completed.");
      }
      completedSet.add(completedId);
    }
    completedIds = [...completedSet];
  }

  if (taskIds.size + completedIds.length > 20) {
    return invalid("previousPlan cannot contain more than 20 unfinished and completed task IDs combined.");
  }

  // Reject dangling references in client-supplied context before it reaches the prompt.
  // Cycle detection on generated plans remains a separate model-output validation step.
  const validDependencyIds = new Set([...taskIds, ...completedIds]);
  for (let index = 0; index < previousPlan.tasks.length; index += 1) {
    const task = previousPlan.tasks[index];
    for (const dependencyId of task.dependsOn) {
      if (dependencyId === task.id) {
        return invalid("A task cannot depend on itself.");
      }
      if (!validDependencyIds.has(dependencyId)) {
        return invalid("previousPlan.tasks[" + index + "].dependsOn references an unknown task ID.");
      }
    }
  }

  if (Object.hasOwn(previousPlan, "revisionContext")) {
    const context = previousPlan.revisionContext;
    if (!isRecord(context) || !hasOnlyFields(context, REVISION_CONTEXT_FIELDS)) {
      return invalid("previousPlan.revisionContext must be an object with only documented fields.");
    }
    if (Object.hasOwn(context, "reason") && !REVISION_REASONS.has(context.reason)) {
      return invalid("previousPlan.revisionContext.reason is not supported.");
    }
    if (Object.hasOwn(context, "note") && !isBoundedText(context.note, 1000)) {
      return invalid("previousPlan.revisionContext.note must be a non-empty string of at most 1,000 characters.");
    }
    if (Object.hasOwn(context, "blockers")) {
      if (!Array.isArray(context.blockers) || context.blockers.length > 20) {
        return invalid("previousPlan.revisionContext.blockers must be an array containing at most 20 blockers.");
      }
      const blockedTaskIds = new Set();
      for (let index = 0; index < context.blockers.length; index += 1) {
        const blocker = context.blockers[index];
        if (!isRecord(blocker) || !hasOnlyFields(blocker, BLOCKER_FIELDS)) {
          return invalid("previousPlan.revisionContext.blockers[" + index + "] must contain taskId and description only.");
        }
        if (typeof blocker.taskId !== "string" || !taskIds.has(blocker.taskId)) {
          return invalid("Each blocker must reference an unfinished task in previousPlan.tasks.");
        }
        if (blockedTaskIds.has(blocker.taskId)) {
          return invalid("A task may appear only once in previousPlan.revisionContext.blockers.");
        }
        if (!isBoundedText(blocker.description, 500)) {
          return invalid("Blocker descriptions must be non-empty strings of at most 500 characters.");
        }
        blockedTaskIds.add(blocker.taskId);
      }
    }
  }

  return null;
}

/**
 * Validates only the public request contract. Returns null on success or a
 * stable { code, message } error suitable for the API error envelope.
 */
export function validatePlanRequest(body) {
  if (!isRecord(body) || !hasOnlyFields(body, TOP_LEVEL_FIELDS)) {
    return invalid("Request must be a JSON object containing only documented fields.");
  }

  if (!isBoundedText(body.brainDump, 5000)) {
    return invalid("brainDump must be a non-empty string of at most 5,000 characters.");
  }
  if (!Number.isInteger(body.availableMinutes)
      || body.availableMinutes < 5
      || body.availableMinutes > 720) {
    return invalid("availableMinutes must be an integer between 5 and 720.");
  }

  if (Object.hasOwn(body, "previousPlan") && body.previousPlan !== null) {
    return validatePreviousPlan(body.previousPlan);
  }

  return null;
}
