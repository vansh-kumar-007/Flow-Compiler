import { useEffect, useRef, useState } from "react";
import { DEMO_PLAN, DEMO_INPUT, TIME_PRESETS, formatTimePreset, getInputError, getTimeError } from "./plan-ui.js";
import { requestPlan } from "./plan-api.js";
import { buildDependencyGraph, buildPlanPresentation, getCompletionProgress, isCurrentPlanRequest, setScheduledTaskCompletion } from "./plan-interactions.js";

// Public, non-secret API origin. Production fails closed when it is not configured;
// local Vite development continues to use the dev-server /api proxy.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

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
  const [completedTaskIds, setCompletedTaskIds] = useState({});
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
    if (demoMode) return;
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
    abortController.current = null;
    planRequestId.current += 1;
    setCompletedTaskIds({});
    setDemoMode(true);
    setBrainDump(DEMO_INPUT);
    setMinutes(120);
    setGeneratedPlan(DEMO_PLAN);
    setPlanKind("demo");
    setPlanState("success");
    setPlanMessage("Demo plan loaded locally. No backend or NVIDIA request was sent.");
  }

  function exitDemoMode() {
    // Clicking API PLANNING also invalidates any in-flight API request. This makes
    // mode changes safe even if a request is active and its response arrives late.
    abortController.current?.abort();
    abortController.current = null;
    planRequestId.current += 1;
    setCompletedTaskIds({});
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
    setCompletedTaskIds({});
    setGeneratedPlan(null);
    setPlanKind(null);

    try {
      const payload = await requestPlan({
        fetchImpl: fetch,
        url: requestUrl,
        token: credential,
        brainDump,
        availableMinutes: minutes,
        signal: controller.signal
      });
      if (!isCurrentPlanRequest(requestId, planRequestId.current, mounted.current, controller.signal)) return;

      setCompletedTaskIds({});
      setGeneratedPlan(payload);
      setPlanKind("api");
      setPlanState("success");
      setPlanMessage("Authenticated request succeeded. The plan below is the validated backend response.");
    } catch (error) {
      if (!isCurrentPlanRequest(requestId, planRequestId.current, mounted.current, controller.signal)) return;
      setPlanState("error");
      setGeneratedPlan(null);
      setPlanKind(null);
      setPlanMessage(error instanceof Error ? error.message : "Could not reach the planning API. Check the backend URL and allowed origin.");
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
  const displayModel = displayPlan ? buildPlanPresentation(displayPlan) : null;

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
        <textarea id="brain-dump" value={brainDump} onChange={e=>changeInput(e.target.value)} maxLength={5000} aria-invalid={Boolean(inputError)} aria-describedby="brain-dump-help brain-dump-error" disabled={demoMode || planState === "loading"} placeholder="I need to finish my portfolio, fix a login bug, learn React Query, and apply for internships…"/>
        <div className="input-footer"><span>{brainDump.length.toLocaleString()} / 5,000 CHARACTERS</span><button className="text-button" type="button" onClick={enterDemoMode}>LOAD EXAMPLE ↗</button></div>
        <p id="brain-dump-help" className="field-help">Whitespace around your thoughts is allowed; the input must contain useful non-whitespace text.</p>
        {inputError && <p id="brain-dump-error" className="field-error" role="alert">{inputError}</p>}
        <div className="rule"/>
        <div className="time-heading"><label className="field-label" htmlFor="available-minutes">EXECUTION WINDOW</label><strong>{minutes} <small>MIN</small></strong></div>
        <input id="available-minutes" className="time-slider" aria-label="Available time in minutes" type="range" min="5" max="720" step="1" value={minutes} aria-describedby="available-minutes-help available-minutes-error" aria-invalid={Boolean(timeError)} disabled={demoMode || planState === "loading"} onChange={e=>changeMinutes(Number(e.target.value))}/>
        <div className="range-labels"><span>5 MIN</span><span>12 HOURS</span></div>
        <div className="time-presets">{TIME_PRESETS.map(v=><button type="button" key={v} className={minutes===v?"preset active":"preset"} aria-pressed={minutes===v} disabled={demoMode || planState === "loading"} onClick={()=>changeMinutes(v)}>{formatTimePreset(v)}</button>)}</div>
        <p id="available-minutes-help" className="field-help">{demoMode ? "The fixed sample is designed for a 120-minute window. Switch back to API Planning to change available time." : "Choose an integer from 5 to 720 minutes, matching the planning API contract."}</p>
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
            {!displayModel?.valid
              ? <p className="output-state error-state" role="alert">Plan presentation unavailable: {displayModel?.reason || "Invalid plan data."}</p>
              : <>
            <div className="generated-plan-heading"><div><small>{planKind === "demo" ? "FIXED LOCAL EXAMPLE · NOT AI GENERATED" : "VALIDATED BACKEND RESPONSE"}</small><h3 id="generated-plan-title">{displayModel.summary}</h3></div><span>{displayModel.totalMinutes} MIN</span></div>
            <div className="plan-metadata"><span>{displayModel.tasks.length} scheduled tasks</span><span>{displayModel.deferredTasks.length} deferred</span><span>Time budget: {minutes} min</span></div>
            {(() => {
              const progress = getCompletionProgress(displayPlan, completedTaskIds);
              const dependencyGraph = buildDependencyGraph(displayPlan);
              return <section className="plan-progress" aria-labelledby="plan-progress-title">
                <div className="progress-heading"><h4 id="plan-progress-title">Execution progress</h4><strong>{progress.percent}%</strong></div>
                <div className="progress-track" role="progressbar" aria-label="Scheduled task completion" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={progress.completed + " of " + progress.total + " scheduled tasks complete"}>
                  <span style={{ width: progress.percent + "%" }} />
                </div>
                <p>{progress.completed} of {progress.total} scheduled tasks complete · {progress.remaining} remaining. Deferred tasks are excluded until they are scheduled in a future plan.</p>
                <section className="dependency-view" aria-labelledby="dependency-view-title">
                  <div className="dependency-heading"><h4 id="dependency-view-title">Dependency links</h4><span>DECLARED PREREQUISITES</span></div>
                  {!dependencyGraph.valid
                    ? <p className="dependency-empty" role="status">Dependency view unavailable: {dependencyGraph.reason}</p>
                    : dependencyGraph.edges.length === 0
                      ? <p className="dependency-empty">No prerequisites are declared in this plan. Task display order alone does not imply a dependency.</p>
                      : <ul className="dependency-links">{dependencyGraph.edges.map(edge => {
                          const from = dependencyGraph.nodes.find(node => node.id === edge.from);
                          const to = dependencyGraph.nodes.find(node => node.id === edge.to);
                          return <li key={edge.from + "->" + edge.to}>
                            <span className={"dependency-node " + edge.fromStatus}>{from.title}<small>{from.status.toUpperCase()} · {from.id}</small></span>
                            <span className="dependency-arrow" aria-label="must happen before">→</span>
                            <span className={"dependency-node " + edge.toStatus}>{to.title}<small>{to.status.toUpperCase()} · {to.id}</small></span>
                            <p>{from.title} must happen before {to.title}.</p>
                          </li>;
                        })}</ul>}
                </section>
              </section>;
            })()}
            <ol className="scheduled-task-list">{displayModel.tasks.map((task, index) => {
              const prerequisites = task.prerequisites.map(item => item.title + " (" + item.id + ")");
              return <li key={task.id}>
                <div className="generated-task-title"><strong><span className="task-index">{String(index + 1).padStart(2, "0")}</span>{task.title}</strong><span className="scheduled-status">SCHEDULED · {task.minutes} MIN · {task.priority.toUpperCase()}</span></div>
                <label className="completion-control">
                  <input type="checkbox" checked={completedTaskIds[task.id] === true} onChange={event => setCompletedTaskIds(current => setScheduledTaskCompletion(displayPlan, current, task.id, event.target.checked))} aria-label={"Mark scheduled task as complete: " + task.title} />
                  <span>{completedTaskIds[task.id] === true ? "COMPLETED" : "MARK COMPLETE"}</span>
                </label>
                <p>{task.reason}</p>
                <div className="task-facts"><span>{task.category.toUpperCase()}</span><span>{prerequisites.length ? "PREREQUISITES: " + prerequisites.join(", ") : "NO PREREQUISITES"}</span><span>ID: {task.id}</span></div>
              </li>;
            })}</ol>
            {displayModel.deferredTasks.length > 0 && <div className="deferred-tasks"><strong>Deferred work · not scheduled in this time window</strong><ul>{displayModel.deferredTasks.map(task => <li key={task.id}><b>{task.title}</b><p>{task.deferredReason}</p><small>{task.minutes} MIN · {task.priority.toUpperCase()} · {task.category.toUpperCase()} · ID: {task.id}</small></li>)}</ul></div>}
            </>}
          </section>
        </>}
        {planState !== "loading" && planState !== "success" && <div className="api-card"><div className="api-heading"><i className={"api-dot "+apiState}/><div><small>BACKEND CONNECTIVITY</small><strong>{apiState==="success"?"Connection verified":apiState==="loading"?"Checking connection":apiState==="error"?"Backend not reachable":"Not checked yet"}</strong></div><button type="button" onClick={checkApi} disabled={apiState==="loading"}>{apiState==="loading"?"CHECKING…":"CHECK API ↗"}</button></div><p role="status" aria-live="polite">{apiMessage}</p></div>}
      </article>
    </section>
    <footer><span><b>FLOW / COMPILER</b> · PHASE 3 CORE UI</span><span><i/> BUILT FOR FOCUSED WORK <em>/</em> {demoMode ? "LOCAL DEMO MODE" : "AI PLANNING REQUIRES SERVER CONFIGURATION"}</span></footer>
  </main>;
}
