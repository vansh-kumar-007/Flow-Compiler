const TASK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_GENERATED_NODES = 20;
const MAX_DEPENDENCIES = 20;
const MAX_COMPLETED_IDS = 20;

const INVALID = Object.freeze({
  code: "INVALID_MODEL_OUTPUT",
  message: "The model returned an invalid plan."
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTaskId(value) {
  return typeof value === "string" && TASK_ID.test(value);
}

function invalid(path) {
  // Paths contain only validator-authored labels and numeric indexes.
  return { ...INVALID, path };
}

/**
 * Validate generated dependency references and graph invariants independently
 * of JSON parsing (P2-05) and task-schema validation (P2-06).
 *
 * `completedTaskIds` must be explicitly supplied from validated
 * previousPlan.completedTaskIds context. Completed tasks are satisfied
 * prerequisite IDs, not generated graph nodes.
 *
 * The response graph is bounded to 20 generated nodes, so deterministic Kahn
 * topological sorting runs in O(V + E) time without recursive stack growth.
 */
export function validateGeneratedDependencies(plan, options = {}) {
  try {
    if (!isRecord(plan)) return invalid("$");
    if (!Array.isArray(plan.tasks)) return invalid("tasks");

    const deferredTasks = Object.hasOwn(plan, "deferredTasks")
      ? plan.deferredTasks
      : [];
    if (!Array.isArray(deferredTasks)) return invalid("deferredTasks");
    if (plan.tasks.length + deferredTasks.length > MAX_GENERATED_NODES) {
      return invalid("$");
    }

    if (!isRecord(options)) return invalid("completedTaskIds");
    const completedTaskIds = options.completedTaskIds === undefined
      ? []
      : options.completedTaskIds;
    if (!Array.isArray(completedTaskIds) || completedTaskIds.length > MAX_COMPLETED_IDS) {
      return invalid("completedTaskIds");
    }

    const completedIds = new Set();
    for (let index = 0; index < completedTaskIds.length; index += 1) {
      const id = completedTaskIds[index];
      if (!isTaskId(id) || completedIds.has(id)) {
        return invalid("completedTaskIds[" + index + "]");
      }
      completedIds.add(id);
    }

    const scheduledIds = new Set();
    const deferredIds = new Set();
    const generatedIds = new Set();
    const nodes = [];

    function collect(collection, label, destinationIds) {
      for (let index = 0; index < collection.length; index += 1) {
        const task = collection[index];
        const path = label + "[" + index + "]";
        if (!isRecord(task)) return invalid(path);
        if (!isTaskId(task.id)) return invalid(path + ".id");
        if (generatedIds.has(task.id)) return invalid(path + ".id");
        if (completedIds.has(task.id)) return invalid(path + ".id");
        if (!Array.isArray(task.dependsOn) || task.dependsOn.length > MAX_DEPENDENCIES) {
          return invalid(path + ".dependsOn");
        }

        const uniqueDependencies = new Set();
        for (let edgeIndex = 0; edgeIndex < task.dependsOn.length; edgeIndex += 1) {
          const dependencyId = task.dependsOn[edgeIndex];
          const edgePath = path + ".dependsOn[" + edgeIndex + "]";
          if (!isTaskId(dependencyId)) return invalid(edgePath);
          if (dependencyId === task.id) return invalid(edgePath);
          if (uniqueDependencies.has(dependencyId)) return invalid(edgePath);
          uniqueDependencies.add(dependencyId);
        }

        generatedIds.add(task.id);
        destinationIds.add(task.id);
        nodes.push({
          id: task.id,
          dependsOn: task.dependsOn,
          deferred: label === "deferredTasks",
          path
        });
      }
      return null;
    }

    const scheduledError = collect(plan.tasks, "tasks", scheduledIds);
    if (scheduledError) return scheduledError;
    const deferredError = collect(deferredTasks, "deferredTasks", deferredIds);
    if (deferredError) return deferredError;

    const knownIds = new Set([...generatedIds, ...completedIds]);
    for (const node of nodes) {
      for (let index = 0; index < node.dependsOn.length; index += 1) {
        const dependencyId = node.dependsOn[index];
        const edgePath = node.path + ".dependsOn[" + index + "]";
        if (!knownIds.has(dependencyId)) return invalid(edgePath);

        // A task scheduled for this time window cannot be executable while one
        // of its prerequisites is explicitly deferred to later.
        if (!node.deferred && deferredIds.has(dependencyId)) {
          return invalid(edgePath);
        }
      }
    }

    // Kahn's algorithm over all scheduled and deferred nodes. Edges point from
    // each prerequisite to its dependent task; completed IDs are satisfied
    // terminal references and therefore do not participate in cycle detection.
    const indegree = new Map(nodes.map(node => [node.id, 0]));
    const dependents = new Map(nodes.map(node => [node.id, []]));
    for (const node of nodes) {
      for (const dependencyId of node.dependsOn) {
        if (completedIds.has(dependencyId)) continue;
        indegree.set(node.id, indegree.get(node.id) + 1);
        dependents.get(dependencyId).push(node.id);
      }
    }

    const queue = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
    let cursor = 0;
    while (cursor < queue.length) {
      const prerequisiteId = queue[cursor++];
      for (const dependentId of dependents.get(prerequisiteId)) {
        const nextIndegree = indegree.get(dependentId) - 1;
        indegree.set(dependentId, nextIndegree);
        if (nextIndegree === 0) queue.push(dependentId);
      }
    }

    if (cursor !== nodes.length) return invalid("$");
    return null;
  } catch {
    // Malformed structures must return a stable safe error, never leak an
    // exception, model content, or unexpected property access details.
    return invalid("$");
  }
}
