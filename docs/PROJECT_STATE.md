# Flow Compiler — Project State

Last updated: 2026-10-17 (Asia/Kolkata)
Authoritative product source: the ChatGPT Project source “Flow Compiler — build plan and starter code” (uploaded as Plan.txt; the master instructions refer to Plan.md). The source plan remains authoritative.

## Repository and Git state

- Repository: https://github.com/vansh-kumar-007/Flow-Compiler
- Default branch: `main`.
- Current Phase 2 working branch: `feat/phase-2-api-contract-validation`.
- Foundation branch: `chore/phase-0-audit-and-foundation`.
- **PR #1**: [Phase 0 baseline and Phase 1 runtime foundation](https://github.com/vansh-kumar-007/Flow-Compiler/pull/1), open draft PR to `main`; intentionally not merged.
- **PR #2**: [Phase 2: define API contract and validate plan requests](https://github.com/vansh-kumar-007/Flow-Compiler/pull/2), open draft PR stacked on `chore/phase-0-audit-and-foundation` while PR #1 remains unmerged; intentionally not merged.
- Historical repository initialization: the initial remote audit found no files/commits; a governance root commit was then created. Do not mistake that initial state for the current repository.
- Last verified application-code/test commit: `b2c702b0b2246a015444b3196a97045291a4b09a`.
- Verified CI for P2-06: [GitHub Actions run #53](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/39021806130), conclusion **success** on application/test commit `b2c702b0b2246a015444b3196a97045291a4b09a`. It ran clean `npm ci`, all 173 backend tests (173 passed, 0 failed), and `npm run build`. Parser/schema/provider tests use deterministic local fixtures and mocks only; no real NVIDIA call or paid inference was made. Run #52 exposed one incorrectly specified negative test for contract-permitted `deferredTasks: []`; that fixture was corrected before the passing run #53.
- Stable requirement IDs and status evidence live in `docs/BUILD_CHECKLIST.md`.

## Product architecture and source requirements

Flow Compiler turns unstructured thoughts into actionable, time-bounded, dependency-aware workflows. The source specifies React + Vite frontend, separate Express backend, and NVIDIA Nemotron 3 Ultra via NVIDIA's OpenAI-compatible Chat Completions endpoint. NVIDIA credentials remain server-side.

Planned capability set still includes AI-generated tasks (duration, priority, reason, category, dependency IDs), a dependency graph, task completion/progress, next-ready action, focus/countdown, recompilation when time changes/early finish/blockers occur, local persistence, demo data, responsive/accessibility support, privacy-preserving export, request/model validation, cycle rejection, provider timeouts/error mapping, rate limits/origin controls, and free-first deployment. Those capabilities must not be reported complete until their phase acceptance criteria and verification evidence are satisfied.

## Current implementation verified

### Phase 1 foundation

- React/Vite frontend and separate Express API workspace.
- Committed npm-generated lockfile; CI runs clean `npm ci`.
- Foundation screen tests the real backend health endpoint.
- `/api/health`, bounded 20 KiB JSON parser, stable JSON errors for malformed JSON, oversized bodies, and unknown routes.
- Server environment example defaults `NVIDIA_API_KEY` to blank, real `.env` files are ignored, local run/test/build commands are documented, and Node.js 24 CI is configured.

### Phase 2, tasks P2-01 through P2-06

- **P2-01 complete:** `docs/API_CONTRACT.md` documents public request fields/limits, source-compatible `previousPlan` revision context, completed IDs, blocker information, response and task fields, allowed priorities/categories, deferred work, dependency invariants, safe errors, and server-side credential boundaries.
- Contract retains the source names `brainDump`, `availableMinutes`, and `previousPlan`; it adds optional nested `previousPlan.revisionContext` and optional additive response `deferredTasks`. The sample JSON was parsed and the sample `totalMinutes` (40) was checked against task duration sum (15+25).
- **P2-02 complete:** `server/src/plan-request.js` validates the top-level request shape, non-blank `brainDump` up to 5,000 characters, integer `availableMinutes` from 5 to 720 inclusive, documented nested previous-plan fields, task field shapes, completed/unfinished ID overlap, prior dependency references/self-dependencies, revision reason/note limits, blocker references, and the source-plan limit of 20 combined completed/unfinished prior-task IDs.
- `server/src/app.js` returns `400 INVALID_REQUEST` for invalid request data before the plan stub. Existing JSON parser errors stay `400 INVALID_JSON` and `413 PAYLOAD_TOO_LARGE`. The source starter's initial `previousPlan: null` request is explicitly tested. Valid requests deliberately return `501 PLANNING_NOT_IMPLEMENTED` until provider integration exists.
- **P2-03 complete:** `server/src/nvidia-client.js` contains an injectable non-streaming adapter for the source-plan endpoint and model. It reads `NVIDIA_API_KEY` from the server process environment only and sends it only as the authorization header. The isolated adapter returns the message content plus parsed output only after P2-05 syntax parsing and P2-06 plan-schema validation succeed. Configuration/fetch injection keeps tests deterministic; no real key or live call is used.
- `server/src/server.js` now explicitly loads `server/.env` relative to the module path, independent of the root command's working directory; hosting-provided environment variables retain precedence. `README.md` and `server/.env.example` document the setup. No key is stored in source.
- **P2-04 complete:** `server/src/nvidia-client.js` enforces a finite provider timeout (90,000 ms default, matching the source-plan starter), aborts the provider request and cancels the active response reader on timeout, and applies a 1,048,576-byte (1 MiB) default response-body cap. It rejects a valid oversized `Content-Length` before reading and counts streamed bytes regardless of whether the header is absent, malformed, or dishonest. It cancels over-limit streams where supported and never buffers beyond the configured response cap.
- Provider error mapping now uses safe stable codes for timeout, network/stream failure, HTTP 401, HTTP 403, HTTP 429, HTTP 5xx, other non-success status, oversized response, and invalid upstream UTF-8/JSON/content. The API contract documents these codes and defaults. Server environment settings `NVIDIA_TIMEOUT_MS` (1–120,000 ms) and `NVIDIA_MAX_RESPONSE_BYTES` (1–10,485,760 bytes) allow bounded overrides; absent/invalid values fall back to defaults.
- The adapter remains **not connected to `POST /api/plan`**: valid requests still return `501 PLANNING_NOT_IMPLEMENTED` until later route integration. Model-output syntax parsing (P2-05) and plan/task schema validation (P2-06) run inside the isolated adapter; dependency/edge/cycle validation remains P2-07, and time-budget scheduling remains P2-08.
- Evidence: [GitHub Actions run #44](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38961083734) passed `npm ci`, all 29 backend tests (29 passed, 0 failed), and the Vite production build on commit `c4612452bf2c6c98701316fb66afb6318c2a5838`. Deterministic tests include the same coverage plus verification that `NVIDIA_TIMEOUT_MS` is actually read from server environment configuration. No real NVIDIA request was made.
- **P2-05 complete:** `server/src/model-output.js` parses complete JSON only, accepting plain JSON with surrounding whitespace or one complete Markdown fence labeled `json` or unlabeled. It never extracts arbitrary substrings or repairs malformed JSON. The adapter distinguishes upstream envelope/content-field failures (`AI_INVALID_RESPONSE`) from invalid model content (`INVALID_MODEL_OUTPUT`). Parser syntax acceptance includes scalars and arrays; the separate P2-06 schema validator rejects non-plan values before adapter output is returned.
- Evidence: [GitHub Actions run #49](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/39020228586) passed clean install, 61/61 backend tests (0 failed), and the Vite production build on `f434794f7a26ae95a8030d03f132afc3efca36db`. Tests cover the full parser matrix plus a valid upstream envelope with invalid model content. No real NVIDIA request was made.

- **P2-06 complete:** added `server/src/plan-output.js` as a validator separate from the P2-05 syntax parser. It requires the exact plan object; validates required plan/task/deferred-task fields, types, allowed priority/category enums, task-ID pattern and uniqueness, 1–20 scheduled tasks, optional 0–20 deferred tasks, the 20-node combined cap, text bounds, positive integer durations, and `totalMinutes` equality with scheduled durations only. Unknown fields are rejected. The adapter applies schema validation after parsing and uses safe `INVALID_MODEL_OUTPUT` errors. Dependency/edge/cycle checks (P2-07) and available-time scheduling (P2-08) remain separate.
- P2-06 evidence: [GitHub Actions run #53](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/39021806130) passed clean `npm ci`, 173/173 backend tests, and Vite production build on application/test commit `b2c702b0b2246a015444b3196a97045291a4b09a`. Tests use deterministic fixtures and mocked provider responses; no live inference was performed. No lint/type-check scripts are configured.

## Phase map and acceptance gates

1. **Phase 0 — Audit/governance:** complete; repository/source baseline, checklist, risk register, and acceptance gates reconciled.
2. **Phase 1 — Runtime foundation:** complete per code inspection and Actions verification of clean installation, backend tests, and production build.
3. **Phase 2 — Secure AI planning API:** in progress. P2-01 through P2-06 complete. Next: P2-07 dependency references/edges/cycles; P2-08 budget and deferred scheduling; P2-09 rate limiting/CORS; P2-10 comprehensive route/provider mock tests; P2-11 optional live inference; P2-12 final API security documentation/evidence.
4. **Phase 3 — Core workflow UI:** raw thoughts, time selector, demo, tasks/dependency view, completion/progress and error states.
5. **Phase 4 — Recompilation/focus:** preserve completed work and valid dependencies; support time changes, early completion, blockers, focus and countdown.
6. **Phase 5 — Persistence/export/polish:** local persistence, animated dependency graph, responsive/accessibility/reduced-motion behavior, privacy-preserving export.
7. **Phase 6 — QA/security:** edge-case coverage, limits, dependency invariants, error/logging/privacy review.
8. **Phase 7 — Free-first deployment:** verify current official service limits, select compatible hosting, configure server-side secrets, deploy and smoke-test without paid resources unless approved.
9. **Phase 8 — Final acceptance:** trace requirements to code/test/manual evidence, verify final PR/default-branch state, report tested capability and gaps.

## Risk register

- **R-01 — Initially empty repository:** resolved for setup; kept as historical audit context.
- **R-02 — NVIDIA key/access/quota:** no real key is configured or verified. The isolated adapter is tested with fake injected credentials; optional real inference remains P2-11. Configure a key only in the backend environment/host secret manager if that optional check is approved; never paste it into chat or commit it.
- **R-03 — API abuse:** request validation and an isolated provider adapter exist, but `/api/plan` remains disabled and no real planning API is exposed. Add rate limiting and explicit deployment/auth assumptions before connecting provider calls or exposing planning publicly.
- **R-04 — Dependency integrity:** strict model JSON parsing (P2-05) and generated plan/task schema validation (P2-06) are implemented and tested. Dependency reference/edge/cycle checks (P2-07) and scheduling invariants (P2-08) remain outstanding.
- **R-05 — Recompile could lose user work:** contract defines completed ID preservation and client merge semantics; runtime/UI regression work remains in Phase 4.
- **R-06 — Split deployment:** static frontend hosting cannot run Express; verify compatible backend/serverless hosting and origin configuration before deployment.
- **R-07 — Free-tier drift:** confirm current official usage limits close to deployment and do not create paid services without approval.
- **R-08 — Remote execution boundary:** use CI run output as evidence; local browser acceptance and any manual interactions must remain explicitly unverified until performed.

## Current progress and exact next task

- **Completed:** Phase 0; Phase 1; P2-01; P2-02; P2-03; P2-04; P2-05; P2-06.
- **Current phase:** Phase 2 — Secure AI Planning API.
- **Next task:** **P2-07 — Validate generated dependency references and reject invalid dependency graphs/cycles.**
- **Acceptance criteria:** validate each generated `dependsOn` entry against the scheduled/deferred graph and completed IDs supplied in request context; reject malformed/dangling references, self-dependencies, disallowed duplicate edges, duplicate IDs across relevant collections, and circular dependencies with safe stable errors. Keep scheduling (P2-08), route/provider matrix (P2-10), live inference (P2-11), final security docs (P2-12), and Phases 3–8 separate.
- **Manual action required now:** none. Adapter/parser tests remain fully mocked; optional real inference is P2-11 and has not been performed.
