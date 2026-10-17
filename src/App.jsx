import { useState } from "react";

const exampleTasks = [
  ["01", "Reproduce the login bug", "15 MIN · BLOCKER REMOVAL", "READY"],
  ["02", "Fix and verify login", "25 MIN · DEPENDS ON 01", "QUEUED"],
  ["03", "Deploy portfolio", "30 MIN · DEPENDS ON 02", "QUEUED"]
];

// Public, non-secret API origin. Production fails closed when it is not configured;
// local Vite development continues to use the dev-server /api proxy.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

export default function App() {
  const [brainDump, setBrainDump] = useState("");
  const [minutes, setMinutes] = useState(120);
  // The access token intentionally lives only in React state: no browser storage,
  // URL, telemetry, console output, or persistence is used.
  const [accessToken, setAccessToken] = useState("");
  const [planState, setPlanState] = useState("idle");
  const [planMessage, setPlanMessage] = useState("");
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [apiState, setApiState] = useState("idle");
  const [apiMessage, setApiMessage] = useState("Backend connection has not been checked.");

  async function compileWorkflow() {
    const credential = accessToken.trim();
    if (!credential) {
      setPlanState("error");
      setPlanMessage("Enter your session access token to authorize this request.");
      setGeneratedPlan(null);
      return;
    }
    if (!brainDump.trim()) {
      setPlanState("error");
      setPlanMessage("Enter the work you want to plan first.");
      setGeneratedPlan(null);
      return;
    }
    if (!import.meta.env.DEV && !API_BASE_URL) {
      setPlanState("error");
      setPlanMessage("Production API URL is not configured. Set VITE_API_BASE_URL to the Express backend origin.");
      setGeneratedPlan(null);
      return;
    }

    let requestUrl;
    try {
      const localHosts = ["localhost", "127.0.0.1", "[::1]"];
      const frontendIsLocal = localHosts.includes(window.location.hostname);
      const backendUrl = API_BASE_URL ? new URL(API_BASE_URL) : new URL(window.location.origin);
      const backendIsLocal = localHosts.includes(backendUrl.hostname);
      const isLocalDevelopment = import.meta.env.DEV && frontendIsLocal && backendIsLocal;
      const isOriginOnly = backendUrl.pathname === "/" && !backendUrl.search && !backendUrl.hash
        && !backendUrl.username && !backendUrl.password;
      if (!isOriginOnly || (backendUrl.protocol !== "https:" && !isLocalDevelopment)) {
        setPlanState("error");
        setPlanMessage("The planning API must be a valid HTTPS origin. HTTP is allowed only for local development.");
        setGeneratedPlan(null);
        return;
      }
      requestUrl = (API_BASE_URL ? backendUrl.origin : "") + "/api/plan";
    } catch {
      setPlanState("error");
      setPlanMessage("The configured planning API URL is invalid.");
      setGeneratedPlan(null);
      return;
    }

    setPlanState("loading");
    setPlanMessage("Sending an authenticated planning request…");
    setGeneratedPlan(null);
    try {
      const response = await fetch(requestUrl, {
        method: "POST",
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
      if (!response.ok) {
        const code = payload?.error?.code;
        const messages = {
          UNAUTHORIZED: "Access token rejected. Check it and try again.",
          AUTHENTICATION_NOT_CONFIGURED: "Backend access-token authentication is not configured yet.",
          AI_NOT_CONFIGURED: "Access was accepted, but the backend has no NVIDIA API key configured. No plan was generated.",
          RATE_LIMIT_EXCEEDED: "Too many requests. Wait before trying again."
        };
        setPlanState("error");
        setPlanMessage(messages[code] || ("Planning request failed (HTTP " + response.status + (typeof code === "string" ? " · " + code : "") + ")."));
        return;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
          || typeof payload.summary !== "string" || !Array.isArray(payload.tasks)) {
        setPlanState("error");
        setPlanMessage("The backend returned a response that did not match the plan contract.");
        return;
      }
      setGeneratedPlan(payload);
      setPlanState("success");
      setPlanMessage("Authenticated request succeeded. The plan below is the actual backend response.");
    } catch {
      setPlanState("error");
      setPlanMessage("Could not reach the planning API. Check the backend URL and allowed origin.");
    }
  }

  async function checkApi() {
    if (!import.meta.env.DEV && !API_BASE_URL) {
      setApiState("error");
      setApiMessage("Production API URL is not configured. Set VITE_API_BASE_URL to the Express backend origin.");
      return;
    }

    setApiState("loading");
    setApiMessage("Checking the Express health endpoint…");
    try {
      const response = await fetch(API_BASE_URL + "/api/health", { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || payload.status !== "ok" || payload.service !== "flow-compiler-api") {
        throw new Error("Unexpected health response");
      }
      setApiState("success");
      setApiMessage("Backend reachable · " + payload.service);
    } catch {
      setApiState("error");
      setApiMessage("Express backend unavailable at the configured API origin. AI planning is not enabled.");
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Flow Compiler home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><span className="brand-copy"><strong>FLOW<span> / COMPILER</span></strong><small>PERSONAL EXECUTION ENGINE</small></span></a>
      <div className="header-right"><span className="version-chip">BUILD 0.3.0 · PHASE 3</span><div className="system-status"><i/> UI ONLINE</div></div>
    </header>
    <section className="hero" aria-labelledby="hero-title">
      <div className="eyebrow"><i/> RAW THOUGHTS <span>/</span> STRUCTURE <span>/</span> EXECUTION</div>
      <div className="hero-layout"><div><h1 id="hero-title">Turn chaos into<br/><em>clear momentum.</em></h1><p>A personal command center for turning scattered thoughts into focused, dependency-aware work.</p></div><div className="hero-orbit" aria-hidden="true"><div>FC<span>↗</span></div><small>THINK IN FLOWS</small></div></div>
    </section>
    <section className="workspace" aria-label="Workflow compiler workspace">
      <article className="panel input-panel">
        <div className="panel-topline"><b>01</b><span>INPUT // RAW THOUGHTS</span><small>INGEST</small></div>
        <h2>Get it out of your head.</h2><p className="description">Dump the tasks, loose ends, and blockers. Structure comes next.</p>
        <label className="field-label" htmlFor="brain-dump">YOUR INPUT</label>
        <textarea id="brain-dump" value={brainDump} onChange={e=>setBrainDump(e.target.value)} maxLength={5000} placeholder="I need to finish my portfolio, fix a login bug, learn React Query, and apply for internships…"/>
        <div className="input-footer"><span>{brainDump.length.toLocaleString()} / 5,000 CHARACTERS</span><button className="text-button" onClick={()=>setBrainDump("Finish my portfolio, fix the login bug, learn React Query, and apply for internships. The login bug blocks deployment.")}>LOAD EXAMPLE ↗</button></div>
        <div className="rule"/>
        <div className="time-heading"><label className="field-label">EXECUTION WINDOW</label><strong>{minutes} <small>MIN</small></strong></div>
        <input className="time-slider" aria-label="Available time in minutes" type="range" min="15" max="240" step="15" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/>
        <div className="range-labels"><span>15 MIN</span><span>4 HOURS</span></div>
        <div className="time-presets">{[30,60,120,180,240].map(v=><button key={v} className={minutes===v?"preset active":"preset"} onClick={()=>setMinutes(v)}>{v>=60?v/60+"H":v+"M"}</button>)}</div>
        <div className="rule"/>
        <label className="field-label" htmlFor="session-access-token">SESSION ACCESS TOKEN</label>
        <input
          id="session-access-token"
          className="token-input"
          type="password"
          autoComplete="off"
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
        <button className="compile-button" type="button" onClick={compileWorkflow} disabled={planState === "loading"} title="Send an authenticated request to the configured planning API">
          <span className="compile-glyph">⌘</span>
          <span>{planState === "loading" ? "COMPILING WORKFLOW" : "COMPILE WORKFLOW"}<small>{planState === "loading" ? "WAITING FOR BACKEND" : "AUTHENTICATED API REQUEST"}</small></span>
          <b>↗</b>
        </button>
        <p className="honesty-note"><i>i</i> Your token stays in this page's memory and is sent only in the Authorization header. Raw notes go to your backend and, when configured, its AI provider.</p>
      </article>
      <article className="panel output-panel">
        <div className="panel-topline"><b>02</b><span>COMPILATION OUTPUT</span><small>FLOW / GRAPH</small></div>
        <div className="output-title"><div><h2>Execution graph</h2><p className="description">Tasks become a sequence, not another list.</p></div><span className="preview-badge">● CONCEPT PREVIEW</span></div>
        <div className="graph-banner"><span className="graph-icon">⌁</span><div><small>WORKFLOW STATUS</small><strong>Awaiting first compilation</strong><p>Illustrative nodes show the intended visual language.</p></div><span className="idle">IDLE</span></div>
        <div className="stats"><div><small>TIME WINDOW</small><strong>{minutes} <i>MIN</i></strong><p>Available focus time</p></div><div><small>ACTION NODES</small><strong>03<sup>*</sup></strong><p>Illustrative only</p></div><div><small>DEPENDENCIES</small><strong>02</strong><p>Example connections</p></div></div>
        <div className="task-graph"><div className="rail" aria-hidden="true"><i/><i/><i/></div>{exampleTasks.map((t,i)=><div className={"task-node node-"+i} key={t[0]}><span className="task-number">{t[0]}</span><div><small>{t[2]}</small><strong>{t[1]}</strong></div><span className={"task-state state-"+i}>{t[3]}</span></div>)}</div>
        <p className="graph-footnote">* Example workflow only — no AI-generated result is displayed.</p>
        {planState !== "idle" && <div className={"plan-feedback " + planState} role="status" aria-live="polite">{planMessage}</div>}
        {generatedPlan && <section className="generated-plan" aria-labelledby="generated-plan-title">
          <div className="generated-plan-heading"><div><small>LIVE API RESPONSE</small><h3 id="generated-plan-title">{generatedPlan.summary}</h3></div><span>{generatedPlan.totalMinutes} MIN</span></div>
          <ol>{generatedPlan.tasks.map(task => <li key={task.id}>
            <div className="generated-task-title"><strong>{task.title}</strong><span>{task.minutes} MIN · {task.priority.toUpperCase()}</span></div>
            <p>{task.reason}</p>
            <small>{task.category.toUpperCase()}{task.dependsOn.length ? " · DEPENDS ON " + task.dependsOn.join(", ") : " · NO PREREQUISITES"}</small>
          </li>)}</ol>
          {Array.isArray(generatedPlan.deferredTasks) && generatedPlan.deferredTasks.length > 0 && <div className="deferred-tasks"><strong>Deferred work</strong><ul>{generatedPlan.deferredTasks.map(task => <li key={task.id}>{task.title} — {task.deferredReason}</li>)}</ul></div>}
        </section>}
        <div className="api-card"><div className="api-heading"><i className={"api-dot "+apiState}/><div><small>BACKEND CONNECTIVITY</small><strong>{apiState==="success"?"Connection verified":apiState==="loading"?"Checking connection":apiState==="error"?"Backend not reachable":"Not checked yet"}</strong></div><button onClick={checkApi} disabled={apiState==="loading"}>{apiState==="loading"?"CHECKING…":"CHECK API ↗"}</button></div><p role="status" aria-live="polite">{apiMessage}</p></div>
      </article>
    </section>
    <footer><span><b>FLOW / COMPILER</b> · PHASE 3 UI FOUNDATION</span><span><i/> BUILT FOR FOCUSED WORK <em>/</em> AI PLANNING NOT YET ACTIVE</span></footer>
  </main>;
}