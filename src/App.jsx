import { useEffect, useRef, useState } from "react";
import { DEMO_PLAN, DEMO_INPUT, TIME_PRESETS, formatTimePreset, getInputError, getTimeError } from "./plan-ui.js";
import { requestPlan } from "./plan-api.js";
import { buildDependencyGraph, buildPlanPresentation, getCompletionProgress, isCurrentPlanRequest, setScheduledTaskCompletion } from "./plan-interactions.js";
import { buildPreviousPlan, formatFocusTime, getNextReadyTask, mergeRecompiledPlan, recompileLocalDemo } from "./plan-revision.js";
import { clearPlanSnapshot, loadPlanSnapshot, savePlanSnapshot } from "./plan-storage.js";
import { serializeSafePlanExport } from "./plan-export.js";

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
  const [revisionReason, setRevisionReason] = useState("manual");
  const [revisionNote, setRevisionNote] = useState("");
  const [blockedTaskId, setBlockedTaskId] = useState("");
  const [revisionPending, setRevisionPending] = useState(false);
  const [revisionState, setRevisionState] = useState("idle");
  const [revisionMessage, setRevisionMessage] = useState("");
  const [focusTimer, setFocusTimer] = useState({ taskId: null, secondsLeft: 0, running: false });
  const [focusMode, setFocusMode] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [apiState, setApiState] = useState("idle");
  const [apiMessage, setApiMessage] = useState("Backend connection has not been checked.");
  const planRequestId = useRef(0);
  const healthRequestId = useRef(0);
  const abortController = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const saved = loadPlanSnapshot();
    if (saved.snapshot) {
      setMinutes(saved.snapshot.availableMinutes);
      setDemoMode(saved.snapshot.planKind.startsWith("demo"));
      setBrainDump(saved.snapshot.planKind.startsWith("demo") ? DEMO_INPUT : "");
      setGeneratedPlan(saved.snapshot.plan);
      setCompletedTaskIds(saved.snapshot.completedTaskIds);
      setPlanKind(saved.snapshot.planKind);
      setPlanState("success");
      setPlanMessage("Saved plan restored locally. The original input and session access token were not saved.");
      setStorageMessage("Saved on this browser · raw input and session token were not stored.");
    } else if (saved.status === "invalid") {
      setStorageMessage("An expired or invalid saved plan was cleared. Load a demo or compile a new plan.");
    } else if (saved.status === "unavailable") {
      setStorageMessage("Browser storage is unavailable. The current plan can still be used in this tab.");
    }
    setStorageReady(true);
    return () => {
      mounted.current = false;
      planRequestId.current += 1;
      healthRequestId.current += 1;
      abortController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!storageReady || planState === "loading" || revisionPending) return;
    if (planState !== "success" || !generatedPlan || !planKind) {
      clearPlanSnapshot();
      setStorageMessage("");
      return;
    }
    const saved = savePlanSnapshot({
      plan: generatedPlan,
      completedTaskIds,
      availableMinutes: minutes,
      planKind
    });
    if (saved.ok) {
      setStorageMessage("Saved on this browser · raw input and session token are never stored.");
    } else {
      setStorageMessage(saved.reason === "unavailable"
        ? "Browser storage is unavailable; this plan remains only in the current tab."
        : "This plan could not be saved safely. It remains available in the current tab.");
    }
  }, [storageReady, planState, generatedPlan, completedTaskIds, minutes, planKind, revisionPending]);

  useEffect(() => {
    if (!focusTimer.running) return undefined;
    const interval = window.setInterval(() => {
      setFocusTimer(current => {
        if (!current.running) return current;
        const secondsLeft = Math.max(0, current.secondsLeft - 1);
        return { ...current, secondsLeft, running: secondsLeft > 0 };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focusTimer.running]);

  function changeInput(value) {
    setFocusMode(false);
    setBrainDump(value);
    if (planState === "success" || planState === "error") {
      setPlanState("idle");
      setPlanMessage("");
      setGeneratedPlan(null);
      setPlanKind(null);
      setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
      setRevisionPending(false);
      setRevisionState("idle");
      setRevisionMessage("");
    }
  }

  function changeMinutes(value) {
    if (demoMode) return;
    setMinutes(value);
    if (planState === "success" && generatedPlan) {
      setRevisionPending(true);
      setRevisionReason("time_changed");
      setRevisionState("idle");
      setRevisionMessage("Execution window changed. Recompile to apply the new budget while preserving completed work.");
      return;
    }
    if (planState === "error") {
      setPlanState("idle");
      setPlanMessage("");
      setGeneratedPlan(null);
      setPlanKind(null);
    }
  }

  function enterDemoMode() {
    setFocusMode(false);
    abortController.current?.abort();
    abortController.current = null;
    planRequestId.current += 1;
    setCompletedTaskIds({});
    setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
    setRevisionPending(false);
    setRevisionState("idle");
    setRevisionMessage("");
    setRevisionReason("manual");
    setRevisionNote("");
    setBlockedTaskId("");
    setDemoMode(true);
    setBrainDump(DEMO_INPUT);
    setMinutes(120);
    setGeneratedPlan(DEMO_PLAN);
    setPlanKind("demo");
    setPlanState("success");
    setPlanMessage("Demo plan loaded locally. No backend or NVIDIA request was sent.");
  }

  function exitDemoMode() {
    setFocusMode(false);
    // Clicking API PLANNING also invalidates any in-flight API request. This makes
    // mode changes safe even if a request is active and its response arrives late.
    abortController.current?.abort();
    abortController.current = null;
    planRequestId.current += 1;
    setCompletedTaskIds({});
    setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
    setRevisionPending(false);
    setRevisionState("idle");
    setRevisionMessage("");
    setRevisionReason("manual");
    setRevisionNote("");
    setBlockedTaskId("");
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
      if (generatedPlan && planState === "success") {
        setPlanMessage("Enter your session access token to authorize a new request. Your current plan is retained.");
      } else {
        setPlanState("error");
        setPlanMessage("Enter your session access token to authorize this request. No request was sent.");
        setGeneratedPlan(null);
        setPlanKind(null);
      }
      return;
    }

    let requestUrl;
    try {
      requestUrl = planningUrl();
    } catch (error) {
      if (generatedPlan && planState === "success") {
        setPlanMessage("The new request could not start; your current plan was retained. " + error.message);
      } else {
        setPlanState("error");
        setPlanMessage(error.message);
        setGeneratedPlan(null);
        setPlanKind(null);
      }
      return;
    }

    const previousActivePlan = generatedPlan;
    const previousPlanKind = planKind;
    const previousCompletedTaskIds = completedTaskIds;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const requestId = ++planRequestId.current;
    setPlanState("loading");
    setPlanMessage("Sending an authenticated planning request…");
    setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
    setRevisionPending(false);
    setRevisionState("idle");
    setRevisionMessage("");

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
      if (previousActivePlan) {
        setGeneratedPlan(previousActivePlan);
        setPlanKind(previousPlanKind);
        setCompletedTaskIds(previousCompletedTaskIds);
        setPlanState("success");
        setPlanMessage("The new request failed; your previous plan and completion state were retained. " +
          (error instanceof Error ? error.message : "Check the backend URL and allowed origin."));
      } else {
        setPlanState("error");
        setGeneratedPlan(null);
        setPlanKind(null);
        setPlanMessage(error instanceof Error ? error.message : "Could not reach the planning API. Check the backend URL and allowed origin.");
      }
    } finally {
      if (requestId === planRequestId.current && abortController.current === controller) {
        abortController.current = null;
      }
    }
  }

  function startFocusForTask(task) {
    setFocusTimer({ taskId: task.id, secondsLeft: task.minutes * 60, running: false });
  }

  function toggleScheduledTask(taskId, checked) {
    setCompletedTaskIds(current => setScheduledTaskCompletion(generatedPlan, current, taskId, checked));
    if (checked) {
      setFocusTimer(current => current.taskId === taskId ? { ...current, running: false } : current);
    }
  }

  function toggleFocusTimer() {
    setFocusTimer(current => {
      if (!current.taskId || current.secondsLeft <= 0) return current;
      return { ...current, running: !current.running };
    });
  }

  function resetFocusTimer() {
    const task = generatedPlan?.tasks?.find(item => item.id === focusTimer.taskId);
    if (!task) {
      setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
      return;
    }
    setFocusTimer({ taskId: task.id, secondsLeft: task.minutes * 60, running: false });
  }

  async function recompileWorkflow() {
    if (planState !== "success" || !generatedPlan || revisionState === "loading") return;
    const reason = revisionPending && revisionReason === "manual" ? "time_changed" : revisionReason;
    const options = { note: revisionNote.trim(), blockedTaskId };
    let previousPlan;
    try {
      previousPlan = buildPreviousPlan(generatedPlan, completedTaskIds, reason, options);
    } catch (error) {
      setRevisionState("error");
      setRevisionMessage(error instanceof Error ? error.message : "The current plan cannot be revised safely.");
      return;
    }

    if (demoMode) {
      try {
        const localRevision = recompileLocalDemo(generatedPlan, completedTaskIds, minutes, {
          reason,
          note: options.note,
          blockedTaskId: options.blockedTaskId
        });
        const merged = mergeRecompiledPlan(generatedPlan, completedTaskIds, localRevision);
        setGeneratedPlan(merged);
        setPlanKind("demo-revision");
        setRevisionPending(false);
        setRevisionState("success");
        setRevisionMessage("Demo plan revised locally. This is a deterministic illustration; no API or AI provider was called.");
        setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
      } catch (error) {
        setRevisionState("error");
        setRevisionMessage(error instanceof Error ? error.message : "The local demo plan could not be revised.");
      }
      return;
    }

    if (getInputError(brainDump)) {
      setRevisionState("error");
      setRevisionMessage("Your original task input was not saved for privacy. Re-enter the task description before recompiling. No request was sent.");
      return;
    }

    const credential = accessToken.trim();
    if (!credential) {
      setRevisionState("error");
      setRevisionMessage("Enter your session access token to authorize this revision. No request was sent.");
      return;
    }

    let requestUrl;
    try {
      requestUrl = planningUrl();
    } catch (error) {
      setRevisionState("error");
      setRevisionMessage(error instanceof Error ? error.message : "The planning API URL is not configured.");
      return;
    }

    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const requestId = ++planRequestId.current;
    setRevisionState("loading");
    setRevisionMessage("Recompiling unfinished work and preserving completed tasks…");
    try {
      const responsePlan = await requestPlan({
        fetchImpl: fetch,
        url: requestUrl,
        token: credential,
        brainDump,
        availableMinutes: minutes,
        previousPlan,
        signal: controller.signal
      });
      if (!isCurrentPlanRequest(requestId, planRequestId.current, mounted.current, controller.signal)) return;
      const merged = mergeRecompiledPlan(generatedPlan, completedTaskIds, responsePlan);
      setGeneratedPlan(merged);
      setPlanKind("api-revision");
      setCompletedTaskIds(current => Object.fromEntries(
        Object.entries(current).filter(([id]) => merged.tasks.some(task => task.id === id))
      ));
      setRevisionPending(false);
      setRevisionState("success");
      setRevisionMessage("Remaining work was recompiled. Completed task records were preserved; deferred work remains explicit.");
      setFocusTimer({ taskId: null, secondsLeft: 0, running: false });
    } catch (error) {
      if (!isCurrentPlanRequest(requestId, planRequestId.current, mounted.current, controller.signal)) return;
      setRevisionState("error");
      setRevisionMessage(error instanceof Error ? error.message : "Could not recompile the remaining plan.");
    } finally {
      if (requestId === planRequestId.current && abortController.current === controller) {
        abortController.current = null;
      }
    }
  }

  function exportSafePlan() {
    if (!displayPlan) return;
    try {
      const serialized = serializeSafePlanExport(displayPlan, completedTaskIds);
      const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "flow-compiler-safe-plan.json";
      link.rel = "noopener";
      link.click();
      URL.revokeObjectURL(objectUrl);
      setExportMessage("Safe export created. It excludes raw thoughts, summary, task reasons, blocker notes, and credentials.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Safe export could not be created.");
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
  const nextReadyTask = displayPlan ? getNextReadyTask(displayPlan, completedTaskIds) : null;
  const focusTask = displayPlan?.tasks?.find(task => task.id === focusTimer.taskId) ?? null;
  const displayModel = displayPlan ? buildPlanPresentation(displayPlan) : null;

  return <main className={"app-shell" + (focusMode ? " focus-mode" : "")}>
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
        <div className="output-title"><div><h2>Execution plan</h2><p className="description">Only tasks from the active plan are shown below.</p></div><span className={planKind === "api" ? "preview-badge api-plan-badge" : "preview-badge"}>{planKind?.startsWith("api") ? "VALIDATED API PLAN" : planKind?.startsWith("demo") ? "DEMO / ILLUSTRATIVE" : "WAITING FOR INPUT"}</span></div>
        {planState === "idle" && <div className="graph-banner"><span className="graph-icon">⌁</span><div><small>WORKFLOW STATUS</small><strong>Awaiting compilation</strong><p>No plan is displayed yet. Use Local Demo to view clearly labeled sample tasks, or submit valid input in API Planning mode.</p></div><span className="idle">IDLE</span></div>}
        {planState === "loading" && <div className="output-state loading-state" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true"/> <div><strong>Compiling workflow…</strong><p>Waiting for the authenticated planning API response.</p></div></div>}
        {planState === "error" && <div className="output-state error-state" role="alert"><strong>Plan not available</strong><p>{planMessage}</p><p>No task plan is being shown for this failed request.</p></div>}
        {planState === "success" && displayPlan && <>
          <div className="plan-feedback success" role="status" aria-live="polite">{planMessage}</div>
          <section className={"generated-plan " + (planKind === "demo" ? "demo-plan" : "api-plan")} aria-labelledby="generated-plan-title">
            {!displayModel?.valid
              ? <p className="output-state error-state" role="alert">Plan presentation unavailable: {displayModel?.reason || "Invalid plan data."}</p>
              : <>
            <div className="generated-plan-heading"><div><small>{planKind === "demo" ? "FIXED LOCAL EXAMPLE · NOT AI GENERATED" : "VALIDATED BACKEND RESPONSE"}</small><h3 id="generated-plan-title">{displayModel.summary}</h3></div><span>{displayModel.totalMinutes} MIN<small>{planKind?.endsWith("-revision") ? "REMAINING" : "SCHEDULED"}</small></span></div>
            <div className="plan-actions">
              <button className="revision-button export-button" type="button" onClick={exportSafePlan}>EXPORT SAFE PLAN ↗</button>
              {exportMessage && <p className="export-feedback" role="status" aria-live="polite">{exportMessage}</p>}
            </div>
            {storageMessage && <p className="storage-status" role="status" aria-live="polite">{storageMessage}</p>}
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
                  <input type="checkbox" checked={completedTaskIds[task.id] === true} onChange={event => toggleScheduledTask(task.id, event.target.checked)} aria-label={"Mark scheduled task as complete: " + task.title} />
                  <span>{completedTaskIds[task.id] === true ? "COMPLETED" : "MARK COMPLETE"}</span>
                </label>
                <button className="focus-task-button" type="button" onClick={() => startFocusForTask(task)} disabled={completedTaskIds[task.id] === true || !task.dependsOn.every(id => completedTaskIds[id] === true)}>FOCUS THIS TASK</button>
                <p>{task.reason}</p>
                <div className="task-facts"><span>{task.category.toUpperCase()}</span><span>{prerequisites.length ? "PREREQUISITES: " + prerequisites.join(", ") : "NO PREREQUISITES"}</span><span>ID: {task.id}</span></div>
              </li>;
            })}</ol>
            {displayModel.deferredTasks.length > 0 && <div className="deferred-tasks"><strong>Deferred work · not scheduled in this time window</strong><ul>{displayModel.deferredTasks.map(task => <li key={task.id}><b>{task.title}</b><p>{task.deferredReason}</p><small>{task.minutes} MIN · {task.priority.toUpperCase()} · {task.category.toUpperCase()} · ID: {task.id}</small></li>)}</ul></div>}
            <section className="focus-panel" aria-labelledby="focus-panel-title">
              <div className="focus-panel-heading">
                <div><small>FOCUS MODE</small><h4 id="focus-panel-title">One action at a time</h4></div>
                <time aria-label={"Time remaining " + formatFocusTime(focusTimer.secondsLeft)} aria-live="off">{formatFocusTime(focusTimer.secondsLeft)}</time>
                <button className="focus-mode-toggle" type="button" onClick={() => setFocusMode(value => !value)}>{focusMode ? "EXIT FOCUS MODE" : "ENTER FOCUS MODE"}</button>
              </div>
              {focusTask
                ? <p className="focus-task-name">Current focus: <strong>{focusTask.title}</strong> · {focusTask.minutes} min</p>
                : <p className="focus-task-name">Choose a scheduled task to start its countdown.</p>}
              <div className="focus-controls">
                <button type="button" onClick={toggleFocusTimer} disabled={!focusTask || focusTimer.secondsLeft <= 0}>{focusTimer.running ? "PAUSE TIMER" : focusTask && focusTimer.secondsLeft === 0 ? "TIMER COMPLETE" : "START TIMER"}</button>
                <button type="button" onClick={resetFocusTimer} disabled={!focusTask}>RESET</button>
                <button type="button" onClick={() => nextReadyTask && startFocusForTask(nextReadyTask)} disabled={!nextReadyTask}>NEXT READY TASK</button>
              </div>
              <p className="focus-hint">{nextReadyTask ? "Next ready: " + nextReadyTask.title : "No incomplete task has all prerequisites completed."} The timer runs only in this open tab.</p>
            </section>
            <section className="revision-panel" aria-labelledby="revision-panel-title">
              <div className="revision-panel-heading"><div><small>LIVE RECOMPILATION</small><h4 id="revision-panel-title">Revise unfinished work</h4></div><span>{demoMode ? "LOCAL ONLY" : "AUTHENTICATED API"}</span></div>
              {revisionPending && <p className="revision-notice" role="status">The time budget changed. The current plan is retained until you recompile.</p>}
              <label htmlFor="revision-reason">WHY ARE YOU REVISING?</label>
              <select id="revision-reason" value={revisionReason} onChange={event => setRevisionReason(event.target.value)} disabled={revisionState === "loading"}>
                <option value="manual">Manual adjustment</option>
                <option value="time_changed">Available time changed</option>
                <option value="completed_early">Finished a task early</option>
                <option value="blocked">A task is blocked</option>
              </select>
              {revisionReason === "blocked" && <>
                <label htmlFor="blocked-task">BLOCKED TASK</label>
                <select id="blocked-task" value={blockedTaskId} onChange={event => setBlockedTaskId(event.target.value)} disabled={revisionState === "loading"}>
                  <option value="">Select an unfinished task</option>
                  {[...displayModel.tasks, ...displayModel.deferredTasks].filter(task => completedTaskIds[task.id] !== true).map(task => <option key={task.id} value={task.id}>{task.title}{displayModel.deferredTasks.some(deferred => deferred.id === task.id) ? " (deferred)" : ""}</option>)}
                </select>
              </>}
              <label htmlFor="revision-note">CONTEXT / BLOCKER DETAILS</label>
              <textarea id="revision-note" value={revisionNote} onChange={event => setRevisionNote(event.target.value)} maxLength={1000} disabled={revisionState === "loading"} placeholder="Optional: what changed, what finished early, or what is blocking progress? Do not include credentials."/>
              <button className="revision-button" type="button" onClick={recompileWorkflow} disabled={revisionState === "loading"}>{revisionState === "loading" ? "RECOMPILING…" : demoMode ? "RECOMPILE DEMO LOCALLY" : "RECOMPILE REMAINING WORK"}</button>
              {revisionMessage && <p className={"revision-feedback " + (revisionState === "error" ? "error" : revisionState === "success" ? "success" : "")} role={revisionState === "error" ? "alert" : "status"} aria-live="polite">{revisionMessage}</p>}
              <p className="revision-hint">Only unfinished task data and the documented revision reason are sent during API planning. Completed tasks remain on screen and are not requested again.</p>
            </section>
            </>}
          </section>
        </>}
        {planState !== "loading" && planState !== "success" && <div className="api-card"><div className="api-heading"><i className={"api-dot "+apiState}/><div><small>BACKEND CONNECTIVITY</small><strong>{apiState==="success"?"Connection verified":apiState==="loading"?"Checking connection":apiState==="error"?"Backend not reachable":"Not checked yet"}</strong></div><button type="button" onClick={checkApi} disabled={apiState==="loading"}>{apiState==="loading"?"CHECKING…":"CHECK API ↗"}</button></div><p role="status" aria-live="polite">{apiMessage}</p></div>}
      </article>
    </section>
    <footer><span><b>FLOW / COMPILER</b> · PHASE 3 CORE UI</span><span><i/> BUILT FOR FOCUSED WORK <em>/</em> {demoMode ? "LOCAL DEMO MODE" : "AI PLANNING REQUIRES SERVER CONFIGURATION"}</span></footer>
  </main>;
}
