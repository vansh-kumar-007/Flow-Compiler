# Flow Compiler — V1 acceptance matrix

This matrix maps the original Project source Plan.txt to the repository's stable P0–P8 task IDs. It does not replace the source plan or mark unobserved browser/deployment behavior as passed.

## Release decision

**Current target:** usable demo/preview V1 with the local demo, validated plan presentation, dependency/progress interactions, recompile/focus controls, local persistence, and privacy-safe JSON export.

**Not included in the release claim:** working AI inference. The NVIDIA provider key is intentionally absent, and account eligibility, trial terms, quota/credits and billing status are unknown. No live provider call is authorized or performed.

## Requirement-to-evidence matrix

| Source-plan requirement | Original task IDs | V1 classification | Current implementation/evidence | Remaining acceptance |
|---|---|---|---|---|
| React/Vite frontend and separate Express API; server-side provider secret boundary | P1-01–P1-09, P2-03, P2-12–P2-13 | Required before V1 | Existing workspace scripts, CI workflow, API contract, security notes, authenticated planning route, mocked provider adapter | Exact-main CI and deployed health/commit correlation |
| Useful local demo, bounded thought input and time window | P3-02–P3-03, P6-01 | Required before demo V1 | Fixed illustrative demo fixture, 5,000-character input guard, 5–720 minute budget, Node tests | Browser smoke, including one fresh Network-panel no-POST check |
| Validated plan summary, tasks, deferred work, and clear error/loading states | P2-05–P2-08, P3-04–P3-05, P3-08, P6-01–P6-02 | Required before V1 | Server/client schema and dependency validation, safe error mapping, mocked request tests | Browser state/error presentation; no live model-quality claim |
| Dependency correctness and visual prerequisite → dependent relationships | P2-07, P3-06, P5-02, P6-05 | Required before V1 | Graph helper validates declared edges, missing IDs, duplicates and cycles; UI lists prerequisite and dependent nodes, styles deferred work, animates edge arrows | Browser visual direction, narrow-width readability, reduced-motion observation; richer graph-card artwork is post-V1 |
| Completion and progress tracking | P3-07, P5-01, P6-05 | Required before V1 | Immutable mark/unmark helpers, scheduled-only progress math and regression tests; completed state is part of local snapshot | Browser verify 0% → partial → 100%, unmark and plan-switch behavior |
| Recompile, completed-task preservation, blocker handling, remaining-time schedule | P4-01–P4-05, P4-08, P6-05 | Required before V1 | Stable task IDs, dependency revalidation, deterministic local demo recompile, API revision context and mocked tests | Browser check preserves old plan on failure, completed work stays complete, blocked task/dependents defer |
| Focus countdown and next-ready task | P4-06–P4-07, P5-03 | Required before V1 | Start/pause/reset timer, prerequisite-gated focus, next-ready selector, responsive single-column focus mode | Browser timer/focus controls and keyboard/focus visibility |
| Persist active plan/completion without credentials or raw notes | P5-01, P5-06 | Implement and test in this sprint | Versioned 64 KiB-bounded local snapshot; 30-day expiry; invalid/corrupt data discarded; only validated plan, completion, budget and plan kind are saved | Browser reload/restore, completion restoration, corrupted/expired save recovery, storage-disabled behavior |
| Share/export without exposing raw thoughts or private free-form notes | P5-04, P5-06 | Implement and test in this sprint | Safe JSON export includes task title/ID/duration/priority/dependencies/category/completion only; excludes summary, task reasons, deferred reasons, raw input, blocker notes and credentials | Download/open file once and confirm expected fields only |
| Keyboard/screen-reader support, contrast, reduced motion, mobile layout | P3-09, P5-03, P5-05 | Required before V1 | Existing semantic controls, visible focus rules, progressbar/live regions and reduced-motion CSS; new focus-mode control | Manual keyboard, screen-reader announcement, contrast, reduced-motion and narrow viewport checks |
| Request bounds, auth, CORS, rate limiting, safe errors and secret separation | P2-02, P2-04, P2-09–P2-12, P6-02–P6-07 | Required before V1 | Existing mocked regression coverage and server-only credentials; no new dependency or security weakening | Re-run CI; deployed origin/auth/rate-limit checks and approved Render log review |
| Free-first hosting, matching commits, health, rollback and operations guidance | P7-02–P7-09 | Required before public V1; partly external | Vercel production baseline was READY on baseline main; setup/security docs are being reconciled | After merge: exact Vercel SHA, Render deployed SHA and fresh /api/health response; rollback instructions and deployment events |
| Traceability and release handoff | P8-01–P8-04 | Implement and verify in this sprint | This matrix plus master checklist and project-state evidence | Update with merged SHA, exact-main CI and deployment/browser evidence |

