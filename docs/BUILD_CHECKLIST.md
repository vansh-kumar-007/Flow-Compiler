# Flow Compiler — Master Build Checklist

This file is the durable, task-level source of truth for implementation progress. Preserve stable task IDs across chats; update existing rows rather than resetting progress.

**Product source:** ChatGPT Project source “Flow Compiler — build plan and starter code” (Plan.txt, 1,072 extracted lines). The project instructions refer to it as Plan.md, but the attached source is currently surfaced as Plan.txt.
**Repository:** https://github.com/vansh-kumar-007/Flow-Compiler
**Status convention:** [ ] not started · [x] completed and verified · [!] blocked/awaiting a decision · [-] intentionally deferred/excluded with reason.
**Evidence convention:** a status of [x] must name the supporting check, test, inspection, or external result. Code being written is not proof that it works.

## Phase 0 — Repository audit and execution planning

**Acceptance criteria:** the actual remote state and source plan are inspected; this checklist and docs/PROJECT_STATE.md exist and agree on phases, risks, and next task; the implementation baseline does not pretend an empty repository contains code; the next task is unambiguous.

- [x] **P0-01 — Inspect repository metadata and permissions.** Acceptance: record repo visibility, default branch, and available write permission. Evidence: GitHub repository metadata reported public vansh-kumar-007/Flow-Compiler, default branch main, and admin/maintain/push permissions for the connected identity.
- [x] **P0-02 — Inspect repository contents, branches, commits, and pull requests.** Acceptance: no code/history/work is assumed without evidence. Evidence: initial remote audit found the repository empty; a governance root commit was created, then the working branch and PR #1 were established. Current branch contents were subsequently fetched and inspected directly; the earlier empty-repository result is historical, not current state.
- [x] **P0-03 — Read the complete supplied build plan.** Acceptance: major objectives, architecture, feature sequence, starter limitations, security notes, and deployment constraints are captured. Evidence: the full source was available through the Project source extract (lines 1–1072).
- [x] **P0-04 — Record project baseline and risk register.** Acceptance: docs/PROJECT_STATE.md records facts, assumptions, risks, phase map, and current progress. Evidence: file committed in initial repository root commit 3ef22a5998c9f055beae00eaa5e0529dbffd53b5; this commit was necessary to initialize the otherwise-empty repository.
- [x] **P0-05 — Create granular master checklist.** Acceptance: every phase has individually trackable implementation, test, security, documentation, and deployment tasks. Evidence: this file is created on branch chore/phase-0-audit-and-foundation.
- [x] **P0-06 — Reconcile governance files and next-task pointer.** Acceptance: PROJECT_STATE.md and this checklist agree on current branch, task status, verification evidence, and single next task. Evidence: both files were fetched from the working branch and updated after source/code/CI inspection.
- [x] **P0-07 — Define foundation verification path.** Acceptance: CI installs dependencies, runs backend automated tests, and builds the frontend on Node.js 24; workflow triggers and results are checked in GitHub. Evidence: GitHub Actions run #16 / run ID 38953685372 completed successfully on commit 461a344e60b77cb2ea2eb8210f99d26220317c01, including `npm ci`, backend tests, and `npm run build`.

## Phase 1 — Repository and runtime foundation (source-plan Day 1)

**Acceptance criteria:** a reproducible React/Vite frontend and Express backend skeleton exists, secrets are excluded, scripts and environment examples are documented, and executable checks prove the backend contract and frontend build. A green build alone is not production readiness.

