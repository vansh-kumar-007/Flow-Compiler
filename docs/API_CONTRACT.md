# Flow Compiler — Plan API Contract

**Status:** Contract for Phase 2 implementation. The isolated provider adapter performs complete JSON parsing (P2-05), plan/task schema validation (P2-06), and dependency graph validation (P2-07), but it is not integrated with the route; valid requests to `POST /api/plan` still receive HTTP 501 `PLANNING_NOT_IMPLEMENTED` until later route integration.

**Product source:** the Flow Compiler Project source “Flow Compiler — build plan and starter code” (Plan.txt; the project instructions refer to it as Plan.md). This document formalizes the source plan's existing field names and limits for upcoming implementation. It does not claim that AI planning currently works.

## 1. Endpoint and compatibility decisions

- **Method/path:** `POST /api/plan`.
- **Request and response format:** JSON; requests use `Content-Type: application/json`.
- **Success status:** `200 OK` with a validated plan object.
- **No silent rename:** keep the source plan's `brainDump`, `availableMinutes`, `previousPlan`, `summary`, `totalMinutes`, `tasks`, `id`, `title`, `minutes`, `priority`, `reason`, `dependsOn`, and `category` names.
- **Revision-context name:** use `previousPlan`, as in the source starter request. New, optional revision metadata lives inside that object as `revisionContext`; no required new top-level field is introduced. The existing initial caller's `previousPlan: null` remains valid.
- **Response extension:** `deferredTasks` is an optional additive field. It explicitly represents valid work that should not be scheduled in the current time window. Existing consumers that read only `summary`, `totalMinutes`, and `tasks` can ignore it, but Flow Compiler's execution UI must display it before the feature is considered complete.
- **Error envelope:** use the actual foundation server's structured JSON convention, `{ "error": { "code": "...", "message": "..." } }`. The starter sample uses a plain string error; structured errors are kept consistent with `server/src/app.js`.
- **Revision semantics:** on recompilation, the request describes unfinished work plus IDs of work already completed. The response contains only work to schedule now (and any deferred work); the client must merge this response with unchanged completed task records instead of resetting completion state.

## 2. Request schema

The request must be a JSON object. The combined UTF-8 JSON body is capped at **20 KiB** by the existing Express JSON parser.

### Top-level fields

| Field | Required | Type / bounds | Meaning |
|---|---|---|---|
| `brainDump` | Yes | String, 1–5,000 characters before trimming; must contain a non-whitespace character | The user's raw thoughts / task input. Surrounding whitespace counts toward the 5,000-character limit. |
| `availableMinutes` | Yes | JSON integer from **5 through 720**, inclusive | Available execution time for this compilation. On a revision, it is the *remaining* time budget, not the original session duration. |
| `previousPlan` | No | `null` or object described below | Optional revision context. `null` and omission mean a new plan. |

Unknown top-level fields are rejected as `INVALID_REQUEST`. Never accept credentials as request data. In particular, an `NVIDIA_API_KEY` property is not supported and must never be forwarded to the model.

### `previousPlan` object

The source starter sends `summary`, `tasks`, and `completedTaskIds`. Preserve that shape. The fields below formalize and extend it:

| Field | Required when object present | Type / bounds | Meaning |
|---|---|---|---|
| `summary` | No | String, 1–500 characters | Previous plan's short summary. |
| `totalMinutes` | No | Integer, 1–720 | Previous plan's duration metadata, if provided. It is informational context, not the new time budget. |
| `tasks` | Yes | Array of 1–20 task objects | Unfinished tasks from the previous plan that may be revised. This matches the starter's recompile caller, which passes remaining tasks. |
| `completedTaskIds` | No | Array of 0–20 unique task IDs | IDs of tasks the user has finished. They must not be scheduled again. The combined number of IDs in `tasks` and `completedTaskIds` must not exceed 20. |
| `revisionContext` | No | Object described below | Optional reason and blocker details to help the model revise unfinished work. |

`previousPlan.tasks` uses the Task fields defined in Section 3. IDs in `completedTaskIds` must be unique and must not overlap task IDs in `previousPlan.tasks`. The tasks may retain dependencies on IDs in `completedTaskIds`; these are satisfied prerequisites. P2-07 implements cross-reference, duplicate-edge, self-dependency, cycle, and scheduled/deferred prerequisite validation for generated plans in a separate validator; P2-10 remains responsible for the later full route/provider mock matrix. Request validation must still reject malformed field types and unreasonable sizes in the revision object.

