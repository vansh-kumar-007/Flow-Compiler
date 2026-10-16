# Flow Compiler

Flow Compiler is planned as an AI-assisted productivity tool that turns unstructured thoughts into actionable, dependency-aware work plans. The source plan specifies React + Vite, a separate Express API, and NVIDIA Nemotron 3 Ultra.

## Current status

This branch contains the Phase 1 runtime foundation. The frontend is a real React application and its API connection check calls the real Express health endpoint. AI plan generation, dependency graphs, task completion, focus mode, persistence, and export are not implemented yet. The plan endpoint intentionally returns HTTP 501 until Phase 2 is built; the interface labels that boundary instead of simulating an AI response.

## Requirements

- Node.js 24 LTS
- npm

## Local development

1. Install dependencies from the repository root with npm install.
2. Copy server/.env.example to server/.env for local backend configuration. No real NVIDIA key is needed for Phase 1. Do not commit .env files.
3. In one terminal, run npm run dev:api.
4. In another terminal, run npm run dev.
5. Open http://localhost:5173 and use “TEST API CONNECTION”.

## Checks

- npm test — API health, unimplemented-plan boundary, unknown route, malformed JSON, body-size limit, and CORS smoke tests.
- npm run build — Vite production frontend build.

The GitHub Actions workflow runs dependency installation, backend tests, and the production frontend build on pushes and pull requests. Refer to the action run for the actual outcome; this README does not claim a check passed before a run exists.

## Secret handling

The NVIDIA key is a server-only secret. Never put it in a VITE_* variable, frontend source, screenshots, issues, or commits. The server environment example contains a placeholder only. Real AI provider configuration and model-output validation are Phase 2 scope.

## Project governance

See docs/PROJECT_STATE.md for the current verified project state and docs/BUILD_CHECKLIST.md for stable phase/task IDs, acceptance criteria, and evidence.
