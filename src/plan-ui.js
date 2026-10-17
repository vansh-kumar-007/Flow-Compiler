export const MAX_BRAIN_DUMP_LENGTH = 5000;
export const MIN_AVAILABLE_MINUTES = 5;
export const MAX_AVAILABLE_MINUTES = 720;
export const TASK_LIMIT = 20;

export const DEMO_INPUT = "Finish my portfolio, fix the login bug, learn React Query, and apply for internships. The login bug blocks deployment.";

export const DEMO_PLAN = Object.freeze({
  summary: "Remove the deployment blocker first, then finish the highest-value portfolio work.",
  totalMinutes: 70,
  tasks: Object.freeze([
    Object.freeze({
      id: "demo-t1",
      title: "Reproduce the login bug",
      minutes: 15,
      priority: "high",
      reason: "Confirm the failure before changing the code.",
      dependsOn: Object.freeze([]),
      category: "build"
    }),
    Object.freeze({
      id: "demo-t2",
      title: "Fix and verify login",
      minutes: 25,
      priority: "high",
      reason: "The portfolio deployment depends on a working login.",
      dependsOn: Object.freeze(["demo-t1"]),
      category: "build"
    }),
    Object.freeze({
      id: "demo-t3",
      title: "Deploy the portfolio",
      minutes: 30,
      priority: "normal",
      reason: "Ship the portfolio after the login blocker is resolved.",
      dependsOn: Object.freeze(["demo-t2"]),
      category: "build"
    })
  ]),
  deferredTasks: Object.freeze([
    Object.freeze({
      id: "demo-d1",
      title: "Complete the React Query tutorial",
      minutes: 45,
      priority: "low",
      reason: "Useful but not the immediate blocker.",
      dependsOn: Object.freeze([]),
      category: "learn",
      deferredReason: "Keep the current window focused on the deployment dependency chain."
    }),
    Object.freeze({
      id: "demo-d2",
      title: "Apply for internships",
      minutes: 30,
      priority: "normal",
      reason: "Important work that can follow the release.",
      dependsOn: Object.freeze(["demo-t3"]),
      category: "admin",
      deferredReason: "Complete after the portfolio deployment."
    })
  ])
});

const TASK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PRIORITIES = new Set(["high", "normal", "low"]);
const CATEGORIES = new Set(["build", "learn", "admin", "review"]);

export function getInputError(value) {
  if (typeof value !== "string") {
    return "Enter the work you want to plan.";
  }
  if (!value.trim()) {
    return "Enter a task description containing at least one non-whitespace character.";
  }
  if (value.length > MAX_BRAIN_DUMP_LENGTH) {
    return "Your task description must be 5,000 characters or fewer.";
  }
  return null;
}

export function getTimeError(value) {
  if (!Number.isInteger(value) || value < MIN_AVAILABLE_MINUTES || value > MAX_AVAILABLE_MINUTES) {
    return "Available time must be a whole number from 5 to 720 minutes.";
  }
  return null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(value, fields) {
  return Object.keys(value).every(field => fields.includes(field));
}

function boundedText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validateTask(task, { deferred = false } = {}) {
  const fields = deferred
    ? ["id", "title", "minutes", "priority", "reason", "dependsOn", "category", "deferredReason"]
    : ["id", "title", "minutes", "priority", "reason", "dependsOn", "category"];
  if (!isRecord(task) || !hasOnlyFields(task, fields)) return "task must be an object with only documented fields.";
  if (typeof task.id !== "string" || !TASK_ID.test(task.id)) return "task id is invalid.";
  if (!boundedText(task.title, 160)) return "task title must contain 1–160 characters.";
  if (!Number.isInteger(task.minutes) || task.minutes < 1 || task.minutes > MAX_AVAILABLE_MINUTES) return "task minutes must be an integer from 1 to 720.";
  if (!PRIORITIES.has(task.priority)) return "task priority must be high, normal, or low.";
  if (!boundedText(task.reason, 500)) return "task reason must contain 1–500 characters.";
  if (!Array.isArray(task.dependsOn) || task.dependsOn.length > TASK_LIMIT) return "task dependencies must be an array of at most 20 IDs.";
  const seenDependencies = new Set();
  for (const id of task.dependsOn) {
    if (typeof id !== "string" || !TASK_ID.test(id)) return "task dependencies contain an invalid ID.";
    if (id === task.id) return "a task cannot depend on itself.";
    if (seenDependencies.has(id)) return "task dependencies contain duplicate IDs.";
    seenDependencies.add(id);
  }
  if (!CATEGORIES.has(task.category)) return "task category is invalid.";
  if (deferred && !boundedText(task.deferredReason, 500)) return "deferred task reason must contain 1–500 characters.";
  return null;
}

export function validatePlanResponse(payload, availableMinutes) {
  if (!isRecord(payload) || !hasOnlyFields(payload, ["summary", "totalMinutes", "tasks", "deferredTasks"])) {
    return "response must be a plan object with only documented fields.";
  }
  if (!boundedText(payload.summary, 500)) return "summary must contain 1–500 characters.";
  if (!Number.isInteger(availableMinutes) || getTimeError(availableMinutes)) return "available time is invalid.";
  if (!Number.isInteger(payload.totalMinutes) || payload.totalMinutes < 1 || payload.totalMinutes > availableMinutes) {
    return "totalMinutes must fit the available time window.";
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length < 1 || payload.tasks.length > TASK_LIMIT) {
    return "tasks must contain between 1 and 20 scheduled tasks.";
  }
  if (payload.deferredTasks !== undefined && (!Array.isArray(payload.deferredTasks) || payload.deferredTasks.length > TASK_LIMIT)) {
    return "deferredTasks must be an array of at most 20 tasks.";
  }
  const deferred = payload.deferredTasks ?? [];
  if (payload.tasks.length + deferred.length > TASK_LIMIT) return "scheduled and deferred tasks cannot exceed 20 combined.";
  const scheduledIds = new Set();
  const allIds = new Set();
  for (const task of payload.tasks) {
    const error = validateTask(task);
    if (error) return error;
    if (allIds.has(task.id)) return "task IDs must be unique.";
    allIds.add(task.id);
    scheduledIds.add(task.id);
  }
  for (const task of deferred) {
    const error = validateTask(task, { deferred: true });
    if (error) return error;
    if (allIds.has(task.id)) return "task IDs must be unique across scheduled and deferred tasks.";
    allIds.add(task.id);
  }
  if (payload.totalMinutes !== payload.tasks.reduce((sum, task) => sum + task.minutes, 0)) {
    return "totalMinutes must equal the sum of scheduled task minutes.";
  }
  for (const task of [...payload.tasks, ...deferred]) {
    for (const dependencyId of task.dependsOn) {
      if (!allIds.has(dependencyId)) return "task references an unknown dependency ID.";
    }
  }
  // This task renders a plan list, not the dependency graph. Verify references but
  // leave edge drawing/readiness visualization to P3-06.
  return null;
}