- [x] **P1-01 — Establish app directory and dependency scripts.** Acceptance: root/workspace manifests define dev, API dev, test, and build entry points and a committed npm lockfile enables clean installs. Evidence: `package.json`, `server/package.json`, `package-lock.json` (lockfile v3, 115 package entries), and successful clean `npm ci` in GitHub Actions run #16.
- [x] **P1-02 — Bootstrap React + Vite application.** Acceptance: React/Vite entry points render a usable foundation screen and production build passes in CI. Evidence: inspected `src/App.jsx`, `src/main.jsx`, `src/styles.css`, `index.html`, and `vite.config.js`; `npm run build` passed in Actions run #16.
- [x] **P1-03 — Bootstrap separate Express backend.** Acceptance: separate Express server starts on configured PORT or safe local default; browser code contains no server-only credential. Evidence: inspected `server/src/server.js`, `server/src/app.js`, root/workspace manifests, and frontend sources; backend bootstrap test passed in Actions run #16.
- [x] **P1-04 — Add health endpoint and bounded JSON parsing.** Acceptance: health route returns stable status; oversized/malformed JSON receives safe 4xx responses. Evidence: 7 backend tests passed in Actions run #16, including health, malformed JSON (400), oversized JSON (413), unknown route (404), CORS, plan boundary, and server bootstrap.
- [x] **P1-05 — Add .gitignore and safe environment example.** Acceptance: real `.env` files and `node_modules/` are ignored; examples contain placeholders; no credential is exposed to the frontend. Evidence: inspected `.gitignore`, `.env.example`, `server/.env.example`, and 17 runtime/config/documentation files; targeted scan found no recognizable API/private-key token pattern and no `NVIDIA_API_KEY` in frontend/config files. This is static inspection, not a guarantee from a dedicated secret-scanning service.
- [x] **P1-06 — Add backend automated smoke tests.** Acceptance: health, invalid request/body, route, CORS, and server startup contracts run automatically. Evidence: all 7 Node test-runner tests passed in Actions run #16 (0 failed).
- [x] **P1-07 — Add frontend/backend local development guidance.** Acceptance: documented install/run/test commands match project scripts. Evidence: inspected README.md against `package.json` and `server/package.json`; commands map to existing scripts.
- [x] **P1-08 — Add CI workflow and inspect its actual run.** Acceptance: clean install, backend tests, and production build pass on supported Node LTS. Evidence: [GitHub Actions run #16](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38953685372) completed successfully on commit `461a344e60b77cb2ea2eb8210f99d26220317c01`; job steps show `npm ci`, `npm test`, and `npm run build` all succeeded.
- [x] **P1-09 — Review source/diff and secret boundary.** Acceptance: review changed files and workflow; no frontend API key, real `.env` credential, or unrelated generated artifact is committed. Evidence: inspected 17 runtime/config/docs paths and the PR changed-file list; environment file is placeholder-only, ignore rules exclude real secrets, and targeted secret-pattern scan returned zero hits. Lockfile was generated by npm in CI, not hand-invented.

## Phase 2 — Secure AI planning API (source-plan Day 1 compiler)

**Acceptance criteria:** validated input and output contracts surround the NVIDIA adapter; failures are bounded and safely reported; task dependencies are valid and acyclic. Provider-dependent behavior is explicitly marked unverified until tested with configured credentials.

- [x] **P2-01 — Define and document the plan request/response schema.** Acceptance: document request limits, prior-plan/revision context, response/task fields, priority/category enums, dependency invariants, deferral behavior, safe error mappings, and secret boundary. Evidence: `docs/API_CONTRACT.md` created and reviewed against the source plan and existing Express error contract; automated document audit verified all required fields/topics and parsed both JSON examples; the response example's `totalMinutes` matched the scheduled task sum (40 minutes).
- [x] **P2-02 — Validate request fields and payload size.** Acceptance: reject malformed request shape, blank/non-string/over-5,000-character brain dumps, invalid 5–720 minute values, malformed nested revision context, unknown/dangling IDs, unsupported fields, invalid JSON, and JSON bodies over 20 KiB with stable safe errors. Evidence: `server/src/plan-request.js` is applied before the plan handler; 12/12 backend tests passed on [GitHub Actions run #26](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38956658655) at implementation commit `98a0a5f421368870c00a04ef3979c7bc3a1603c0`; `npm ci` and the Vite production build also passed. Generated model-output schema/cycle validation remains P2-05/P2-07 scope.
- [ ] **P2-03 — Implement NVIDIA Nemotron adapter using server-side configuration.** Acceptance: use the specified OpenAI-compatible NVIDIA endpoint and model ID; read NVIDIA_API_KEY from server environment only; avoid streaming unless deliberately handled.
- [ ] **P2-04 — Add timeout, response-size bounds, and safe provider errors.** Acceptance: handle network error, timeout, 401/403, 429, 5xx, invalid JSON, and missing choices/content; clients receive non-sensitive messages.
- [ ] **P2-05 — Parse model output robustly.** Acceptance: support JSON-only and an optional JSON fence without permissive extraction of unrelated prose; malformed/partial output is rejected safely.
- [ ] **P2-06 — Validate every task field and limit task count.** Acceptance: enforce non-empty unique IDs/titles, positive integer minutes, allowed priorities/categories, bounded reason/summary text, and correct field types.
- [ ] **P2-07 — Validate dependency IDs and reject cycles.** Acceptance: test unknown IDs, duplicate IDs, self-links, duplicate edges if disallowed, and multi-node circular dependencies.
- [ ] **P2-08 — Enforce scheduling/time-budget behavior.** Acceptance: verify duration totals and explicitly represent work to defer when planned work exceeds the user's available time; never claim estimates are certain.
- [ ] **P2-09 — Add rate limiting and CORS/origin configuration.** Acceptance: conservative configurable limits, production-configurable trusted origins, no wildcard credentials, and tests for rejection/limit behavior.
- [ ] **P2-10 — Add deterministic tests with mocked provider responses.** Acceptance: success, missing key, provider errors, timeout, malformed responses, schema rejection, unknown dependency, and cycle cases run without paid calls.
- [ ] **P2-11 — Run an optional real NVIDIA inference smoke test.** Acceptance: only after the user configures a valid server-side key; record result and limits without revealing key. Until done, label external inference unverified.
- [ ] **P2-12 — Update API security docs and checklist evidence.** Acceptance: documented limits, secret setup, trial/usage caveats, and threat boundaries match code.

## Phase 3 — Core workflow UI (source-plan Day 1 / Day 2)

**Acceptance criteria:** the user can submit raw thoughts and a time budget; visible plans are backend-validated and show actions, durations, priorities, reasons, and dependencies; loading/empty/error states work.

- [ ] **P3-01 — Implement dark command-center frame.** Acceptance: coherent visual identity follows source plan (dark futuristic UI, readable contrast, mobile-ready layout).
- [ ] **P3-02 — Implement thought input and available-time controls.** Acceptance: text limits/labels, accessible controls, and validation feedback.
- [ ] **P3-03 — Add demo input and demo plan mode/data.** Acceptance: first-time user can explore without NVIDIA credentials; demo is clearly labelled and never presented as real model output.
- [ ] **P3-04 — Connect UI to backend plan API.** Acceptance: configured API origin, safe JSON/error handling, pending state, request failure feedback, and no browser-side NVIDIA calls.
- [ ] **P3-05 — Render plan summary and task nodes.** Acceptance: each task shows index/title/duration/priority/reason/category as appropriate; dependencies reference readable task titles as well as IDs.
- [ ] **P3-06 — Display dependency links or an explicit graph view.** Acceptance: dependency edges are accurate and distinguish prerequisite direction; graph remains understandable on small screens and with long task titles.
- [ ] **P3-07 — Add completion tracking and progress calculation.** Acceptance: completed count/progress and remaining time update correctly; dependency readiness is represented accurately.
- [ ] **P3-08 — Add empty, loading, API error, and invalid-plan states.** Acceptance: no crashes or stale misleading success state on errors.
- [ ] **P3-09 — Accessibility and interaction review.** Acceptance: keyboard-operable controls, visible focus, semantic headings/labels, sensible contrast, and reduced-motion support.

## Phase 4 — Recompilation, timing, and focus (source-plan Day 2)

**Acceptance criteria:** timing changes, early completion, and blockers can recompile remaining work without erasing completed tasks or silently invalidating dependencies.

- [ ] **P4-01 — Define a stable plan/task identity and recompile contract.** Acceptance: revisions explicitly include completed IDs/status and existing task/dependency context.
- [ ] **P4-02 — Preserve completed tasks during recompile.** Acceptance: completed tasks stay completed and are not rescheduled as pending; regression tests prove it.
- [ ] **P4-03 — Revalidate IDs and dependency relationships after recompile.** Acceptance: reject invalid cycles/missing dependencies and never silently remove necessary prerequisite relationships.
- [ ] **P4-04 — Support time-loss/remaining-time changes.** Acceptance: recalculation schedules feasible work and identifies deferred work when time is insufficient.
- [ ] **P4-05 — Support early finish and blocker reporting.** Acceptance: mark early completion/blocker explicitly and regenerate only the remaining affected plan.
- [ ] **P4-06 — Implement countdown/focus mode.** Acceptance: clear focused task, start/pause/reset behavior, accessible timer updates, and no loss of plan on timer state change.
- [ ] **P4-07 — Implement next-ready action selection.** Acceptance: select the highest-priority actionable task whose prerequisites are completed; blocked tasks are not incorrectly offered as ready.
- [ ] **P4-08 — Add recompile regression tests and UI verification.** Acceptance: completed-task preservation, changed duration, early finish, blockers, and invalid revised plans are tested.

## Phase 5 — Persistence, export, responsiveness, and polish (source-plan Day 2 / Day 3)

**Acceptance criteria:** plan state survives reload locally, the interface works on mobile and desktop, and sharing does not leak private raw input by default.

- [ ] **P5-01 — Persist active plan and completion state locally.** Acceptance: plan/state reload coherently; corrupt/stale saved data is safely ignored/recovered; avoid storing secrets.
- [ ] **P5-02 — Add animated dependency links/nodes.** Acceptance: task links reflect real dependencies and respect reduced-motion settings.
- [ ] **P5-03 — Finalize focus-mode visual states and responsive layout.** Acceptance: test at narrow mobile, tablet, and desktop breakpoints; no horizontal overflow or inaccessible controls.
- [ ] **P5-04 — Add privacy-preserving export/share representation.** Acceptance: export includes task content/dependency structure as intended, excludes raw thought dump/private notes by default, and handles export failure.
- [ ] **P5-05 — Add keyboard, screen-reader, and reduced-motion checks.** Acceptance: interactive flow works without pointer; meaningful labels and status announcements are present.
- [ ] **P5-06 — Add UI smoke/regression tests.** Acceptance: key input, demo, plan display, completion, reload, recompilation, and export paths receive automated or explicitly recorded manual checks.
- [ ] **P5-07 — Update feature and privacy documentation.** Acceptance: docs distinguish implemented features from demo-only/unsupported behaviors.

## Phase 6 — QA and security hardening (source-plan Day 3)

**Acceptance criteria:** failures and adversarial/edge inputs are handled deliberately, tests are reproducible, and all remaining coverage gaps are explicit.

- [ ] **P6-01 — Test vague, large, and conflicting inputs.** Acceptance: practical output or graceful clarification/deferred tasks; no crashes or fabricated completed work.
- [ ] **P6-02 — Test request/response bounds and malformed bodies.** Acceptance: limits enforced at route/parser/provider-output boundaries.
- [ ] **P6-03 — Test auth/origin/rate-limit assumptions.** Acceptance: documented deployment threat model and executable checks for configured policy.
- [ ] **P6-04 — Review logging and error disclosure.** Acceptance: no credentials/raw private notes unnecessarily logged; user errors do not expose provider response bodies or stack traces.
- [ ] **P6-05 — Review dependency validation and recompile preservation.** Acceptance: test coverage covers all ID/cycle and completed-work invariants.
- [ ] **P6-06 — Run complete test/build/lint suite and resolve introduced failures.** Acceptance: attach actual CI results and distinguish tests not present/not run.
- [ ] **P6-07 — Perform final diff/dependency/security inspection.** Acceptance: no unrelated files/secrets; dependencies are justified and lockfiles are current.

## Phase 7 — Free-first deployment and operations (source-plan Day 3)

**Acceptance criteria:** current official provider limits and architecture compatibility are confirmed before use; only approved free resources are used; deployed behavior and secrets are independently verified.

- [ ] **P7-01 — Confirm current NVIDIA inference endpoint terms/availability/limits.** Acceptance: official source checked close to deployment date; account eligibility and real quota remain explicit.
- [ ] **P7-02 — Compare free frontend/backend hosting options.** Acceptance: verify official current limits, sleep/cold starts, request/time limits, secret support, and deployment constraints; recommend no paid resource without approval.
- [ ] **P7-03 — Choose a compatible frontend + backend deployment.** Acceptance: static host and Express/serverless API separation is explicit; origin/CORS and API URL are configurable.
- [ ] **P7-04 — Document and configure server-side secrets.** Acceptance: NVIDIA_API_KEY is configured only in the backend hosting secret store; never added to frontend variables/bundle or repository.
- [ ] **P7-05 — Deploy and check frontend.** Acceptance: official deployment URL loads over HTTPS and core UX smoke test is recorded.
- [ ] **P7-06 — Deploy and check backend endpoint.** Acceptance: health and API contract checks pass; expected method/origin/limits are verified.
- [ ] **P7-07 — Verify real AI path and safe failure path.** Acceptance: real valid-key request succeeds if quota permits, and missing key/provider errors fail safely. Do not expose secrets in evidence.
- [ ] **P7-08 — Add deployment, rollback, quota, and troubleshooting docs.** Acceptance: another developer can repeat the deploy and understands free-tier limitations.
- [ ] **P7-09 — Capture final deployed smoke-test and CI evidence.** Acceptance: only observed results are marked verified; no production-ready claim based solely on successful build.

## Phase 8 — Final acceptance and handoff

**Acceptance criteria:** every source-plan requirement is traced to implementation and evidence; remaining limitations and manual actions are unambiguous.

- [ ] **P8-01 — Trace every source-plan requirement to files/tests/manual evidence.** Acceptance: none silently omitted; any exclusion carries an explicit rationale.
- [ ] **P8-02 — Verify final branch/PR merge and default-branch state.** Acceptance: review approved diff and CI; record real commit/PR links.
- [ ] **P8-03 — Confirm app setup, security, and user docs are current.** Acceptance: clean setup and deployment guidance match tested code.
- [ ] **P8-04 — Publish final verification and limitations report.** Acceptance: summarize actual tests, deployment, costs/quotas, known limitations, and follow-up work without unsupported claims.

## Current session execution log

- **2026-10-16/17 — Repository audit and source review:** inspected the complete project source (Plan.txt, extracted lines 1–1072), current working branch, PR #1, package manifests, frontend/server entry points, environment examples, tests, README, Vite proxy, ignore rules, workflow, and lockfile.
- **Repository history reconciliation:** the initial empty-repository audit was accurate at its original time; the repository was then initialized and subsequent work now exists on `chore/phase-0-audit-and-foundation`. The earlier empty-state result is historical, not current state.
- **Phase 1 implementation inspected:** React/Vite foundation screen, separate Express server, `/api/health`, stable JSON 404/400/413 errors, safe placeholder environment examples, and 7 backend tests exist. AI planning intentionally remains HTTP 501; no AI or workflow feature is claimed complete.
- **Dependency reproducibility:** captured npm's actual lockfile from the successful GitHub Actions environment (lockfile v3; 115 package entries), committed `package-lock.json`, removed temporary export logging, and changed CI dependency installation to `npm ci`.
- **Automated verification:** [Actions run #16](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38953685372), commit `461a344e60b77cb2ea2eb8210f99d26220317c01`: clean install succeeded, 7/7 backend tests passed, and Vite production build passed. This is foundation verification only, not production readiness or live NVIDIA inference.
- **Security static inspection:** inspected 17 runtime/config/documentation files; targeted scan found no recognizable key/private-key pattern and no NVIDIA API secret name/value in frontend/config files. This is not a substitute for dedicated secret scanning or a formal audit.
- **Current next task:** `P2-01 — Define and document the plan request/response schema.`
- **Manual action required now:** none. NVIDIA key configuration is deferred until provider integration/live inference is ready; do not share the key in chat or commit it.

- **2026-10-17 — P2-01 contract documented and reviewed:** created `docs/API_CONTRACT.md`, retaining source-plan request names and formalizing revision semantics, blocker input, deferred work, dependency invariants, error envelopes, and server-side secret boundaries. Static document audit found all required topic/field markers and parsed both JSON examples; sample `totalMinutes=40` equals scheduled task durations 15+25.
- **2026-10-17 — P2-02 request validation implemented:** added `server/src/plan-request.js` and integrated validation in `server/src/app.js` before the placeholder plan response. Added tests for invalid/missing/blank/non-string input, length and time bounds, revision object, blocker references, completed/unfinished ID overlap, unknown dependencies, client-supplied credential fields, malformed JSON, oversized payloads, and accepted boundary values.
- **P2-02 CI evidence:** [GitHub Actions run #26](https://github.com/vansh-kumar-007/Flow-Compiler/actions/runs/38956658655), commit `98a0a5f421368870c00a04ef3979c7bc3a1603c0`: `npm ci` succeeded, 12/12 backend test cases passed, and the Vite production build passed.
- **Current next task:** `P2-03 — Implement NVIDIA Nemotron adapter using server-side configuration.` Valid requests intentionally still return `501 PLANNING_NOT_IMPLEMENTED`; no real inference is claimed.
- **Manual action required now:** none. NVIDIA key setup remains deferred until adapter implementation; do not paste secrets into chat or commit them.
