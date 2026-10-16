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
- Last verified application-code/test commit: `2f96c24fd7776382039a08e72e6814391080228a`.
- Verified CI for P2-03: [GitHub Actions run #39](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38959111138), conclusion **success** on `2f96c24fd7776382039a08e72e6814391080228a`. It ran `npm ci`, all 18 backend tests (18 passed, 0 failed), and `npm run build`. The six new focused adapter tests use injected credentials/fetch responses only; no real NVIDIA request or paid inference was made.
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
- Placeholder-only server environment example, ignored real environment files, local run/test/build documentation, and Node.js 24 CI.

### Phase 2, tasks P2-01 through P2-03

- **P2-01 complete:** `docs/API_CONTRACT.md` documents public request fields/limits, source-compatible `previousPlan` revision context, completed IDs, blocker information, response and task fields, allowed priorities/categories, deferred work, dependency invariants, safe errors, and server-side credential boundaries.
- Contract retains the source names `brainDump`, `availableMinutes`, and `previousPlan`; it adds optional nested `previousPlan.revisionContext` and optional additive response `deferredTasks`. The sample JSON was parsed and the sample `totalMinutes` (40) was checked against task duration sum (15+25).
- **P2-02 complete:** `server/src/plan-request.js` validates the top-level request shape, non-blank `brainDump` up to 5,000 characters, integer `availableMinutes` from 5 to 720 inclusive, documented nested previous-plan fields, task field shapes, completed/unfinished ID overlap, prior dependency references/self-dependencies, revision reason/note limits, blocker references, and the source-plan limit of 20 combined completed/unfinished prior-task IDs.
- `server/src/app.js` returns `400 INVALID_REQUEST` for invalid request data before the plan stub. Existing JSON parser errors stay `400 INVALID_JSON` and `413 PAYLOAD_TOO_LARGE`. The source starter's initial `previousPlan: null` request is explicitly tested. Valid requests deliberately return `501 PLANNING_NOT_IMPLEMENTED` until provider integration exists.
- **P2-03 complete:** `server/src/nvidia-client.js` contains an injectable, non-streaming adapter for the source-plan endpoint and model. It reads `NVIDIA_API_KEY` from the server process environment only, sends it only as the authorization header, and returns only the model message content. Missing configuration fails with `AI_NOT_CONFIGURED`; network failures, non-success HTTP statuses, invalid JSON, and missing/blank message content become generic `AI_PROVIDER_ERROR` exceptions without upstream response bodies or transport text. `createNvidiaClient({ env, fetchImpl })` makes all tests deterministic without credentials or network access.
- `server/src/server.js` now explicitly loads `server/.env` relative to the module path, independent of the root command's working directory; hosting-provided environment variables retain precedence. `README.md` and `server/.env.example` document the setup. No key is stored in source.
- The adapter is deliberately **not connected to `POST /api/plan` yet**: valid requests still return `501 PLANNING_NOT_IMPLEMENTED` until output parsing/validation and the route path are ready. Model-output schema validation and generated dependency/cycle checks remain P2-05/P2-06/P2-07. Timeout and response-size bounds plus comprehensive upstream error mapping remain P2-04.
- Evidence: [GitHub Actions run #39](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38959111138) passed `npm ci`, all 18 backend tests (18 passed, 0 failed), and the Vite production build on adapter commit `2f96c24fd7776382039a08e72e6814391080228a`. Focused mocked adapter tests cover missing key, request endpoint/model/payload, successful response, HTTP/network failures, invalid JSON, and malformed/missing message content. This is not a real NVIDIA inference result.

## Phase map and acceptance gates

1. **Phase 0 — Audit/governance:** complete; repository/source baseline, checklist, risk register, and acceptance gates reconciled.
2. **Phase 1 — Runtime foundation:** complete per code inspection and Actions verification of clean installation, backend tests, and production build.
3. **Phase 2 — Secure AI planning API:** in progress. P2-01, P2-02, and P2-03 complete. Next: P2-04 provider timeout/response-size bounds and comprehensive safe error mapping; then P2-05 model output parsing, P2-06 task schema validation, P2-07 dependency/cycle validation, P2-08 budget/deferred-task behavior, P2-09 rate limit/CORS policy, P2-10 comprehensive deterministic provider-mock tests, P2-11 optional live inference, P2-12 final API security docs/evidence.
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
- **R-04 — Dependency integrity:** the request validator checks prior-context task shape and references, but generated-output schema validation and cycle detection are still outstanding.
- **R-05 — Recompile could lose user work:** contract defines completed ID preservation and client merge semantics; runtime/UI regression work remains in Phase 4.
- **R-06 — Split deployment:** static frontend hosting cannot run Express; verify compatible backend/serverless hosting and origin configuration before deployment.
- **R-07 — Free-tier drift:** confirm current official usage limits close to deployment and do not create paid services without approval.
- **R-08 — Remote execution boundary:** use CI run output as evidence; local browser acceptance and any manual interactions must remain explicitly unverified until performed.

## Current progress and exact next task

- **Completed:** Phase 0; Phase 1; P2-01; P2-02; P2-03.
- **Current phase:** Phase 2 — Secure AI Planning API.
- **Next task:** **P2-04 — Add provider timeout, response-size bounds, and comprehensive safe upstream-error mapping.**
- **Acceptance criteria:** implement bounded provider request/response behavior and map transport/timeout, authentication/authorization, rate-limit, server errors, malformed upstream JSON, and missing message content into the documented safe error codes without disclosing keys or raw provider details.
- **Manual action required now:** none. The adapter and tests do not require a real key. Live inference remains optional P2-11 and must only run after a valid server-side key is securely configured; no real NVIDIA request has been made.
