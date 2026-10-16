# Flow Compiler — Project State

Last updated: 2026-10-16
Authoritative product specification: the ChatGPT Project source file `Plan.txt` / “Flow Compiler — build plan and starter code”.

## Repository baseline

- Repository: https://github.com/vansh-kumar-007/Flow-Compiler
- Default branch declared by repository metadata: `main`
- Initial audit result: public repository is accessible and has push/admin permissions for the connected GitHub identity.
- GitHub reported the repository as empty (size 0); the `contents` endpoint returned “This repository is empty”, the branches endpoint returned `[]`, commit search returned HTTP 409 (“Git Repository is empty”), and pull-request search returned no results.
- Therefore there is currently no code, commit history, branch, existing checklist, project-state file, test suite, CI, or deployment to inspect. These are audit findings, not assertions about any earlier local copy.
- Because no branch has a commit to branch from, the first repository write must establish a root commit. Feature work should move onto a feature branch immediately afterward.

## Product and architecture baseline

Flow Compiler turns unstructured thoughts into realistic, dependency-aware, time-bounded workflows. The source plan specifies a React + Vite frontend, a separate Express backend, and NVIDIA Nemotron 3 Ultra through NVIDIA's OpenAI-compatible chat completions API. The frontend must never receive the NVIDIA API key.

Planned capabilities, not yet implemented or verified:
- AI-generated actionable tasks with duration, priority, reason, category, and dependency IDs.
- Dependency-aware workflow presentation in a dark futuristic command-center UI.
- Completion/progress tracking, next action, countdown/focus mode, and recompile when time changes or blockers/early completion change the plan.
- Local plan persistence, demo input/data, responsive UI, and export/share output that excludes private raw notes.
- Backend validation, model-output schema validation, cycle/unknown-dependency rejection, bounded payloads/outputs, safe error handling, timeouts, rate limiting, and server-side secrets.
- Free-first deployment, with current hosting quotas and the actual service constraints confirmed before deployment choices are made.

## Proposed execution phases

The source plan's Day 1 / Day 2 / Day 3 order remains the baseline, split into verifiable phases to keep each change reviewable.

1. **Phase 0 — Audit and project governance.** Record repository/source baseline, phase map, requirement IDs, dependencies, risks, acceptance criteria, and manual blockers. Acceptance: checklist and state documents exist in the repository and agree about current progress.
2. **Phase 1 — Repository and runtime foundation (Day 1 foundation).** Bootstrap the minimum React/Vite frontend and Express backend with explicit scripts, environment example, secret-safe ignore rules, health endpoint, readable errors, and a repeatable automated verification path. Acceptance: clean install/build and health/API tests pass in CI or another recorded executable environment; no secret is committed.
3. **Phase 2 — Secure AI planning API (Day 1 compiler).** Implement validated request contract, NVIDIA adapter, bounded timeout/response handling, schema validation for every task field, ID uniqueness, dependency existence and acyclic-graph checks, rate limits, and stable error responses. Acceptance: automated positive, malformed-input, malformed-model-output, dependency-cycle, timeout/provider-error, and missing-secret tests pass.
4. **Phase 3 — Core workflow UI (Day 1/2).** Build the input/time selector, demo input, task/dependency display, priorities, loading/error/empty states, task completion, and progress. Acceptance: UI consumes the API contract without exposing secrets and has automated or documented interaction checks.
5. **Phase 4 — Recompilation, timing, and focus (Day 2).** Preserve completed work and valid dependencies across recompilation; allow remaining-time adjustments, blockers, early completion, countdown, and a focused next-action view. Acceptance: tests prove completed task IDs/status are preserved, dependencies are revalidated, and remaining work is not silently lost.
6. **Phase 5 — Persistence, export, responsiveness, and polish (Day 2/3).** Local plan persistence, animated dependency visualization, keyboard/accessibility/reduced-motion support, responsive layout, demo data, and privacy-preserving share/export. Acceptance: core flows work at mobile and desktop widths, saved state reloads, and export does not include raw private notes unless explicitly chosen.
7. **Phase 6 — QA and security hardening (Day 3).** Test vague/large/conflicting inputs, output limits, rate limits, duplicate IDs, unknown/self dependencies, circular dependencies, provider failures, and privacy boundaries. Acceptance: all available automated checks pass and limitations are documented; untested items stay unverified.
8. **Phase 7 — Free-first deployment and operational docs (Day 3).** Confirm current free tiers/limits and architecture compatibility; deploy only using approved free resources; add secure environment setup, smoke tests, and rollback/manual steps. Acceptance: deployed endpoints are independently checked, secrets remain server-side, and deployment costs/limits are documented.
9. **Phase 8 — Final acceptance and handoff.** Reconcile every requirement to code and verification evidence, review the diff/CI, and record known limitations. Acceptance: no production-readiness claim without end-to-end evidence.

## Initial risk register

- **R-01 — Empty repository / no base commit (blocking Phase 1 branch workflow):** root commit is required before a feature branch can be based on the project.
- **R-02 — Model access/quota:** the NVIDIA model page currently advertises a free API endpoint, but eligibility, live key validity, request quotas, and real inference are account-specific and remain unverified until a key is configured and a real request is tested. Reference: https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b
- **R-03 — Public endpoint abuse:** API key protection alone is insufficient; the backend must have request validation, limits, safe errors, and an explicitly selected deployment/authentication strategy.
- **R-04 — Dependency integrity:** starter-plan validation in the source document is intentionally incomplete; the implementation must reject unknown IDs, duplicate IDs, self-links, and cycles before the UI uses generated plans.
- **R-05 — Recompile can discard user work:** completed tasks and still-valid dependency relationships must be preserved deliberately.
- **R-06 — Static frontend/backend split:** static hosting (for example GitHub Pages) cannot host Express; a separately hosted/serverless backend and verified CORS/origin configuration are required.
- **R-07 — Free-tier drift:** hosting/model usage limits change, so verify official current documentation before choosing services.
- **R-08 — No executable environment attached to GitHub connection:** repository operations are available through GitHub tools, but local install/build/test execution is not yet established. Add CI early so code can be verified from the repository, and report any CI that has not actually run.

## Current progress

- Phase 0: audit established from live GitHub metadata/API evidence.
- No application code, tests, CI, or deployments have been implemented or verified at this point.
- The checklist will be maintained in `docs/BUILD_CHECKLIST.md`; stable IDs and statuses there are the authoritative task-level tracking.
- Current next task: `P0-02`, create the granular master checklist and reconcile the two governance documents.
- Manual action currently required: none to document the baseline. NVIDIA key configuration and browser/deployment authorization will be requested only when their respective phases are reached.
