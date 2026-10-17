# Flow Compiler — Project State

Last updated: 2026-10-17 (Asia/Kolkata)
Authoritative source: the ChatGPT Project source titled “Flow Compiler — build plan and starter code” (uploaded as Plan.txt; the master instructions refer to Plan.md). The source plan is the product authority.

## Repository and Git state

- Repository: https://github.com/vansh-kumar-007/Flow-Compiler
- Default branch: `main`.
- Active working branch: `chore/phase-0-audit-and-foundation`.
- Pull request: [#1 — Phase 0 baseline and Phase 1 runtime foundation](https://github.com/vansh-kumar-007/Flow-Compiler/pull/1), currently a draft PR against `main`.
- Initial audit: repository contents, branches, commits, and PR searches indicated an empty repository. That was true at the initial audit point; a root governance commit and working branch were then created. Current remote files and history must not be mistaken for the initial empty state.
- Initial root commit: `3ef22a5998c9f055beae00eaa5e0529dbffd53b5`.
- Code/config commit with latest recorded successful full CI: `461a344e60b77cb2ea2eb8210f99d26220317c01`.
- Verified workflow: [GitHub Actions run #16](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38953685372), conclusion **success**. The verification applies to the runtime/configuration at that commit; governance-document commits can advance the branch head without changing application behavior. At the start of a new session, inspect the actual branch head and current PR/Actions state again rather than assuming this SHA is the newest commit.
- Durable requirement and task tracking lives in `docs/BUILD_CHECKLIST.md`. Preserve stable IDs and existing completion evidence.

## Product / architecture source of truth

Flow Compiler converts unstructured thoughts into actionable, time-bounded, dependency-aware work plans. The source plan specifies React + Vite frontend, a separate Express backend, and the NVIDIA Nemotron 3 Ultra model through NVIDIA's OpenAI-compatible Chat Completions API. API credentials must remain server-side.

Planned features not yet implemented unless listed in verified progress below:
- AI-generated tasks with concrete action titles, durations, priorities, reasons, categories, and dependency IDs.
- An understandable dependency graph, completion/progress tracking, ready-next-action behavior, and focused execution/countdown mode.
- Recompilation when remaining time changes, work finishes early, or blockers appear, while preserving completed tasks and valid dependency relationships.
- Local plan persistence, clear demo input/data, accessible responsive behavior, and share/export that excludes raw private notes by default.
- Complete request/model-response validation, strict task schema and dependency DAG validation, API timeouts and response limits, rate limiting, trusted-origin configuration, safe errors, and server-side secrets.
- Free-first deployment only after current official model/hosting limits and architecture constraints have been checked.

## Current implementation verified

The current working branch contains a Phase 1 foundation:
- Root npm workspace manifests with React/Vite frontend and separate Express API workspace.
- Committed npm-generated `package-lock.json` (lockfile v3); GitHub Actions uses `npm ci`.
- React foundation/status screen; its button reaches the backend health endpoint rather than pretending an AI workflow exists.
- Express API bootstrap with `/api/health`, a stable JSON 404, malformed JSON handling, 20 KB JSON body limit, and safe 400/413 responses.
- `server/.env.example` contains placeholders only; `.gitignore` excludes real environment files and `node_modules/`.
- Node.js 24 CI workflow runs install, backend tests, and frontend production build.
- README has setup and check commands matching the package scripts.

**Explicit current limitation:** `POST /api/plan` returns HTTP 501 with `PLANNING_NOT_IMPLEMENTED`. NVIDIA inference, task schema validation, dependency checking/cycle detection, rate limiting, the actual workflow UI, persistence, execution/focus mode, recompilation, sharing/export, and deployment are not implemented yet. Do not report them as existing.

## Phase map and acceptance gates

The source's Day 1 / Day 2 / Day 3 sequence remains the baseline, split into small verifiable gates.

1. **Phase 0 — Audit and governance.** Source/remote inspection, risks, stable IDs, phase plan, acceptance criteria, reconciled project state. Gate: checklist and state agree. **Status: complete.**
2. **Phase 1 — Runtime foundation (source Day 1 foundation).** React/Vite and Express workspaces, scripts/lockfile, safe environment examples, bounded JSON/error behavior, backend tests, setup docs, CI. Gate: clean `npm ci`, all backend tests, and production frontend build pass; secret boundary reviewed. **Status: complete based on source inspection and Actions run #16.** This does not imply production readiness.
3. **Phase 2 — Secure AI planning API (source Day 1 compiler).** Define request/response contract; validate inputs; implement the NVIDIA adapter; bound timeout/response handling; parse and validate all output fields; reject duplicate/missing/self/cyclic dependencies; rate limit and configure CORS; add deterministic mocked-provider tests. Gate: positive and negative input/output/provider/dependency cases pass; real inference stays unverified until a server-side key-backed call succeeds.
4. **Phase 3 — Core workflow UI (source Day 1/2).** Raw-thought input and time budget, demo, task/dependency display, priorities, completion/progress, loading/empty/error states. Gate: valid backend contract consumed without frontend secrets and key interactions checked.
5. **Phase 4 — Recompilation, timing, and focus (source Day 2).** Preserve completed tasks, validate revised dependencies, adapt to time loss/early finish/blockers, countdown/focus, next-ready action. Gate: regressions prove completed work and valid dependencies survive.
6. **Phase 5 — Persistence, export, responsiveness, and polish (source Day 2/3).** Local persistence, accurate animated dependency graph, responsive/accessibility/reduced-motion behavior, privacy-preserving share/export. Gate: mobile/desktop checks, reload, and export privacy checks pass.
7. **Phase 6 — QA and security hardening (source Day 3).** Edge/conflict inputs, bounds, provider failures, dependency/recompile invariants, rate/origin policy, privacy/logging, full-suite review. Gate: actual outcomes and gaps are documented.
8. **Phase 7 — Free-first deployment (source Day 3).** Verify current official service limits, select compatible frontend/backend hosts without creating paid resources, configure server-only secrets, deploy and smoke-test. Gate: deployed behavior independently verified, limits/cost and rollback guidance documented.
9. **Phase 8 — Final acceptance.** Trace each requirement to implementation and evidence; verify final PR/default-branch state; publish tested capabilities and remaining limitations without unsupported production-readiness claims.

## Risk register

- **R-01 — Initially empty repository:** resolved for project setup; initial audit is retained as historical context.
- **R-02 — NVIDIA access/quota:** account eligibility, key validity, and live inference quota are not verified. A real key must be configured only in the server environment when Phase 2 reaches its provider smoke test. Reference: https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b
- **R-03 — API abuse/security:** the plan endpoint is currently disabled, but API rate limiting and a deliberate auth/deployment strategy must exist before public planning is enabled.
- **R-04 — Dependency integrity:** enforce schema, unique IDs, reference validation, and acyclic dependency relationships before displaying/acting on model output.
- **R-05 — Work lost during recompilation:** completed tasks and still-valid dependencies must be preserved and covered by regression tests.
- **R-06 — Split deployment:** static hosting cannot run Express; choose and verify a separate API/serverless service and matching CORS/API-origin settings.
- **R-07 — Free-tier drift:** check official limits near deployment; do not assume free plans or account eligibility.
- **R-08 — Remote verification limits:** no local checkout/npm execution is available through the GitHub connector itself. Use real GitHub Actions runs as CI evidence, and state explicitly if any desired manual/browser behavior is not independently tested.

## Current progress and next action

- **Phase 0:** complete; tasks P0-01 through P0-07 are checked in `docs/BUILD_CHECKLIST.md`.
- **Phase 1:** complete; tasks P1-01 through P1-09 are checked with source inspection and CI evidence in the checklist.
- **Current phase:** Phase 2 — Secure AI planning API.
- **Next task:** **P2-01 — Define and document the plan request/response schema.** Acceptance: document limits and types for brain dump, available minutes, optional revision context, plan summary, task fields, priorities/categories, and dependencies; contract must be aligned to the source plan and implementation decisions must not overclaim generated/deferred work.
- **Manual action required now:** none. When real NVIDIA inference is implemented, create/configure the credential directly in the backend environment or hosting secret store; do not paste it into chat or commit it.