## Intentionally post-V1

- **Rich image/card export:** the current safe JSON export is the privacy-preserving V1 format. A designed image/share card can follow without blocking a usable workflow.
- **More elaborate graph visualization:** current explicit dependency links and animated arrows communicate declared direction; a fully composed SVG/canvas graph with richer glowing connections is polish beyond the V1 gate.
- **Browser automation framework, lint and typecheck:** none is configured. This sprint adds no framework/dependency solely for convenience; the existing Node test runner and Vite build remain the automated gate. Manual browser acceptance is still required.
- **Distributed rate limiting, multi-user accounts and external security certification:** outside the original single-user personal-use V1 scope. Existing in-memory rate limits and shared bearer-token limitations must remain documented.

## External blockers — not silently deferred or marked complete

- **P2-11 / P7-01: live NVIDIA inference and provider-account readiness.** Blocked by explicit no-provider-request instruction and unknown account eligibility, terms, quota/credits and billing. Do not request or configure NVIDIA_API_KEY; do not test live inference.
- **P7-06 / P7-09: Render commit, logs and health correlation.** The connected Render tool requires the owner to select the intended workspace. No workspace is guessed and no hosting settings/secrets are changed.
- **Browser acceptance:** the current environment has no browser automation runner. A person must complete the compact checklist in the final handoff; source inspection and Node tests are not browser evidence.

## Security and data-loss invariants

- The session access token remains React memory only. Never write it to localStorage, sessionStorage, IndexedDB, URLs, export files, logs or plan JSON.
- The local snapshot does not contain the original raw thought input, revision note or token. It is versioned, size-bounded, validated on read, expires after 30 days, and corrupt/unsupported state is discarded.
- While a recompile is pending because the selected time budget changed, do not overwrite the last consistent saved plan with a mismatched budget.
- If a new planning request fails, preserve the existing plan and completion state rather than replacing it with an empty result.
- The safe export is intentionally lossy: it excludes plan summary and all free-form reasons/notes by default.
- No paid service/dependency, NVIDIA request, hosting settings change or secret change is part of this sprint.


## Sprint verification update — 2026-10-19

- PR #25 head 46ab16673f272b8d7ee32428e19111ae37ecb9d3 passed configured Actions run #39157147324: 260 backend tests, 56 frontend Node tests, and the Vite production build.
- The first run after adding malformed-snapshot recovery failed because its test called load twice; the first call correctly discarded the snapshot and the second saw an empty store. The test now reads once and checks that result; the later exact-head run is green.
- Vercel's PR preview status failed with an explicit build-rate-limit signal. This is not an app build result, and no paid upgrade/settings change is permitted. The sprint branch is not yet production-deployed.
- Render commit/health evidence is pending explicit workspace selection. The release verdict cannot exceed READY AS DEMO/PREVIEW ONLY until deployment and manual browser acceptance are complete. Live inference remains blocked.

 
## Consolidated post-merge release status — 2026-10-19

- V1 code PR #25 merged as b797708e567f0b4d13b0c0926cce10c52ed57262. Evidence reconciliation PR #26 merged as 752b60626b603e3d02614834d1ce75cbd7d1d8d3. The latest PR-head Actions run passed 260 backend tests, 56 frontend Node tests and Vite production build. The GitHub integration does not surface the push-triggered exact-main Actions run.
- Vercel Production still points to READY deployment dpl_StavRzEEQ6PpB3ANRBrZrMhxtbzB on old main SHA d2e6c8ad36aa910c082a76dc11214eab2b95632c. The V1 merge SHA has a failed Vercel status with a build-rate-limit/upgradeToPro signal, and no matching production deployment was listed. No paid upgrade or hosting setting change is permitted.
- Render deployed SHA and health remain unknown pending explicit workspace selection. Manual browser checks remain pending, including the fresh Local Demo no-network test. Live inference remains blocked.
- **Current verdict: NOT READY for public V1.** Features are merged and PR-head tests/build are green, but current production deployment, Render health/commit evidence, exact-main Actions evidence and browser acceptance are not complete.