### `previousPlan.revisionContext` object

All fields are optional. Empty objects are permitted for compatibility.

| Field | Type / bounds | Meaning |
|---|---|---|
| `reason` | One of `time_changed`, `completed_early`, `blocked`, `manual` | Why the plan is being revised. |
| `note` | String, 1–1,000 characters if present | Additional non-secret context about the change. |
| `blockers` | Array of 0–20 blocker objects | Blocked unfinished tasks and concise explanations. |

Each blocker object is `{ "taskId": "t2", "description": "Waiting for access approval" }` where `taskId` is a valid task ID present in `previousPlan.tasks` and `description` is a non-empty string of at most 500 characters. A completed task cannot be marked as blocked. Blocker descriptions should include only context necessary to plan the work; users should not submit passwords, API keys, or other secrets.

### Input validation rules

- Reject a non-object request, missing/blank/non-string `brainDump`, `brainDump` longer than 5,000 characters, non-integer time, or time outside 5–720 minutes.
- Accept `previousPlan` only when omitted, `null`, or a conforming object. Validate field types and limits at every documented nested level.
- Reject malformed JSON with `INVALID_JSON` and bodies over the existing 20 KiB limit with `PAYLOAD_TOO_LARGE`.
- Do not interpolate unchecked `previousPlan` data into a prompt. Validate it first and serialize only documented fields.
- A well-formed request does not imply that AI planning is currently available. Until the provider integration is implemented, valid requests keep receiving the explicit 501 foundation response.

## 3. Plan response schema

The successful response shape is:

```json
{
  "summary": "Resolve the blocker, then finish the highest-value work.",
  "totalMinutes": 40,
  "tasks": [
    {
      "id": "t1",
      "title": "Reproduce the login bug",
      "minutes": 15,
      "priority": "high",
      "reason": "Confirm the failure before changing code.",
      "dependsOn": [],
      "category": "build"
    },
    {
      "id": "t2",
      "title": "Fix and verify login",
      "minutes": 25,
      "priority": "high",
      "reason": "Deployment depends on a working login.",
      "dependsOn": ["t1"],
      "category": "build"
    }
  ],
  "deferredTasks": [
    {
      "id": "t3",
      "title": "Complete the React Query tutorial",
      "minutes": 45,
      "priority": "low",
      "reason": "Useful but lower urgency than the deployment blocker.",
      "dependsOn": [],
      "category": "learn",
      "deferredReason": "Not enough time remains in this execution window."
    }
  ]
}
```

The example is illustrative and its values are not a promise that a request will produce these tasks.

### Plan-level fields

| Field | Type / bounds | Meaning |
|---|---|---|
| `summary` | Non-empty string, max 500 characters | Concise description of the compiled plan. |
| `totalMinutes` | Integer, 1–720 | Must equal the sum of `minutes` for `tasks` only. Deferred tasks and work already completed are not included. |
| `tasks` | Array of 1–20 task objects | Unfinished, executable work selected for the current time window. The source prompt asks for 3–8 tasks when appropriate; fewer are allowed when appropriate. |
| `deferredTasks` | Optional array of 0–20 deferred-task objects | Work intentionally not scheduled now because of time limits, dependencies, blockers, or lower priority. Omission is treated as an empty list. The combined number of nodes in `tasks` and `deferredTasks` must not exceed 20, preserving the source plan's 20-task cap. |

`totalMinutes` must not exceed `availableMinutes`. Each task duration is positive; each emitted plan must allocate the current budget realistically rather than quietly exceeding it. If meaningful work does not fit, move it to `deferredTasks` with an explicit `deferredReason`. If no executable action can be scheduled safely (for example, all work is blocked and no useful blocker-resolution action exists), the service may return `422 NO_ACTIONABLE_TASK` rather than invent an action or emit an invalid empty `tasks` array.

### Task fields

