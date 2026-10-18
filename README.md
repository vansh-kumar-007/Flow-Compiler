# Flow Compiler

Flow Compiler is planned as an AI-assisted productivity tool that turns unstructured thoughts into actionable, dependency-aware work plans. The source plan specifies React + Vite, a separate Express API, and NVIDIA Nemotron 3 Ultra.

## Current status

This project includes the React/Vite UI, separate Express API, validated planning route and single-user bearer authentication. The UI provides an explicitly labeled local demo, dependency/progress views, recompilation, focus timer, versioned local active-plan persistence, and a privacy-minimal JSON export. GET /api/health remains public; POST /api/plan requires FLOW_COMPILER_ACCESS_TOKEN. The UI requires non-secret VITE_API_BASE_URL for deployed backend checks/planning and uses a local Vite proxy during development. Production API connectivity and real NVIDIA inference remain unverified; automated provider tests use local mocks.

## Requirements

- Node.js 24 LTS
- npm

## Local development

1. Install dependencies from the repository root with npm install.
2. Copy `server/.env.example` to `server/.env` for local backend configuration. The server explicitly loads that file regardless of the command's working directory; environment variables supplied by the host take precedence. Unit tests inject a mock environment and mock fetch, so no real NVIDIA key is required. Do not commit `.env` files.
3. In one terminal, run npm run dev:api.
4. In another terminal, run npm run dev.
5. Open http://localhost:5173 and use “CHECK API”. For local development, the Vite proxy forwards `/api` to the local backend.

## Checks

- npm test — backend request/auth/provider-contract tests (provider fetch mocked), health, malformed JSON, body-size limit, CORS and rate-limit checks.
- npm run build — Vite production frontend build.

The GitHub Actions workflow runs dependency installation, backend tests, and the production frontend build on pushes and pull requests. Refer to the action run for the actual outcome; this README does not claim a check passed before a run exists.

## Secret handling

The NVIDIA adapter reads `NVIDIA_API_KEY` only from the server process environment (locally, `server/.env`; in hosting, a server-side secret setting). Never put it in a `VITE_*` variable, frontend source, screenshots, issues, or commits. The environment example leaves the key blank by default. `POST /api/plan` additionally requires a server-only `FLOW_COMPILER_ACCESS_TOKEN`; generate it using the command in `docs/SECURITY.md` and configure it only in the backend environment. Never commit or share the token. Do not configure an NVIDIA key or make a live provider call until account eligibility/terms/quota are checked and the owner explicitly approves.

## Project governance

See docs/PROJECT_STATE.md for the current verified project state and docs/BUILD_CHECKLIST.md for stable phase/task IDs, acceptance criteria, and evidence.


## Local plan persistence and export

- A validated active plan and its scheduled-task completion state are stored in this browser only, under a versioned app-specific localStorage key. Saved snapshots are size-bounded, checked again when restored, and expire after 30 days.
- The original raw thought input, revision/blocker note and session access token are not stored. The token remains in React memory only and is cleared on reload. Browser storage may be disabled or cleared; the app reports when it cannot save or restore.
- Export uses EXPORT SAFE PLAN to download JSON with task titles/IDs, durations, priorities, dependency IDs, categories and completion state. It deliberately excludes the plan summary, task reasons, deferral explanations, raw thoughts, blocker notes and credentials. Review the file before sharing it.
- A failed replacement planning request retains the prior active plan/completion state. A pending time-budget recompile does not overwrite the last consistent local save.
- For the V1 release gate and post-V1 deferrals, see docs/V1_ACCEPTANCE.md.
