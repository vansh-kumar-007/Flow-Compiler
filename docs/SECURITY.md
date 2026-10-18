# Flow Compiler — Security Notes

## Scope and trust boundary

Flow Compiler has a public React/Vite frontend and a separate Express backend. NVIDIA credentials must remain exclusively in the backend environment. The frontend receives only a personal-use access token entered by the user for the current page session; that token authorizes the user's backend request and is not the NVIDIA provider key.

## Single-user authentication

- Protected endpoint: POST /api/plan.
- Public endpoint: GET /api/health, intentionally kept unauthenticated so the backend can be deployed and health-checked before any secrets are configured.
- Backend environment variable: FLOW_COMPILER_ACCESS_TOKEN. It must be exactly 43 base64url characters, generated from 32 cryptographically random bytes. Generate locally outside the repository using:
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
- Configure the generated token only in the backend host's environment/secret settings (or ignored server/.env for local development). Never commit the value, put it in VITE_* variables, add it to an issue/PR, or paste it into chat.
- The request must include Authorization: Bearer <token>. Only one well-formed Authorization header is accepted. Malformed, combined, missing or incorrect credentials receive the same generic 401 UNAUTHORIZED response.
- If the backend access-token environment variable is missing or malformed, POST /api/plan fails closed with a generic 503 AUTHENTICATION_NOT_CONFIGURED response. This allows a no-secret backend to remain healthy without accidentally exposing planning functionality.
- The middleware runs before JSON body parsing, request validation and the provider adapter. Unauthorized requests cannot invoke the provider. Credential bytes are compared with Node.js timingSafeEqual after strict token-format validation.
- Authentication responses use Cache-Control: no-store. Application code must not log credentials, reflect them in response bodies, include them in URLs/request JSON, or retain raw provider diagnostics.

## Frontend session handling

- The access token is controlled by React component state only.
- There are no localStorage/sessionStorage writes, URL parameters, analytics, console logging or app-managed persistence.
- The input is password-type and sets autocomplete=off. Browser password managers are controlled by the browser/user, so decline any browser prompt to save the token; the app itself does not save it.
- The request sends the token only through the Authorization header. Production planning calls require an HTTPS backend origin. Plain HTTP is allowed only for loopback local development.
- Clearing the token field or reloading/unmounting the page removes the in-memory value.

## CORS, rate limits and limitations

- CORS allows only exact configured APP_ORIGINS values and explicitly allows Authorization in preflight headers. CORS is not authentication; non-browser clients must still supply the token.
- The existing in-memory per-peer-IP limiter runs before CORS and authentication, so failed authentication attempts consume quota. Counters reset on restart and are not shared across instances; this is a basic personal-use safeguard, not distributed abuse protection.
- The single token is a shared bearer credential: anyone who obtains it can invoke the personal planning endpoint while it remains configured. Keep it private and rotate it by replacing the backend environment value if exposure is suspected.
- The NVIDIA_API_KEY remains intentionally unconfigured. No live inference or deployed authentication test is claimed by repository CI; CI uses fake tokens and mocked provider responses.

## Required pre-live gate

Before adding NVIDIA_API_KEY, deploy the backend without it, verify /api/health, configure exact APP_ORIGINS and frontend VITE_API_BASE_URL, and verify the frontend health check. Then configure FLOW_COMPILER_ACCESS_TOKEN server-side, test valid/invalid credentials against the deployed endpoint without a provider key, and confirm CORS plus rate limiting. Check NVIDIA account eligibility/quota separately before any one-shot live inference. Never expose the key in the frontend or this chat.


## Local plan persistence and safe export

- The app may save a versioned, validated active plan and completion map in the browser's localStorage. This is local to that browser profile, not encrypted cloud storage; anyone with access to the same browser profile may be able to read it. Do not put secrets or highly sensitive notes into task titles/reasons.
- The saved snapshot excludes the original raw thought input, revision note and session access token. It is bounded to 64 KiB, expires after 30 days, validates its schema and dependency graph on restore, and discards corrupt/unsupported snapshots. Storage may be unavailable or cleared by the browser.
- The safe JSON export is deliberately lossy: it contains task IDs/titles/durations/priorities/dependency IDs/categories/completion only. It omits the plan summary, task reasons, deferral reasons, raw input, blocker notes and credentials. Check the export before sharing.
- When the available-time budget changes and recompile is pending, the app retains the previous consistent saved snapshot. A failed replacement request must not clear an existing plan or completion state.
