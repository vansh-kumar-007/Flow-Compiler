# Flow Compiler — Project State

Last updated: 2026-10-16
Authoritative product source: the ChatGPT Project source titled “Flow Compiler — build plan and starter code” (attached as Plan.txt; the build instructions call it Plan.md).

## Repository baseline and Git history

- Repository: https://github.com/vansh-kumar-007/Flow-Compiler
- Repository metadata: public; default branch main; connected GitHub identity has admin, maintain, and push permissions.
- Initial audit proved the repository was empty: size 0, contents API reported “This repository is empty”, branches endpoint returned [], commit listing/search gave HTTP 409, and pull-request search returned none.
- The first GitHub write therefore had to create a root commit on main so a working branch could exist. Initial commit: 3ef22a5998c9f055beae00eaa5e0529dbffd53b (governance baseline only).
- Working branch: chore/phase-0-audit-and-foundation, created from that root commit before subsequent edits.
- Latest audited branch head before this reconciliation: 1cae62775e9a662f14177c2fa6a2d45d69d22bf9. Fetching both governance files from the working branch returned their contents and blob SHAs successfully.
- No previous app code, tests, CI, workflows, releases, deployments, or user work was present in the remote repository at initial audit.

## Product and architecture baseline

Flow Compiler turns unstructured thoughts into actionable, time-bounded, dependency-aware workflows. The source plan specifies a React + Vite frontend, separate Express backend, and NVIDIA Nemotron 3 Ultra via NVIDIA’s OpenAI-compatible Chat Completions API. The NVIDIA API key must remain server-side.

Planned features (not yet implemented or verified unless separately recorded):
- AI-generated actionable tasks with duration, priority, reason, category, and dependency IDs.
- A dark futuristic command-center UI and dependency graph.
- Task completion/progress tracking, next-ready action, focus mode/countdown, and recompile when time, early completion, or blockers change the plan.
- Local plan persistence, demo input/data, responsive UI, and a share/export format excluding private raw notes by default.
- Backend validation, full model-output schema validation, duplicate/unknown/self/cyclic dependency rejection, bounded payloads/output, safe error handling, timeouts, rate limiting, and server-side secrets.
- Free-first deployment only after current official limits and architecture compatibility are confirmed.

## Phase map and acceptance gates

The source plan’s Day 1 / Day 2 / Day 3 sequence is retained, split into reviewable gates:

1. **Phase 0 — Audit/governance.** Source/remote audit, risk register, stable task IDs, requirements, acceptance criteria, next-task pointer. Gate: checklist and state agree; baseline facts are supported by live GitHub evidence.
2. **Phase 1 — Runtime foundation (Day 1 foundation).** React/Vite + Express, scripts, env examples, safe ignore rules, health/API error contract, tests, CI. Gate: CI installs dependencies and passes backend tests and frontend production build; this does not imply production readiness.
3. **Phase 2 — Secure AI planning API (Day 1 compiler).** Request contract, NVIDIA adapter, timeouts/error bounds, complete schema validation, dependency DAG/cycle checks, rate limiting/CORS, deterministic mock-provider tests. Gate: positive and invalid input/model/provider/dependency tests pass; live inference is labeled unverified until a real key-backed call succeeds.
4. **Phase 3 — Core workflow UI (Day 1/2).** Thought input/time budget, demo, task/dependency display, priorities, progress, completion, empty/loading/error states. Gate: UI uses backend contract; no browser-side NVIDIA calls.
5. **Phase 4 — Recompilation/focus (Day 2).** Preserve completed work, revalidate dependencies, account for time changes/early completion/blockers, focus/countdown, next-ready selection. Gate: regression tests prove task completion and valid dependencies survive recompile.
6. **Phase 5 — Persistence/export/polish (Day 2/3).** Local persistence, animated dependency graph, responsive layout, accessibility/reduced-motion, privacy-preserving share/export. Gate: mobile/desktop checks, reload, and export privacy checks pass.
7. **Phase 6 — QA/security (Day 3).** Edge/conflict inputs, bounds, origin/rate limiting, privacy/logging, dependency/recompile regressions, final diff review. Gate: actual automated/manual outcomes and uncovered gaps are recorded.
8. **Phase 7 — Free-first deployment (Day 3).** Verify current official service terms/quotas and fit, choose compatible frontend/backend, configure server-side secrets, deploy and smoke-test, document rollback/limits. Gate: deployed behavior independently checked; no paid resources without approval.
9. **Phase 8 — Final acceptance.** Trace requirements to code/evidence, confirm CI/PR/default branch, update setup/security documentation, publish tested capabilities and limitations.

For repeatable verification, target Node.js 24 LTS in CI (official Node release schedule lists v24 as Active LTS transitioning to Maintenance on 2026-10-20) and test gates for dependency install, backend Node test runner, and Vite production build. Current official pages list Vite 8.3 as supported and React 19.3 as latest; package manifests should use compatible stable ranges and CI should expose incompatibilities rather than assume them. This runtime choice is an engineering baseline, not a claim tests have passed.

## Risk register

- **R-01 — Empty repository / no base commit:** resolved for workflow setup by creating the initial governance root commit and a feature branch. No original code existed to preserve.
- **R-02 — NVIDIA model access/quota:** NVIDIA’s official Build page advertises a free API endpoint, but account eligibility, live key validity, and remaining quota are unverified. Source: https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b
- **R-03 — Public endpoint abuse:** the backend needs request limits, strict validation, safe errors, CORS/origin controls, and a deliberate deployment/auth approach.
- **R-04 — Dependency integrity:** starter example validation is incomplete; must reject duplicates, missing IDs, self-links, and graph cycles before rendering/acting.
- **R-05 — Recompile can discard user work:** completed tasks and valid dependency relationships must be preserved deliberately.
- **R-06 — Frontend/backend deployment split:** static hosting cannot host Express; separate backend/serverless deployment and origin configuration are required.
- **R-07 — Free-tier drift:** check official service limits at deployment time; do not assume current free plans.
- **R-08 — Remote editing vs. execution:** GitHub tools can read/write source but do not execute npm locally by themselves. CI must be created and its actual result inspected. Any result not returned by an execution environment remains unverified.

## Current progress

- Phase 0 audit is established from repository metadata, contents, branches, commit listing, and PR search.
- Both governance documents are being reconciled on chore/phase-0-audit-and-foundation.
- No app code, tests, CI, or deployment had been run before the current implementation pass.
- Stable task IDs and evidence requirements live in docs/BUILD_CHECKLIST.md.
- Next implementation task after governance reconciliation: **P1-01 — Establish app directory and dependency scripts.**
- Manual action currently required: none for baseline/setup. NVIDIA key setup will be requested securely when Phase 2’s live-inference smoke test is reached; no key should be pasted into chat or committed.
