import { useEffect, useRef, useState } from "react";
import {
  DEMO_PLAN,
  DEMO_INPUT,
  getInputError,
  getTimeError,
  validatePlanResponse
} from "./plan-ui.js";

// Public, non-secret API origin. Production fails closed when it is not configured;
// local Vite development continues to use the dev-server /api proxy.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

function readApiError(payload, status) {
  const code = payload?.error?.code;
  const messages = {
    UNAUTHORIZED: "Access token rejected. Check it and try again.",
    AUTHENTICATION_NOT_CONFIGURED: "Backend access-token authentication is not configured yet.",
    AI_NOT_CONFIGURED: "Access was accepted, but the backend has no NVIDIA API key configured. No plan was generated.",
    RATE_LIMIT_EXCEEDED: "Too many requests. Wait before trying again.",
    AI_TIMEOUT: "The AI request timed out. No plan was accepted; you can retry.",
    AI_RATE_LIMITED: "The AI provider is rate-limited. Wait before trying again.",
    AI_NETWORK_ERROR: "The AI provider could not be reached. No plan was generated.",
    INVALID_MODEL_OUTPUT: "The AI provider returned a plan that failed validation."
  };
  return messages[code] || ("Planning request failed (HTTP " + status + (typeof code === "string" ? " · " + code : "") + ").");
}

function planningUrl() {
  if (!import.meta.env.DEV && !API_BASE_URL) {
    throw new Error("Production API URL is not configured. Set VITE_API_BASE_URL to the Express backend origin.");
  }
  try {
    const localHosts = ["localhost", "127.0.0.1", "[::1]"];
    const frontendIsLocal = typeof window !== "undefined" && localHosts.includes(window.location.hostname);
    const backendUrl = API_BASE_URL ? new URL(API_BASE_URL) : new URL(window.location.origin);
    const backendIsLocal = localHosts.includes(backendUrl.hostname);
    const isLocalDevelopment = import.meta.env.DEV && frontendIsLocal && backendIsLocal;
    const isOriginOnly = backendUrl.pathname === "/" && !backendUrl.search && !backendUrl.hash
      && !backendUrl.username && !backendUrl.password;
    if (!isOriginOnly || (backendUrl.protocol !== "https:" && !isLocalDevelopment)) {
      throw new Error("The planning API must be a valid HTTPS origin. HTTP is allowed only for local development.");
    }
    return (API_BASE_URL ? backendUrl.origin : "") + "/api/plan";
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Production API URL") || error.message.startsWith("The planning API"))) {
      throw error;
    }
    throw new Error("The configured planning API URL is invalid.");
  }
}

