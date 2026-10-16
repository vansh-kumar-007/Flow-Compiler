# Flow Compiler

Flow Compiler is planned as an AI-assisted productivity tool that turns unstructured thoughts into actionable, dependency-aware work plans. The source plan specifies React + Vite, a separate Express API, and NVIDIA Nemotron 3 Ultra.

## Current status

This feature branch contains the Phase 1 runtime foundation plus the Phase 2 API contract, request validation, and an isolated NVIDIA provider adapter. The frontend API connection check calls the real Express health endpoint. The `/api/plan` route still returns HTTP 501: prompt/output parsing, generated-task and dependency validation, scheduling, and integration of the provider into the route are not complete. Real NVIDIA inference has not been performed or verified.

## Requirements

- Node.js 24 LTS
- npm

## Local development

1. Install dependencies from the repository root with npm install.
2. Copy `server/.env.example` to `server/.env` for local backend configuration. The server explicitly loads that file regardless of the command's working directory; environment variables supplied by the host take precedence. Unit tests inject a mock environment and mock fetch, so no real NVIDIA key is required. Do not commit `.env` files.
3. In one terminal, run npm run dev:api.
4. In another terminal, run npm run dev.
5. Open http://localhost:5173 and use “TEST API CONNECTION”.

## Checks

- npm test — API health, unimplemented-plan boundary, unknown route, malformed JSON, body-size limit, and CORS smoke tests.
- npm run build — Vite production frontend build.

The GitHub Actions workflow runs dependency installation, backend tests, and the production frontend build on pushes and pull requests. Refer to the action run for the actual outcome; this README does not claim a check passed before a run exists.

## Secret handling

The isolated NVIDIA adapter reads `NVIDIA_API_KEY` only from the server process environment (locally, `server/.env`; in hosting, a server-side secret setting). Never put it in a `VITE_*` variable, frontend source, screenshots, issues, or commits. The environment example leaves the key blank by default; set it only in the ignored `server/.env` or hosting secret settings when deliberately performing optional live inference. The adapter is not connected to `/api/plan` yet, and no live inference is claimed.

## Project governance

See docs/PROJECT_STATE.md for the current verified project state and docs/BUILD_CHECKLIST.md for stable phase/task IDs, acceptance criteria, and evidence.