| Field | Required | Type / bounds | Rules |
|---|---|---|---|
| `id` | Yes | String, 1–64 characters; pattern `^[A-Za-z][A-Za-z0-9_-]{0,63}$` | Unique across `tasks` and `deferredTasks`. Keep IDs stable for the same continuing unfinished action on revision. |
| `title` | Yes | Non-empty string, max 160 characters | Specific, actionable step; prefer a title beginning with a verb, as the source prompt instructs. |
| `minutes` | Yes | Positive JSON integer, 1–720 | Estimated duration, not a guarantee. |
| `priority` | Yes | `high`, `normal`, or `low` | Normal is the default priority when no meaningful distinction is supported. |
| `reason` | Yes | Non-empty string, max 500 characters | Brief explanation of why the step is scheduled in this order. |
| `dependsOn` | Yes | Array of 0–20 task ID strings | IDs of prerequisite tasks; no self-dependency or duplicate edge. |
| `category` | Yes | `build`, `learn`, `admin`, or `review` | The four categories listed in the source prompt. |

Each deferred task has the same fields, plus required non-empty `deferredReason` text of at most 500 characters. A deferred task is **not** part of the current executable time window; it must not be counted in `totalMinutes` or presented as scheduled work.

### Dependency invariants

- IDs must be unique across scheduled and deferred tasks. On revision, no returned task may reuse a completed task ID.
- Every `dependsOn` ID must refer to a task in the response or an ID in `previousPlan.completedTaskIds` supplied with the request. A reference to an unknown ID is invalid.
- An ID in `previousPlan.completedTaskIds` is an already-satisfied prerequisite. The client may use its stored task record to render that edge; it is not rescheduled.
- No task may depend on itself. Duplicate edges and circular dependencies are invalid.
- The combined graph of newly scheduled and deferred tasks must be acyclic. Dependencies between newly scheduled work and deferred work must not falsely imply that the scheduled task is currently executable while its prerequisite is deferred; defer the dependent work too, or choose a valid alternative.
- The server validates these invariants before returning model-generated data to the client. Model prose must never be treated as a substitute for schema validation.

## 4. Recompilation, completed tasks, and blockers

Recompilation is a revision of remaining work, not a new unrelated workflow.

1. Keep the top-level `brainDump` as the user's original planning context, subject to the same validation/privacy rules, and update `availableMinutes` to the time actually remaining.
2. Send `previousPlan.tasks` as unfinished tasks. Send completed IDs in `previousPlan.completedTaskIds`. The source starter already uses this name and shape.
3. For a time change, set `revisionContext.reason` to `time_changed`; for an early finish, set it to `completed_early` and remove the finished task from the unfinished task list; for a blocker, set it to `blocked` and include a blocker object for each affected unfinished task. `manual` covers other user-requested revisions.
4. Do not mark a blocked task completed. The planner may schedule a concrete unblock action, choose an independent task, adjust ordering, or move blocked/dependent work to `deferredTasks`.
5. Preserve the IDs and completion state of tasks already completed. The response contains the revised unfinished schedule; the client merges it with stored completed task records and their dependency relationships. Do not clear completion state because the API returned a new plan.
6. Preserve the IDs of unchanged unfinished actions. If an action is materially decomposed or replaced, assign new unique IDs and ensure all dependency references are rewritten and validated.
7. Revalidate the combined dependency graph after every revision. Do not silently drop a still-relevant prerequisite, leave a dangling ID, introduce a cycle, or schedule work that depends on a deferred/blocked prerequisite.
8. When the time budget shrinks, schedule only work that fits and identify unselected work in `deferredTasks`. When time increases or a task finishes early, the planner may promote deferred work into `tasks` if dependencies and remaining time permit.

## 5. Error response contract