export default function App() {
  const [brainDump, setBrainDump] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [demoMode, setDemoMode] = useState(false);
  // The access token intentionally lives only in React state: no browser storage,
  // URL, telemetry, console output, or persistence is used.
  const [accessToken, setAccessToken] = useState("");
  const [planState, setPlanState] = useState("idle");
  const [planMessage, setPlanMessage] = useState("");
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [planKind, setPlanKind] = useState(null);
  const [apiState, setApiState] = useState("idle");
  const [apiMessage, setApiMessage] = useState("Backend connection has not been checked.");
  const planRequestId = useRef(0);
  const healthRequestId = useRef(0);
  const abortController = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      planRequestId.current += 1;
      healthRequestId.current += 1;
      abortController.current?.abort();
    };
  }, []);

  function changeInput(value) {
    setBrainDump(value);
    if (planState === "success" || planState === "error") {
      setPlanState("idle");
      setPlanMessage("");
      setGeneratedPlan(null);
      setPlanKind(null);
    }
  }

  function changeMinutes(value) {
    setMinutes(value);
    if (planState === "success" || planState === "error") {
      setPlanState("idle");
      setPlanMessage("");
      setGeneratedPlan(null);
      setPlanKind(null);
    }
  }

  function enterDemoMode() {
    abortController.current?.abort();
    planRequestId.current += 1;
    setDemoMode(true);
    setBrainDump(DEMO_INPUT);
    setMinutes(120);
    setGeneratedPlan(DEMO_PLAN);
    setPlanKind("demo");
    setPlanState("success");
    setPlanMessage("Demo plan loaded locally. No backend or NVIDIA request was sent.");
  }

  function exitDemoMode() {
    setDemoMode(false);
    setGeneratedPlan(null);
    setPlanKind(null);
    setPlanState("idle");
    setPlanMessage("");
  }

  async function compileWorkflow() {
    const inputError = getInputError(brainDump);
    const timeError = getTimeError(minutes);
    if (inputError || timeError) {
      setPlanState("error");
      setPlanMessage(inputError || timeError);
      setGeneratedPlan(null);
      setPlanKind(null);
      return;
    }

    // Demo plans are local-only. This guard prevents demo mode from falling through
    // to fetch even if the button handler changes in a future UI edit.
    if (demoMode) {
      setGeneratedPlan(DEMO_PLAN);
      setPlanKind("demo");
      setPlanState("success");
      setPlanMessage("Demo plan loaded locally. No backend or NVIDIA request was sent.");
      return;
    }

    const credential = accessToken.trim();
    if (!credential) {
      setPlanState("error");
      setPlanMessage("Enter your session access token to authorize this request.");
      setGeneratedPlan(null);
      setPlanKind(null);
      return;
    }

    let requestUrl;
    try {
      requestUrl = planningUrl();
    } catch (error) {
      setPlanState("error");
      setPlanMessage(error.message);
      setGeneratedPlan(null);
      setPlanKind(null);
      return;
    }

    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const requestId = ++planRequestId.current;
    setPlanState("loading");
    setPlanMessage("Sending an authenticated planning request…");
    setGeneratedPlan(null);
    setPlanKind(null);

    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer " + credential
        },
        body: JSON.stringify({
          brainDump: brainDump.trim(),
          availableMinutes: minutes,
          previousPlan: null
        })
      });

      const payload = await response.json().catch(() => null);
      if (requestId !== planRequestId.current || !mounted.current) return;
      if (!response.ok) {
        setPlanState("error");
        setPlanMessage(readApiError(payload, response.status));
        return;
      }

      const validationError = validatePlanResponse(payload, minutes);
      if (validationError) {
        setPlanState("error");
        setPlanMessage("The backend returned a response that did not match the plan contract: " + validationError);
        return;
      }

      setGeneratedPlan(payload);
      setPlanKind("api");
      setPlanState("success");
      setPlanMessage("Authenticated request succeeded. The plan below is the validated backend response.");
    } catch {
      if (requestId !== planRequestId.current || !mounted.current) return;
      if (controller.signal.aborted) return;
      setPlanState("error");
      setPlanMessage("Could not reach the planning API. Check the backend URL and allowed origin.");
    } finally {
      if (requestId === planRequestId.current && abortController.current === controller) {
        abortController.current = null;
      }
    }
  }

  async function checkApi() {
    if (!import.meta.env.DEV && !API_BASE_URL) {
      setApiState("error");
      setApiMessage("Production API URL is not configured. Set VITE_API_BASE_URL to the Express backend origin.");
      return;
    }

    const requestId = ++healthRequestId.current;
    setApiState("loading");
    setApiMessage("Checking the Express health endpoint…");
    try {
      const response = await fetch(API_BASE_URL + "/api/health", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (requestId !== healthRequestId.current || !mounted.current) return;
      if (!response.ok || payload?.status !== "ok" || payload?.service !== "flow-compiler-api") {
        setApiState("error");
        setApiMessage("Express backend returned an unexpected health response. AI planning is not enabled.");
        return;
      }
      setApiState("success");
      setApiMessage("Backend reachable · " + payload.service);
    } catch {
      if (requestId !== healthRequestId.current || !mounted.current) return;
      setApiState("error");
      setApiMessage("Express backend unavailable at the configured API origin. AI planning is not enabled.");
    }
  }

  const inputError = getInputError(brainDump);
  const timeError = getTimeError(minutes);
  const formValid = !inputError && !timeError;
  const displayPlan = planState === "success" ? generatedPlan : null;

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Flow Compiler home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><span className="brand-copy"><strong>FLOW<span> / COMPILER</span></strong><small>PERSONAL EXECUTION ENGINE</small></span></a>
      <div className="header-right"><span className="version-chip">BUILD 0.4.0 · PHASE 3</span><div className="system-status"><i/> UI ONLINE</div></div>
    </header>
    <section className="hero" aria-labelledby="hero-title">
      <div className="eyebrow"><i/> RAW THOUGHTS <span>/</span> STRUCTURE <span>/</span> EXECUTION</div>
      <div className="hero-layout"><div><h1 id="hero-title">Turn chaos into<br/><em>clear momentum.</em></h1><p>A personal command center for turning scattered thoughts into focused, dependency-aware work.</p></div><div className="hero-orbit" aria-hidden="true"><div>FC<span>↗</span></div><small>THINK IN FLOWS</small></div></div>
    </section>
    <section className="workspace" aria-label="Workflow compiler workspace">
      <article className="panel input-panel">
        <div className="panel-topline"><b>01</b><span>INPUT // RAW THOUGHTS</span><small>INGEST</small></div>
        <h2>Get it out of your head.</h2><p className="description">Describe tasks, loose ends, blockers and anything that affects order. Structure comes next.</p>
        <div className="mode-switch" role="group" aria-label="Compilation mode">
          <button type="button" className={!demoMode ? "mode-button active" : "mode-button"} aria-pressed={!demoMode} onClick={exitDemoMode}>API PLANNING</button>
          <button type="button" className={demoMode ? "mode-button active" : "mode-button"} aria-pressed={demoMode} onClick={enterDemoMode}>LOCAL DEMO</button>
        </div>
        {demoMode && <p className="mode-note" role="status">Local demo mode: Compile loads a fixed illustrative plan. No planning API request is made.</p>}
        <label className="field-label" htmlFor="brain-dump">YOUR INPUT</label>
        <textarea id="brain-dump" value={brainDump} onChange={e=>changeInput(e.target.value)} maxLength={5000} aria-invalid={Boolean(inputError)} aria-describedby="brain-dump-help brain-dump-error" placeholder="I need to finish my portfolio, fix a login bug, learn React Query, and apply for internships…"/>
        <div className="input-footer"><span>{brainDump.length.toLocaleString()} / 5,000 CHARACTERS</span><button className="text-button" type="button" onClick={enterDemoMode}>LOAD EXAMPLE ↗</button></div>
        <p id="brain-dump-help" className="field-help">Whitespace around your thoughts is allowed; the input must contain useful non-whitespace text.</p>
        {inputError && <p id="brain-dump-error" className="field-error" role="alert">{inputError}</p>}
        <div className="rule"/>
        <div className="time-heading"><label className="field-label" htmlFor="available-minutes">EXECUTION WINDOW</label><strong>{minutes} <small>MIN</small></strong></div>
        <input id="available-minutes" className="time-slider" aria-label="Available time in minutes" type="range" min="5" max="720" step="5" value={minutes} aria-describedby="available-minutes-help available-minutes-error" aria-invalid={Boolean(timeError)} onChange={e=>changeMinutes(Number(e.target.value))}/>
        <div className="range-labels"><span>5 MIN</span><span>12 HOURS</span></div>
        <div className="time-presets">{[15,30,60,120,240,480,720].map(v=><button type="button" key={v} className={minutes===v?"preset active":"preset"} aria-pressed={minutes===v} onClick={()=>changeMinutes(v)}>{v>=60?v/60+"H":v+"M"}</button>)}</div>
        <p id="available-minutes-help" className="field-help">Choose an integer from 5 to 720 minutes, matching the planning API contract.</p>
        {timeError && <p id="available-minutes-error" className="field-error" role="alert">{timeError}</p>}
        <div className="rule"/>
        { !demoMode && <>
          <label className="field-label" htmlFor="session-access-token">SESSION ACCESS TOKEN</label>
          <input
            id="session-access-token"
            className="token-input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={accessToken}
            onChange={event => setAccessToken(event.target.value)}
            aria-describedby="token-memory-note"
            placeholder="Enter backend access token for this tab"
          />
          <div className="input-footer token-footer">
            <span id="token-memory-note">Memory only · cleared when this page reloads</span>
            <button className="text-button" type="button" onClick={() => setAccessToken("")}>CLEAR TOKEN</button>
          </div>
        </>}
        <button className="compile-button" type="button" onClick={compileWorkflow} disabled={planState === "loading" || !formValid} title={demoMode ? "Load the fixed local demo; no API request is sent" : "Send an authenticated request to the configured planning API"}>
          <span className="compile-glyph">⌘</span>
          <span>{planState === "loading" ? "COMPILING WORKFLOW" : demoMode ? "LOAD DEMO PLAN" : "COMPILE WORKFLOW"}<small>{planState === "loading" ? "WAITING FOR BACKEND" : demoMode ? "LOCAL / NO PROVIDER CALL" : "AUTHENTICATED API REQUEST"}</small></span>
          <b>↗</b>
        </button>
        <p className="honesty-note"><i>i</i> {demoMode ? "Demo tasks are fixed examples. They are not AI-generated and this mode does not call any API." : "Your token stays in this page's memory and is sent only in the Authorization header. Raw notes go to your backend and, when configured, its AI provider."}</p>
      </article>
      <article className="panel output-panel">
        <div className="panel-topline"><b>02</b><span>COMPILATION OUTPUT</span><small>PLAN / TASK LIST</small></div>
        <div className="output-title"><div><h2>Execution plan</h2><p className="description">Only tasks from the active plan are shown below.</p></div><span className={planKind === "api" ? "preview-badge api-plan-badge" : "preview-badge"}>{planKind === "api" ? "VALIDATED API PLAN" : planKind === "demo" ? "DEMO / ILLUSTRATIVE" : "WAITING FOR INPUT"}</span></div>
        {planState === "idle" && <div className="graph-banner"><span className="graph-icon">⌁</span><div><small>WORKFLOW STATUS</small><strong>Awaiting compilation</strong><p>No plan is displayed yet. Use Local Demo to view clearly labeled sample tasks, or submit valid input in API Planning mode.</p></div><span className="idle">IDLE</span></div>}
        {planState === "loading" && <div className="output-state loading-state" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true"/> <div><strong>Compiling workflow…</strong><p>Waiting for the authenticated planning API response.</p></div></div>}
        {planState === "error" && <div className="output-state error-state" role="alert"><strong>Plan not available</strong><p>{planMessage}</p><p>No task plan is being shown for this failed request.</p></div>}
        {planState === "success" && displayPlan && <>
          <div className="plan-feedback success" role="status" aria-live="polite">{planMessage}</div>
          <section className={"generated-plan " + (planKind === "demo" ? "demo-plan" : "api-plan")} aria-labelledby="generated-plan-title">
            <div className="generated-plan-heading"><div><small>{planKind === "demo" ? "FIXED LOCAL EXAMPLE · NOT AI GENERATED" : "VALIDATED BACKEND RESPONSE"}</small><h3 id="generated-plan-title">{displayPlan.summary}</h3></div><span>{displayPlan.totalMinutes} MIN</span></div>
            <div className="plan-metadata"><span>{displayPlan.tasks.length} scheduled tasks</span><span>{displayPlan.deferredTasks?.length || 0} deferred</span><span>Time budget: {minutes} min</span></div>
            <ol>{displayPlan.tasks.map((task, index) => <li key={task.id}>
              <div className="generated-task-title"><strong><span className="task-index">{String(index + 1).padStart(2, "0")}</span>{task.title}</strong><span>{task.minutes} MIN · {task.priority.toUpperCase()}</span></div>
              <p>{task.reason}</p>
              <div className="task-facts"><span>{task.category.toUpperCase()}</span><span>{task.dependsOn.length ? "PREREQUISITES: " + task.dependsOn.join(", ") : "NO PREREQUISITES"}</span><span>ID: {task.id}</span></div>
            </li>)}</ol>
            {displayPlan.deferredTasks?.length > 0 && <div className="deferred-tasks"><strong>Deferred work · not scheduled in this time window</strong><ul>{displayPlan.deferredTasks.map(task => <li key={task.id}><b>{task.title}</b><p>{task.deferredReason}</p><small>{task.minutes} MIN · {task.priority.toUpperCase()} · {task.category.toUpperCase()} · ID: {task.id}</small></li>)}</ul></div>}
          </section>
        </>}
        {planState !== "loading" && planState !== "success" && <div className="api-card"><div className="api-heading"><i className={"api-dot "+apiState}/><div><small>BACKEND CONNECTIVITY</small><strong>{apiState==="success"?"Connection verified":apiState==="loading"?"Checking connection":apiState==="error"?"Backend not reachable":"Not checked yet"}</strong></div><button type="button" onClick={checkApi} disabled={apiState==="loading"}>{apiState==="loading"?"CHECKING…":"CHECK API ↗"}</button></div><p role="status" aria-live="polite">{apiMessage}</p></div>}
      </article>
    </section>
    <footer><span><b>FLOW / COMPILER</b> · PHASE 3 CORE UI</span><span><i/> BUILT FOR FOCUSED WORK <em>/</em> {demoMode ? "LOCAL DEMO MODE" : "AI PLANNING REQUIRES SERVER CONFIGURATION"}</span></footer>
  </main>;
}