Errors use the foundation API's structured JSON envelope:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Enter a task description under 5,000 characters."
  }
}
```

Messages should be concise and actionable, with no stack traces, credentials, raw upstream bodies, or unnecessary private input. Expected error codes/statuses:

| HTTP status | Code | Meaning |
|---|---|---|
| `400` | `INVALID_JSON` | The request body is not valid JSON. Existing behavior. |
| `400` | `INVALID_REQUEST` | A field is missing, malformed, out of bounds, or unknown. |
| `413` | `PAYLOAD_TOO_LARGE` | Combined JSON body exceeds 20 KiB. Existing behavior. |
| `404` | `NOT_FOUND` | Unknown route. Existing behavior. |
| `422` | `NO_ACTIONABLE_TASK` | No truthful executable action can be scheduled safely from the supplied context. |
| `429` | `RATE_LIMIT_EXCEEDED` | The Flow Compiler API's own request quota was exceeded (P2-09). |
| `500` | `INTERNAL_ERROR` | Unexpected internal failure; do not return stack details. Existing envelope. |
| `500` | `AI_NOT_CONFIGURED` | Server-side NVIDIA key/configuration is missing. This preserves the source starter's 500 status while adopting the foundation's structured error envelope. |
| `501` | `PLANNING_NOT_IMPLEMENTED` | Current foundation behavior while AI planning remains unimplemented. |
| `502` | `AI_AUTHENTICATION_ERROR` | NVIDIA rejects the server-side API credential (HTTP 401). |
| `502` | `AI_ACCESS_DENIED` | NVIDIA denies access to the model/resource (HTTP 403). |
| `502` | `AI_RATE_LIMITED` | NVIDIA reports its upstream quota/rate limit; don't confuse it with Flow Compiler's own 429. |
| `502` | `AI_PROVIDER_UNAVAILABLE` | NVIDIA returns an HTTP 5xx response. |
| `502` | `AI_NETWORK_ERROR` | A non-timeout fetch or response-stream transport failure prevents reaching/reading NVIDIA. |
| `502` | `AI_RESPONSE_TOO_LARGE` | The declared or streamed upstream response exceeds the configured byte limit. |
| `502` | `AI_INVALID_RESPONSE` | The upstream response body/envelope is invalid UTF-8 or JSON, or message content is missing, non-string, or blank. |
| `502` | `AI_PROVIDER_ERROR` | Other non-success NVIDIA HTTP status or an otherwise unexpected provider failure. |
| `502` | `INVALID_MODEL_OUTPUT` | A valid upstream envelope contains model message content that is not an accepted complete JSON document, or later generated-output schema/dependency validation fails. |
| `504` | `AI_TIMEOUT` | NVIDIA request exceeded the bounded provider timeout. |

Do not expose the provider's raw response body or the API key in the HTTP error. Log only what is operationally needed and avoid recording the user's full brain dump by default.

### Model message content parsing

P2-05 accepts either one complete JSON document with optional surrounding whitespace, or one complete Markdown code fence whose language label is absent or exactly `json`. Horizontal whitespace around fence lines is allowed. The entire enclosed content must parse as JSON.

Surrounding prose, multiple fences, unsupported fence labels, unclosed/malformed fences, partial JSON, and extra content after the JSON/fence are rejected with `INVALID_MODEL_OUTPUT`. The parser does not extract a JSON-looking substring, repair incomplete output, or coerce unexpected types. It returns any syntactically valid JSON value (including scalars and arrays); this does not prove that the value is a valid plan. P2-06 now applies a separate generated-plan schema validator after parsing: the root and nested objects reject undocumented fields, required fields and exact types are enforced, task IDs/titles/durations/text bounds and priority/category enums are checked, and scheduled/deferred task counts plus the scheduled-duration total are verified. Schema failures use the safe `INVALID_MODEL_OUTPUT` error. Dependency reference/self-edge/duplicate-edge/cycle validation is implemented separately in `server/src/dependency-graph.js` for P2-07; P2-08 now validates scheduled-duration fit against explicitly supplied `availableMinutes` and bounded non-empty `deferredReason` values as a separate stage; it rejects over-budget generated output rather than silently moving tasks. The model chooses its scheduled/deferred subset and the server rejects invalid placement. The adapter remains unconnected to `POST /api/plan`, which intentionally remains HTTP 501 until route integration is implemented. The adapter is still not connected to `POST /api/plan`, which intentionally remains HTTP 501 until route integration is implemented.

A malformed upstream HTTP JSON/envelope, or missing/non-string/blank `choices[0].message.content`, maps to `AI_INVALID_RESPONSE`. When the upstream envelope is valid but its message content violates these JSON parsing rules, the adapter maps the error to `INVALID_MODEL_OUTPUT`.

### Provider request and response bounds

P2-04 provider calls use a finite 90,000 ms timeout, matching the 90-second timeout in the source-plan starter. The timeout covers both waiting for the HTTP response and reading its body; it aborts the request and cancels the body reader when possible. Timeout errors use `AI_TIMEOUT` and the documented 504 mapping. Other fetch or stream transport failures use `AI_NETWORK_ERROR`.

Successful upstream responses are limited to 1,048,576 bytes (1 MiB) by default. The adapter checks a valid `Content-Length` before reading and enforces the same limit incrementally while consuming the response stream; absent, malformed, or dishonest headers cannot bypass streamed enforcement. Oversized bodies are cancelled where supported and map to `AI_RESPONSE_TOO_LARGE`. Error-status response bodies are not read and are cancelled best-effort.

The server may override these values with positive decimal integer environment settings:
- `NVIDIA_TIMEOUT_MS`: default `90000`; supported range 1–120000 milliseconds.
- `NVIDIA_MAX_RESPONSE_BYTES`: default `1048576`; supported range 1–10485760 bytes.

Missing, malformed, non-integer, or out-of-range settings fall back to the documented defaults. The settings belong only in server-side environment configuration (locally `server/.env`), never in `VITE_*` variables. Provider errors use stable codes and safe messages; raw HTTP error bodies and transport exceptions are not included.

## 6. Rate limiting and cross-origin policy (P2-09)

- All `/api/*` paths use an in-memory fixed window. Defaults are 10 requests per 60 seconds per direct socket peer IP. Server-only `API_RATE_LIMIT_WINDOW_MS` (1,000–86,400,000 ms) and `API_RATE_LIMIT_MAX` (1–10,000 requests) are strict decimal integers validated at startup. Unset variables use documented defaults; explicit blanks, malformed strings, non-integers, and out-of-range values fail startup.
- Exceeding the quota returns HTTP 429 with `{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Too many API requests. Please try again later." } }`, plus `Retry-After` and `RateLimit-*` headers. Health checks and CORS preflights count toward the API quota; limiting runs before CORS handling and JSON parsing.
- Express proxy trust is disabled by default. The limiter uses the direct socket peer IP and ignores untrusted `X-Forwarded-For`. A reverse-proxy deployment needs narrowly scoped, deliberate proxy trust after proxy topology is confirmed; otherwise requests may share the proxy address.
- `APP_ORIGINS` is a comma-separated exact allowlist. When unset, only `http://localhost:5173` is allowed for local development. Entries are normalized by URL origin semantics; wildcard entries/patterns, paths, queries, fragments, credentials, invalid protocols, duplicate normalized origins, and non-HTTPS remote origins are rejected.
- Missing `Origin` headers are allowed and receive no CORS headers. An allowed origin receives explicit `GET, POST, OPTIONS` methods and `Content-Type, Accept` headers; a disallowed origin is not reflected. Credentials are not enabled. CORS is not authentication and cannot block direct non-browser requests; rate limiting operates independently.
- The limiter is dependency-free and requires no paid service. Counters reset on process restart and are not shared across multiple processes/instances, so this is a basic local-first safeguard rather than distributed abuse protection.

## 7. Credential and data boundary

- Public request data consists only of the fields defined in Section 2. The caller never sends `NVIDIA_API_KEY`.
- The backend reads `NVIDIA_API_KEY` from server-side environment configuration (for local development, `server/.env`; for deployment, the hosting provider's secret store).
- Never name it `VITE_NVIDIA_API_KEY`, include it in frontend variables, build artifacts, source maps, public logs, or client responses.
- Validate input before constructing the prompt. Bound the request body, prompt context, model token output, and request duration. Use the specified NVIDIA OpenAI-compatible Chat Completions endpoint and model ID from the source plan.
- The user should be warned that the raw thought dump and valid plan context are sent to the configured AI provider. Do not send more context than required.

## 8. Relationship to implementation tasks

- **P2-01:** define/document this contract. This document completes the design decision record for request/response field names, limits, revision semantics, deferral, dependencies, and errors.
- **P2-02:** implement request validation against Sections 2 and 5, including the existing 20 KiB JSON parser limit and deterministic validation tests.
- **P2-03:** implement the isolated server-only NVIDIA adapter.
- **P2-04:** bound provider request duration and response size, and map upstream errors to stable safe codes.
- **P2-05:** parse only a complete JSON document, optionally within one properly formed unlabeled or `json` fence; never extract from surrounding prose.
- **P2-06:** validate the generated plan/task schema and task count.
- **P2-07:** validate generated dependency references and reject cycles.
- **P2-08:** validate scheduled-duration fit against explicitly supplied `availableMinutes` and require bounded meaningful `deferredReason` values. Generated task placement is validated, not silently rearranged; dependency changes require a new model-selected plan.
- **P2-09:** implement/test API rate limiting and explicit exact-origin CORS policy.
- **P2-10:** complete the full deterministic route/provider test matrix.

This contract describes intended behavior; every behavior must be marked verified in the master checklist only after it exists and has supporting test or inspection evidence.
